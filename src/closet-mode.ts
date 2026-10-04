import type { Db } from "./db/client.ts";
import { activeItems } from "./closet/repo.ts";
import type { BotReply } from "./shopping-mode.ts";

// Closet mode: building the closet fast from photos of clothes nobody is
// wearing (a rail, a pile on the bed, a drawer). "add my closet" opens a
// 10-minute window in which every photo is read as a closet dump, whatever
// the model thinks it is; "done" closes it early, and the scheduler closes it
// when time's up. Onboarding opens one too, with the offer, where "skip"
// closes it quietly. In memory: a restart just closes open windows.

export const CLOSET_MODE_MS = 10 * 60_000;

export const CLOSET_OFFER = "Want to add your closet now? Send a few photos of your closet or a pile of clothes, or skip.";
const STARTED =
  'Closet mode for the next 10 minutes: send photos of your closet rail, a drawer or a pile of clothes, as many as you like. Text "done" when you\'re finished.';
const SKIPPED = "No problem. Send a fit check whenever you get dressed and I'll start tracking what you actually wear.";

export const closetSummary = (n: number) =>
  `Your closet has ${n} item${n === 1 ? "" : "s"}. Send a fit check whenever you get dressed and I'll start tracking what you actually wear.`;

const START = /^(?:add (?:my )?(?:closet|clothes|wardrobe)|closet ?dump|dump my closet|closet mode)$/;
const DONE = /^(?:done|i'?m done|all done|finished|that'?s (?:it|all))$/;
const SKIP = /^(?:skip|no thanks|no thank you|not now|later|maybe later|nah|no)$/;

const normalize = (text: string) => text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
export const isClosetModeStart = (text: string) => START.test(normalize(text));

interface Window {
  until: number;
  onboarding: boolean; // opened by the onboarding offer, so "skip" applies
  work: Promise<unknown>[]; // photos still being read
}

export class ClosetMode {
  private windows = new Map<string, Window>();

  constructor(private deps: { db: Db; now?: () => number }) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(userId: string, opts: { onboarding?: boolean } = {}): void {
    this.windows.set(userId, { until: this.now() + CLOSET_MODE_MS, onboarding: opts.onboarding ?? false, work: [] });
  }

  /** The onboarding offer, which opens closet mode for the reply. */
  offer(userId: string): string {
    this.start(userId, { onboarding: true });
    return CLOSET_OFFER;
  }

  active(userId: string): boolean {
    const window = this.windows.get(userId);
    return window !== undefined && this.now() <= window.until;
  }

  /** Keeps a photo's reading on the window, so the summary waits for it. */
  track<T>(userId: string, work: Promise<T>): Promise<T> {
    this.windows.get(userId)?.work.push(work);
    return work;
  }

  /** "add my closet", "done", or "skip" after the offer; undefined for anything else. */
  onText(userId: string, text: string): BotReply | undefined {
    const t = normalize(text);
    if (START.test(t)) {
      this.start(userId);
      return { replies: [STARTED] };
    }
    const window = this.windows.get(userId);
    if (!window || !this.active(userId)) return undefined;
    if (DONE.test(t) || (window.onboarding && SKIP.test(t))) {
      this.windows.delete(userId);
      // Later, so the count includes photos still being read.
      return { replies: [], later: () => this.summary(userId, window) };
    }
    return undefined;
  }

  /** Windows whose 10 minutes are up, closed, with the summary each gets. */
  async expired(): Promise<{ userId: string; text: string }[]> {
    const done = [...this.windows].filter(([, w]) => this.now() > w.until);
    for (const [userId] of done) this.windows.delete(userId);
    return Promise.all(done.map(async ([userId, w]) => ({ userId, text: (await this.summary(userId, w))[0]! })));
  }

  private async summary(userId: string, window: Window): Promise<string[]> {
    await Promise.allSettled(window.work);
    if (window.onboarding && !window.work.length) return [SKIPPED];
    return [closetSummary((await activeItems(this.deps.db, userId)).length)];
  }
}
