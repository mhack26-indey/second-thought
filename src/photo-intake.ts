import type { Db } from "./db/client.ts";
import { today as localToday, isDate } from "./closet/dates.ts";
import { type PhotoExtraction, extractPhoto } from "./closet/extract.ts";
import { type ParsedOrder, parseOrder } from "./closet/order.ts";
import { type Item, deleteOutfit } from "./closet/repo.ts";
import type { ImageInput } from "./closet/vlm.ts";
import { type Matcher, ingestCloset, ingestOutfit, visionMatcher } from "./ingest.ts";
import { intakeOrder, orderReply } from "./orders.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import type { RecentFitCheck, Reply } from "./shopping-mode.ts";

// The slow half of a photo (shopping-mode.ts handles the "do I have this?"
// photos before they get here). The photo was saved as a fit check; one
// extraction call reads its items and what kind of photo it is. An order
// screenshot comes back out of the fit checks and goes to order intake; a
// product photo comes back out and gets the shopping match, since it's almost
// always "do I have this?"; a closet dump (a rail, a pile, a drawer) comes back
// out and its items go into the closet with no wears, keeping the photo; a fit
// check is ingested as the one it was saved as. Photos sent in closet mode
// skip the fit check altogether (readClosetPhoto).

export interface PhotoDeps {
  db: Db;
  extract?: (image: ImageInput) => Promise<PhotoExtraction>;
  parseOrder?: (image: ImageInput) => Promise<ParsedOrder>;
  matcher?: (image: ImageInput) => Matcher;
  today?: () => string;
  name?: string; // their first name, for "Nice fit, Sam."
  /** The shopping match and its replies (ShoppingMode.match). */
  shop: (userId: string, image: ImageInput, seen: ExtractedItem[]) => Promise<Reply[]>;
}

export async function readPhoto(
  userId: string,
  outfit: { id: number; photoUrl: string },
  image: ImageInput,
  fit: RecentFitCheck,
  deps: PhotoDeps,
): Promise<Reply[]> {
  // The photo is already saved, so a vision failure only costs the item list.
  let photo: PhotoExtraction;
  try {
    photo = await (deps.extract ?? extractPhoto)(image);
  } catch (err) {
    console.error(`item extraction failed for outfit ${outfit.id}`, err);
    if (fit.cancelled) return [];
    return ["I couldn't make out the items in that one, but the photo is saved."];
  }

  if (photo.kind === "closet_dump" && !fit.cancelled) {
    fit.notFitCheck = true; // so "do I have this?" can't take it back
    await deleteOutfit(deps.db, userId, outfit.id); // nothing was worn
    await fit.notToday?.().catch((err) => console.error(`un-counting outfit ${outfit.id} failed`, err));
    return closetItems(userId, outfit.photoUrl, image, photo.items, deps);
  }

  if (photo.kind !== "fit_check" && !fit.cancelled) {
    fit.notFitCheck = true; // so "do I have this?" can't take it back again
    await deleteOutfit(deps.db, userId, outfit.id);
    await fit.cleanup?.().catch((err) => console.error(`cleanup for outfit ${outfit.id} failed`, err));
    if (photo.kind === "order_screenshot") return oneAtATime(userId, () => readOrder(userId, image, deps));
    return [
      photo.listing
        ? `That looks like a listing for "${photo.listing}", so I checked your closet for it instead of saving a fit check.`
        : "That looks like a product photo, so I checked your closet instead of saving it as a fit check.",
      ...(await deps.shop(userId, image, photo.items)),
    ];
  }

  fit.seen = photo.items;
  if (fit.cancelled) return []; // it turned out to be a shopping photo
  const seen = photo.items;
  if (!seen.length) return ["I couldn't spot any clothes in that photo."];

  const matcher = (deps.matcher ?? ((img) => visionMatcher(img)))(image);
  const result = await oneAtATime(userId, async () =>
    fit.cancelled ? undefined : ingestOutfit(deps.db, userId, outfit, seen, matcher),
  );
  if (!result) return [];
  const { worn, added } = result;
  const lines = [deps.name ? `Nice fit, ${deps.name}. Saved your fit check.` : "Saved your fit check."];
  if (worn.length) lines.push(`Wearing: ${worn.map(itemName).join(", ")}.`);
  if (added.length) lines.push(`New to your closet: ${added.map(itemName).join(", ")}.`);
  return [lines.join(" ")];
}

/**
 * A photo sent in closet mode: read as a closet dump whatever the model
 * thinks it is, since they said that's what they're sending. The photo is
 * already stored (for the items' pictures); no outfit is made.
 */
export async function readClosetPhoto(userId: string, photoUrl: string, image: ImageInput, deps: PhotoDeps): Promise<Reply[]> {
  let photo: PhotoExtraction;
  try {
    photo = await (deps.extract ?? extractPhoto)(image);
  } catch (err) {
    console.error(`item extraction failed for closet photo ${photoUrl}`, err);
    return ["I couldn't make out the clothes in that one. Try another photo?"];
  }
  return closetItems(userId, photoUrl, image, photo.items, deps);
}

async function closetItems(userId: string, photoUrl: string, image: ImageInput, seen: ExtractedItem[], deps: PhotoDeps): Promise<Reply[]> {
  if (!seen.length) return ["I couldn't spot any clothes in that photo."];
  const matcher = (deps.matcher ?? ((img) => visionMatcher(img)))(image);
  const { had, added } = await oneAtATime(userId, () => ingestCloset(deps.db, userId, photoUrl, seen, matcher));
  return [closetReply(added, had)];
}

const SHORT_LIST = 6;

/** "Added 6 items: black jeans, … 2 you already had." */
export function closetReply(added: Item[], had: Item[]): string {
  const already = had.length ? ` ${had.length} you already had.` : "";
  if (!added.length) return `Nothing new: ${had.length === 1 ? "you already had it" : `you already had all ${had.length}`}.`;
  const names = added.slice(0, SHORT_LIST).map(itemName);
  const more = added.length > SHORT_LIST ? ` and ${added.length - SHORT_LIST} more` : "";
  return `Added ${added.length} item${added.length === 1 ? "" : "s"}: ${names.join(", ")}${more}.${already}`;
}

async function readOrder(userId: string, image: ImageInput, deps: PhotoDeps): Promise<string[]> {
  let order: ParsedOrder;
  try {
    order = await (deps.parseOrder ?? parseOrder)(image);
  } catch (err) {
    console.error(`order parsing failed for ${userId}`, err);
    return ["That looks like an order, but I couldn't read it. Try a screenshot that shows the items and prices?"];
  }
  const today = (deps.today ?? localToday)();
  const orderDate = isDate(order.order_date) && order.order_date <= today ? order.order_date : today;
  const matcher = (deps.matcher ?? ((img) => visionMatcher(img)))(image);
  const result = await intakeOrder(deps.db, userId, order, { orderDate, matcher });
  return [orderReply(result, today)];
}

// Two photos sent back to back extract in parallel, but their closet writes
// run in order; otherwise both could add the same new jacket.
const userQueues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const run = (userQueues.get(userId) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => {});
  userQueues.set(userId, tail);
  void tail.then(() => {
    if (userQueues.get(userId) === tail) userQueues.delete(userId);
  });
  return run;
}

/** "black jeans"; skips colors a texted item never mentioned. */
function itemName(item: Item): string {
  return item.color_primary === "unknown" ? item.type : `${item.color_primary} ${item.type}`;
}
