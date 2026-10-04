import { Spectrum, attachment } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { telegram } from "@spectrum-ts/telegram";
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
  claimRecaps,
  claimCheckinUsers,
  releaseRecap,
  db,
  releaseReminder,
  setPlatform,
  sql,
} from "./store.ts";
import { claimNudges, releaseNudge } from "./returns.ts";
import { previousMonth } from "./recap.ts";
import { recapFor } from "./recaps.ts";
import { askCheckin, endClosetModes } from "./flows.ts";
import { startWebServer } from "./web.ts";
import { fitForChat } from "./chat-photo.ts";

// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
// Telegram runs alongside iMessage when a bot token is set (from @BotFather).
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config(), ...(TELEGRAM_BOT_TOKEN ? [telegram.config({ botToken: TELEGRAM_BOT_TOKEN })] : [])],
});

const im = imessage(app);
const tg = TELEGRAM_BOT_TOKEN ? telegram(app) : undefined;
console.log(`Messaging on iMessage${tg ? " and Telegram" : ""}`);

/**
 * A conversation with a user, on the platform they use the bot on. Telegram
 * bots can only message people who've messaged them first, which onboarding
 * guarantees.
 */
async function spaceFor(userId: string) {
  const user = await getUser(userId);
  if (user?.platform === "telegram" && tg) return tg.space.create(await tg.user(userId));
  return im.space.create(await im.user(userId));
}

// Reminder scheduler: the only thing that messages first. Users have opted in
// by asking for the reminder, so proactive sends are fine.
async function sendTo(userId: string, text: string) {
  const space = await spaceFor(userId);
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

// The recap for last month goes out on the 1st from RECAP_HOUR, to users with
// a fit check last month. Each user is claimed before sending (users.last_recap),
// so a restart or a second worker can't send it twice.
const RECAP_HOUR = 11;
let lastRecapDay: string | undefined;

async function sendMonthlyRecaps() {
  const now = new Date();
  const today = localDate(now);
  if (now.getDate() !== 1 || now.getHours() < RECAP_HOUR || lastRecapDay === today) return;
  const month = previousMonth(now);
  const users = await claimRecaps(month.key, month.from, month.to);
  lastRecapDay = today;
  for (const userId of users) {
    try {
      const space = await spaceFor(userId);
      const { card, summary } = await recapFor(userId, month, (await getUser(userId))?.name);
      if (card) await space.send(attachment(Buffer.from(card), { name: "recap.png", mimeType: "image/png" }));
      await space.send(summary);
    } catch (err) {
      await releaseRecap(userId);
      console.error(`monthly recap for ${userId} failed`, err);
    }
  }
}

// "What happened to this?": once a day from CHECKIN_HOUR, each user who
// hasn't been asked in a week gets asked about their most overdue item, if
// any. The user is claimed (users.last_checkin_ask) right before sending.
const CHECKIN_HOUR = 12;
let lastCheckinDay: string | undefined;

async function sendCheckins() {
  const now = new Date();
  const today = localDate(now);
  if (now.getHours() < CHECKIN_HOUR || lastCheckinDay === today) return;
  lastCheckinDay = today;
  for (const userId of await claimCheckinUsers(today)) {
    try {
      const user = await getUser(userId);
      const question = user && (await askCheckin(user));
      if (question) await sendTo(userId, question);
    } catch (err) {
      console.error(`closet check-in for ${userId} failed`, err);
    }
  }
}

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
// Closet mode windows that ran out of time get their summary ("Your closet
// has 23 items..."). The user just sent photos, so a follow-up is expected.
async function sendClosetSummaries() {
  for (const { userId, text } of await endClosetModes()) {
    await sendTo(userId, text).catch((err) => console.error(`closet summary for ${userId} failed`, err));
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await sendDueReminders();
    await sendReturnNudges();
    await sendMonthlyRecaps();
    await sendCheckins();
    await sendClosetSummaries();
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

// Shows the typing bubble while `work` runs. The bubble is started without
// waiting for it: on RCS that call can be slow, and the reply shouldn't wait
// on a cosmetic. A failure to start or stop it never stops the reply.
async function withTyping<T>(
  space: { startTyping(): Promise<void>; stopTyping(): Promise<void> },
  work: () => Promise<T>,
  timing?: Timing,
): Promise<T> {
  const started = Date.now();
  const typing = space
    .startTyping()
    .then(() => timing && (timing.typing = Date.now() - started))
    .catch((err) => console.warn("typing indicator failed to start", err));
  try {
    return await work();
  } finally {
    void typing.then(() => space.stopTyping()).catch(() => {});
  }
}

// Where a reply's time goes, logged once per message: how late it reached us
// (the network and platform), the typing bubble call, our own work, and sending.
interface Timing {
  inbound: number;
  typing?: number;
  work?: number;
  send: number;
}
const secs = (ms: number | undefined) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`);
function logTiming(id: string, t: Timing) {
  console.log(`[timing] ${id}: reached us after ${secs(t.inbound)}, typing call ${secs(t.typing)}, our work ${secs(t.work)}, sending ${secs(t.send)}`);
}

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  if (message.direction === "outbound" || !message.sender) continue;

  const timing: Timing = { inbound: Date.now() - new Date(message.timestamp).getTime(), send: 0 };
  try {
    const user = await getUser(message.sender.id);
    if (user && user.platform !== message.platform) await setPlatform(user.id, message.platform);
    const content = message.content;
    // Telegram sends a photo with a caption as a group: the caption's text and
    // the photo. Unpack it so the photo is handled and the caption is read.
    const parts: any[] = content.type === "group" ? (content as any).items.map((item: any) => item.content) : [content];
    const photo = parts.find((p) => p.type === "attachment" && p.mimeType?.startsWith("image/"));
    const caption: string | undefined = parts.find((p) => p.type === "text")?.text;
    const isImage = Boolean(photo);
    const isText = !isImage && caption !== undefined;
    if (user && !isText && !isImage) continue; // nothing to answer, so no typing bubble

    // The typing bubble shows while the reply is worked out (the text model
    // takes a second or two), so a slow answer doesn't look like no answer.
    // A stored photo goes out as an image; a missing one is skipped.
    // Each reply goes out on its own: one that fails (a photo the platform
    // rejects) is logged and stands in for, never stopping the rest.
    const send = async (reply: Reply) => {
      const at = Date.now();
      try {
        await sendReply(reply);
      } catch (err) {
        console.error(`a reply to message ${message.id} failed to send`, err);
        if (typeof reply !== "string") await space.send("(I couldn't send that photo here. It's on your wardrobe page.)").catch(() => {});
      }
      timing.send += Date.now() - at;
    };
    const sendReply = async (reply: Reply) => {
      if (typeof reply === "string") return void (await space.send(reply));
      if ("image" in reply) return void (await space.send(attachment(Buffer.from(reply.image), { name: reply.name, mimeType: reply.mimeType })));
      const stored = await photoAt(reply.photo);
      if (!stored) return;
      const photo = fitForChat(stored.image, stored.mimeType); // big phone photos are too big for chats
      const name = `fit-check.${photo.mimeType.split("/")[1] ?? "jpg"}`;
      await space.send(attachment(Buffer.from(photo.image), { name, mimeType: photo.mimeType }));
    };

    const workStarted = Date.now();
    const later = await withTyping(space, async () => {
      let replies: Reply[];
      let later: (() => Promise<Reply[]>) | undefined;
      if (!user) {
        const created = await createUser(message.sender!.id, message.platform);
        // A first message that's a link code ("link 482913") links right away instead of onboarding.
        if (isText && /^link\s+\d{6}$/i.test(caption!.trim())) {
          ({ replies, later } = await handleTextMessage(created, caption!));
        } else {
          replies = startOnboarding(message.sender!.id, isText ? caption : undefined);
        }
      } else if (isImage) {
        ({ replies, later } = await handlePhoto(user, await photo.read(), photo.mimeType, caption));
      } else if (isText) {
        ({ replies, later } = await handleTextMessage(user, caption!));
      } else {
        return undefined;
      }
      timing.work = Date.now() - workStarted;
      for (const reply of replies) await send(reply);
      return later;
    }, timing);
    logTiming(message.id, timing);

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
