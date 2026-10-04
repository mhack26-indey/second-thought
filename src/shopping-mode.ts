import type { Db } from "./db/client.ts";
import { skipLine } from "./footprint.ts";
import { formatDay } from "./closet/dates.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { deleteOutfit } from "./closet/repo.ts";
import { recordAvoided } from "./impact.ts";
import { type ShoppingResult, matchShoppingPhoto } from "./closet/shopping.ts";
import type { ImageInput } from "./closet/vlm.ts";

// "Do I already have this?" in the chat. Photos and texts arrive as separate
// messages, so the bot can't see the question and the photo together:
// - text first: the ask opens a 5-minute window, and the next photo is
//   matched instead of saved as a fit check;
// - photo first: it was saved as a fit check, so an ask within 2 minutes
//   takes that fit check back out and matches the same photo.
// State is in memory: a restart only loses an open window.

/** A reply is text, or a stored photo (by its /photos URL) sent as an image. */
export type Reply = string | { photo: string };

export interface BotReply {
  replies: Reply[]; // send now
  later?: () => Promise<Reply[]>; // slow work (the vision model); send when it's done
}

export const PENDING_MS = 5 * 60_000;
export const UNDO_MS = 2 * 60_000;

// Whole-message phrasings only, so "remind me to go shopping" stays a reminder
// and "do I have black jeans?" stays a closet question.
const ASKS = [
  /^(?:wait,? |so |ok,? |hey,? )?(?:do|did) i (?:already )?(?:have|own)(?: (?:something|anything|one|smth))?(?: (?:like|similar(?: to)?))? (?:this|that|these|it)(?: one)?(?: already)?$/,
  /^(?:i'?m |im )?(?:out )?shopping(?: mode)?(?: rn| right now| now)?$/,
  /^(?:i'?m |im )?checking (?:something|smth|this|on something)(?: out)?$/,
];

export function isShoppingAsk(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  return ASKS.some((re) => re.test(t));
}

/** A fit check that a "do I have this?" right after it can still take back. */
export interface RecentFitCheck {
  outfitId: number;
  image: ImageInput;
  at: number; // epoch ms
  cancelled: boolean; // set on undo; the fit check's ingest checks it
  notFitCheck?: boolean; // an order screenshot or product photo, so there's no fit check to take back
  seen?: ExtractedItem[]; // what the fit check read, so the match needn't read it again
  work?: Promise<unknown>; // the fit check's vision work, while it runs
  cleanup?: () => Promise<void>; // what the closet tables don't hold (the stored photo)
}

type MatchDeps = NonNullable<Parameters<typeof matchShoppingPhoto>[3]>;

export class ShoppingMode {
  private pending = new Map<string, number>(); // user -> window closes at
  private recent = new Map<string, RecentFitCheck>();

  constructor(private deps: { db: Db; now?: () => number; match?: MatchDeps }) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Handles a "do I have this?" text; undefined for any other text. */
  onText(userId: string, text: string): BotReply | undefined {
    if (!isShoppingAsk(text)) return undefined;
    const fit = this.recent.get(userId);
    this.recent.delete(userId);
    if (fit && !fit.notFitCheck && this.now() - fit.at <= UNDO_MS) {
      fit.cancelled = true;
      return { replies: [], later: () => this.undoAndMatch(userId, fit) };
    }
    this.pending.set(userId, this.now() + PENDING_MS);
    return { replies: ["Send me the photo."] };
  }

  /** True, once, if they asked "do I have this?" in the last 5 minutes. */
  takePending(userId: string): boolean {
    const until = this.pending.get(userId);
    this.pending.delete(userId);
    return until !== undefined && this.now() <= until;
  }

  fitCheckSaved(userId: string, fit: RecentFitCheck): void {
    this.recent.set(userId, fit);
  }

  /**
   * Matches a shopping photo against the closet. Nothing goes in the closet;
   * a match counts as a purchase skipped for the impact counter (impact.ts).
   */
  async match(userId: string, image: ImageInput, seen?: ExtractedItem[]): Promise<Reply[]> {
    const deps = seen ? { ...this.deps.match, extract: async () => seen } : this.deps.match;
    let result: ShoppingResult;
    try {
      result = await matchShoppingPhoto(this.deps.db, userId, image, deps);
    } catch (err) {
      console.error(`shopping match failed for ${userId}`, err);
      return ["I couldn't make out that photo. Try another one?"];
    }
    const top = result.matches[0];
    if (top) {
      await recordAvoided(this.deps.db, userId, top.item_id, new Date(this.now())).catch((err) =>
        console.error(`impact event for ${userId} failed`, err),
      );
    }
    return shoppingReplies(result, new Date(this.now()));
  }

  private async undoAndMatch(userId: string, fit: RecentFitCheck): Promise<Reply[]> {
    // Let a running ingest finish first, or it could add items after the delete.
    await fit.work?.catch(() => {});
    await deleteOutfit(this.deps.db, userId, fit.outfitId);
    await fit.cleanup?.().catch((err) => console.error(`cleanup for outfit ${fit.outfitId} failed`, err));
    return ["Got it, that's not a fit check. I took it back out.", ...(await this.match(userId, fit.image, fit.seen))];
  }
}

export function shoppingReplies(result: ShoppingResult, now = new Date()): Reply[] {
  if (!result.seen.length) return ["I couldn't spot any clothes in that photo."];
  if (!result.matches.length) {
    const query = encodeURIComponent(result.seen[0]!.description);
    return [`Nothing like it in your closet.\nSecondhand: https://www.depop.com/search/?q=${query}`];
  }
  const lines = result.matches.map((m) => {
    const returnable = m.returnable_until ? `, still returnable until ${formatDay(m.returnable_until)}` : "";
    return `• ${m.description}: ${m.reason} (since ${month(m.owned_since, now)}${returnable})`;
  });
  const replies: Reply[] = [[`You already have ${result.matches.length} like this:`, ...lines].join("\n")];
  const photo = result.matches[0]!.photo_url;
  if (photo) replies.push({ photo });
  // Then what not buying it saves, for the item type in the shopping photo (an estimate; footprint.ts).
  const skip = skipLine(result.seen[0]!.type);
  if (skip) replies.push(skip);
  return replies;
}

/** "September", or "September 2025" for an earlier year. */
function month(d: Date, now: Date): string {
  const name = d.toLocaleDateString("en-US", { month: "long" });
  return d.getFullYear() === now.getFullYear() ? name : `${name} ${d.getFullYear()}`;
}
