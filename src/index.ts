import { Spectrum, attachment } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { type Reply, fitCheckPrompt, handlePhoto, handleTextMessage, startOnboarding } from "./flows.ts";
import { warmUp } from "./llm.ts";
import {
  claimDueReminders,
  claimFitPing,
  createUser,
  fitCheckUsers,
  getUser,
  localDate,
  photoAt,
  releaseFitPing,
  db,
  releaseReminder,
  sql,
} from "./store.ts";
import { claimNudges, releaseNudge } from "./returns.ts";
import { startWebServer } from "./web.ts";

// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

const im = imessage(app);

// Reminder scheduler: the only thing that messages first. Users have opted in
// by asking for the reminder, so proactive sends are fine.
async function sendTo(userId: string, text: string) {
  const space = await im.space.create(await im.user(userId));
  await space.send(text);
}

// A daily ping goes out once the user's hour arrives, but only within a few
// hours of it, so a late restart doesn't send a morning nudge at night.
const FIT_CHECK_WINDOW_HOURS = 3;

// Claims happen in the database before sending, so a slow send or a second
// worker can't double-fire. A failed send releases the claim to retry.
async function sendDueReminders() {
  for (const reminder of await claimDueReminders()) {
    try {
      await sendTo(reminder.userId, `Reminder: ${reminder.text}`);
    } catch (err) {
      await releaseReminder(reminder.id);
      console.error(`reminder ${reminder.id} for ${reminder.userId} failed`, err);
    }
  }

  const now = new Date();
  const today = localDate(now);
  for (const user of await fitCheckUsers()) {
    const hoursPast = now.getHours() - user.fitCheckHour!;
    if (hoursPast < 0 || hoursPast >= FIT_CHECK_WINDOW_HOURS) continue;
    if (!(await claimFitPing(user.id, today))) continue; // already pinged, or they sent a photo
    try {
      await sendTo(user.id, fitCheckPrompt());
    } catch (err) {
      await releaseFitPing(user.id);
      console.error(`fit check ping for ${user.id} failed`, err);
    }
  }
}

// Return nudges go out once a day, from this hour on (server local time), so
// nobody gets one at 3am. Each purchase is claimed before sending (returns.ts),
// so a restart re-runs the pass without sending anything twice.
const NUDGE_HOUR = 10;
let lastNudgeDay: string | undefined;

async function sendReturnNudges() {
  const now = new Date();
  const today = localDate(now);
  if (now.getHours() < NUDGE_HOUR || lastNudgeDay === today) return;
  const nudges = await claimNudges(db, { today });
  lastNudgeDay = today; // after the claim, so a failed query retries next tick
  for (const nudge of nudges) {
    try {
      await sendTo(nudge.userId, nudge.text);
    } catch (err) {
      await releaseNudge(db, nudge.purchaseId);
      console.error(`return nudge for purchase ${nudge.purchaseId} failed`, err);
    }
  }
}

// One tick at a time: a slow database or send shouldn't stack up overlapping runs.
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await sendDueReminders();
    await sendReturnNudges();
  } catch (err) {
    console.error("scheduler tick failed", err);
  } finally {
    ticking = false;
  }
}

startWebServer();
void warmUp(); // load the model now so the first text isn't slow
const timer = setInterval(tick, 15_000);
process.on("SIGINT", () => {
  clearInterval(timer);
  void app
    .stop()
    .then(() => sql.close())
    .finally(() => process.exit(0));
});

// Shows the typing bubble while `work` runs. Unlike space.responding, a
// failure to start or stop the bubble never stops the reply itself.
async function withTyping<T>(space: { startTyping(): Promise<void>; stopTyping(): Promise<void> }, work: () => Promise<T>): Promise<T> {
  await space.startTyping().catch((err) => console.warn("typing indicator failed to start", err));
  try {
    return await work();
  } finally {
    await space.stopTyping().catch(() => {});
  }
}

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  if (message.direction === "outbound" || !message.sender) continue;

  try {
    const user = await getUser(message.sender.id);
    const content = message.content;
    const isText = content.type === "text";
    const isImage = content.type === "attachment" && content.mimeType.startsWith("image/");
    if (user && !isText && !isImage) continue; // nothing to answer, so no typing bubble

    // The typing bubble shows while the reply is worked out (the text model
    // takes a second or two), so a slow answer doesn't look like no answer.
    // A stored photo goes out as an image; a missing one is skipped.
    const send = async (reply: Reply) => {
      if (typeof reply === "string") return void (await space.send(reply));
      const photo = await photoAt(reply.photo);
      if (!photo) return;
      const name = `fit-check.${photo.mimeType.split("/")[1] ?? "jpg"}`;
      await space.send(attachment(Buffer.from(photo.image), { name, mimeType: photo.mimeType }));
    };

    const later = await withTyping(space, async () => {
      let replies: Reply[];
      let later: (() => Promise<Reply[]>) | undefined;
      if (!user) {
        await createUser(message.sender!.id);
        replies = startOnboarding(message.sender!.id, content.type === "text" ? content.text : undefined);
      } else if (content.type === "text") {
        ({ replies, later } = await handleTextMessage(user, content.text));
      } else if (content.type === "attachment") {
        ({ replies, later } = await handlePhoto(user, await content.read(), content.mimeType));
      } else {
        return undefined;
      }
      for (const reply of replies) await send(reply);
      return later;
    });

    // Slow follow-ups (the vision model) run off the loop so other messages
    // aren't stuck behind them. The bubble comes back while they run, since
    // reading a fit check photo can take 5-30s.
    if (later) {
      void withTyping(space, async () => {
        for (const reply of await later()) await send(reply);
      }).catch((err) => console.error(`follow-up for message ${message.id} failed`, err));
    }
  } catch (err) {
    console.error(`failed handling message ${message.id}`, err);
  }
}
