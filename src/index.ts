import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { fitCheckPrompt, handlePhoto, handleText, startOnboarding } from "./flows.ts";
import { DEFAULT_FIT_CHECK_HOUR, PHOTO_DIR, allUsers, createUser, getUser, localDate, save } from "./store.ts";
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

async function sendDueReminders() {
  const now = new Date();
  const today = localDate(now);
  for (const user of allUsers()) {
    for (const reminder of user.reminders) {
      if (reminder.sent || reminder.at > now.getTime()) continue;
      reminder.sent = true; // mark first so a slow send can't double-fire
      try {
        await sendTo(user.id, `Reminder: ${reminder.text}`);
      } catch (err) {
        reminder.sent = false; // retry on the next tick
        console.error(`reminder ${reminder.id} for ${user.id} failed`, err);
      }
    }

    const hour = user.fitCheckHour === undefined ? DEFAULT_FIT_CHECK_HOUR : user.fitCheckHour;
    if (user.step !== "done" || hour === null) continue;
    const hoursPast = now.getHours() - hour;
    if (hoursPast < 0 || hoursPast >= FIT_CHECK_WINDOW_HOURS) continue;
    if (user.lastFitPing === today || user.lastFitPhoto === today) continue;
    user.lastFitPing = today; // mark first so a slow send can't double-fire
    try {
      await sendTo(user.id, fitCheckPrompt());
    } catch (err) {
      user.lastFitPing = undefined; // retry on the next tick
      console.error(`fit check ping for ${user.id} failed`, err);
    }
  }
  await save();
}

startWebServer();
const timer = setInterval(sendDueReminders, 15_000);
process.on("SIGINT", () => {
  clearInterval(timer);
  void app.stop().finally(() => process.exit(0));
});

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  if (message.direction === "outbound" || !message.sender) continue;

  try {
    let user = getUser(message.sender.id);
    let replies: string[];

    if (!user) {
      user = createUser(message.sender.id);
      await save();
      replies = startOnboarding();
    } else if (message.content.type === "text") {
      replies = await handleText(user, message.content.text);
    } else if (message.content.type === "attachment" && message.content.mimeType.startsWith("image/")) {
      const { content } = message;
      const file = `${crypto.randomUUID()}${extname(content.name) || ".jpg"}`;
      await mkdir(PHOTO_DIR, { recursive: true });
      await Bun.write(`${PHOTO_DIR}/${file}`, await content.read());
      replies = await handlePhoto(user, file, content.mimeType);
    } else {
      continue;
    }

    for (const reply of replies) await space.send(reply);
  } catch (err) {
    console.error(`failed handling message ${message.id}`, err);
  }
}
