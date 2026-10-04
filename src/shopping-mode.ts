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
/** A reply: text, a stored photo (by its /photos URL), or a generated image (the recap card). */
export type Reply = string | { photo: string } | { image: Uint8Array; name: string; mimeType: string };

export interface BotReply {
  replies: Reply[]; // send now
  later?: () => Promise<Reply[]>; // slow work (the vision model); send when it's done
}

export const PENDING_MS = 5 * 60_000;
export const SKIP_WINDOW_MS = 6 * 60 * 60_000; // a shopping trip

const SKIP = /^(?:yes,? )?(?:skip|skipping|skipped|i'?ll skip(?: it)?|i'?m skipping(?: it)?|pass|i'?ll pass|not buying(?: it)?|nah,? skip(?:ping)?(?: it)?)$/;
const BUY = /^(?:buy|buying(?: it)?|i'?m buying(?: it)?|i'?ll buy(?: it)?|getting it|i'?m getting it|bought it(?: anyway)?|got it anyway)$/;
export const UNDO_MS = 2 * 60_000;

// Whole-message phrasings only, so "remind me to go shopping" stays a reminder
// and "do I have black jeans?" stays a closet question.
const ASKS = [
  /^(?:wait,? |so |ok,? |hey,? )?(?:do|did) i (?:already )?(?:have|own)(?: (?:something|anything|one|smth))?(?: (?:like|similar(?: to)?))? (?:this|that|these|it)(?: one)?(?: already)?$/,
  /^(?:i'?m |im )?(?:out )?shopping(?: mode)?(?: rn| right now| now)?$/,
  /^(?:i'?m |im )?checking (?:something|smth|this|on something)(?: out)?$/,
];

// A caption on a photo (Telegram sends them together) asks more loosely than a
// standalone text: "is this a dupe?", "thinking about getting these".
const CAPTION_ASK = /\b(?:do i (?:already )?(?:have|own)|already (?:have|own)|dupe|should i (?:buy|get)|thinking (?:of|about) (?:buying|getting)|want to (?:buy|get)|worth (?:buying|it)|shopping|in (?:the )?store)\b/;

/** A photo caption that means "check this against my closet" rather than "log my fit check". */
export function isShoppingCaption(caption: string): boolean {
  return isShoppingAsk(caption) || CAPTION_ASK.test(caption.toLowerCase());
}

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
  cleanup?: () => Promise<void>; // what the closet tables don't hold (the stored photo, today's fit check)
  notToday?: () => Promise<void>; // just un-count it as today's fit check, keeping the photo
}

type MatchDeps = NonNullable<Parameters<typeof matchShoppingPhoto>[3]>;

export class ShoppingMode {
  private pending = new Map<string, number>(); // user -> window closes at
  // After a match: the owned item it matched, until they say whether they're skipping it.
  private skipQuestions = new Map<string, { itemId: number; asked: number }>();
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
    // A match is a suggestion to skip, not a skip: it counts once they say so (answerSkip).
    const top = result.matches[0];
    if (top) this.skipQuestions.set(userId, { itemId: top.item_id, asked: this.now() });
    return shoppingReplies(result, new Date(this.now()));
  }

  /**
   * Their answer to "Skip it?": "skip" counts it as a skipped purchase,
   * "buying it" doesn't. Anything else leaves the question open (for the length
   * of a shopping trip). Undefined if there's no question or it isn't an answer.
   */
  async answerSkip(userId: string, text: string): Promise<string | undefined> {
    const question = this.skipQuestions.get(userId);
    if (!question || this.now() - question.asked > SKIP_WINDOW_MS) return undefined;
    const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
    if (SKIP.test(t)) {
      this.skipQuestions.delete(userId);
      await recordAvoided(this.deps.db, userId, question.itemId, new Date(this.now()));
      return `Counted. Nice skip. (Text "my impact" to see your total.)`;
    }
    if (BUY.test(t)) {
      this.skipQuestions.delete(userId);
      return "Got it, I won't count that one.";
    }
    return undefined;
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
  // Then: skip it? With what skipping a new one of the matched kind saves (an estimate; footprint.ts).
  replies.push(skipLine(result.matches[0]!.type));
  return replies;
}

/** "September", or "September 2025" for an earlier year. */
function month(d: Date, now: Date): string {
  const name = d.toLocaleDateString("en-US", { month: "long" });
  return d.getFullYear() === now.getFullYear() ? name : `${name} ${d.getFullYear()}`;
}
