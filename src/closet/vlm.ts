import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";

// Thin wrapper around the vision model: image(s) + prompt in, schema-validated
// JSON out. Every closet call (extract, dedup, match) goes through `vlmJson`.
//
// Calls go through OpenRouter's OpenAI-compatible API, which serves Gemini
// without the free tier's 20-requests-a-day cap. Any vision model there that
// supports structured outputs works; set VISION_MODEL to switch.

const BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = process.env.VISION_MODEL ?? "google/gemini-3.8-flash";

/** Photos are only read when a key is configured. */
export function visionEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

// HEIC/HEIF is what iPhones send; Gemini accepts it as is.
export type MediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/heic"
  | "image/heif";

/** An image as the messaging layer hands it to us: a URL or base64 data. */
export type ImageInput =
  | { url: string }
  | { base64: string; mediaType: MediaType };

const EXT_MEDIA_TYPES: Record<string, MediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function isSupportedImageFile(path: string): boolean {
  return extname(path).toLowerCase() in EXT_MEDIA_TYPES;
}

export async function imageFromFile(path: string): Promise<ImageInput> {
  const mediaType = EXT_MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported image type: ${path}`);
  const data = await readFile(path);
  return { base64: data.toString("base64"), mediaType };
}

/** Accepts a URL, a `data:image/...;base64,` URL, or an ImageInput. */
export function toImageInput(image: string | ImageInput): ImageInput {
  if (typeof image !== "string") return image;
  const dataUrl = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (dataUrl) {
    return { base64: dataUrl[2]!, mediaType: dataUrl[1] as MediaType };
  }
  return { url: image };
}

// Images are always sent inline: photo URLs point at our own server, which is
// often a LAN address the model provider can't reach.
async function imageDataUrl(image: ImageInput): Promise<string> {
  if ("base64" in image) return `data:${image.mediaType};base64,${image.base64}`;
  const res = await fetch(image.url);
  if (!res.ok) throw new VlmError(`Image fetch failed (${res.status}): ${image.url}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  return `data:${mimeType};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/** Downloads a photo URL into an inline image, e.g. to check it loads before a call. */
export async function loadImage(url: string): Promise<ImageInput> {
  const match = (await imageDataUrl({ url })).match(/^data:([^;]+);base64,(.*)$/s);
  return { base64: match![2]!, mediaType: match![1] as MediaType };
}

export class VlmError extends Error {}

const MAX_RETRIES = 4;
// Vertex comparisons with several photos took up to ~33s in testing; they run
// in the background after the first reply, so allow plenty of headroom.
const REQUEST_TIMEOUT_MS = 90_000;

// Rate limits and provider hiccups (429, 5xx) are retried, honoring
// Retry-After when it's short, else backing off 2s, 4s, 8s, 16s.
async function postWithBackoff(body: unknown): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new VlmError("OPENROUTER_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new VlmError(`Vision model ${res.status}: ${text.slice(0, 500)}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = retryAfter > 0 && retryAfter <= 30 ? retryAfter * 1000 : 2_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * Sends images + prompt and returns output validated against `schema`.
 * JSON output is forced via a response schema, a fixed seed keeps the same
 * photo giving the same answer where possible, and invalid output is retried once.
 */
export async function vlmJson<T extends z.ZodType>(opts: {
  schema: T;
  images: ImageInput[];
  prompt: string;
  system?: string;
  effort?: "low" | "medium" | "high";
  model?: string;
}): Promise<z.infer<T>> {
  const images = await Promise.all(opts.images.map(imageDataUrl));
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(opts.schema);
  const body = {
    model: opts.model ?? MODEL,
    // Vertex doesn't take temperature for Gemini here; a fixed seed keeps
    // answers as repeatable as it allows.
    seed: 0,
    reasoning: { effort: opts.effort ?? "low" },
    response_format: {
      type: "json_schema",
      json_schema: { name: "answer", strict: true, schema: jsonSchema },
    },
    // Google Vertex only, priority tier: plain "google-vertex" also allows the
    // discounted flex tier, which queues requests (15-18s for a small call in
    // testing) and pushed fit check comparisons toward the 60s timeout.
    provider: { only: ["google-vertex/global/priority"], require_parameters: true },
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      {
        role: "user",
        content: [
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: opts.prompt },
        ],
      },
    ],
  };

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await postWithBackoff(body);
    const choice = response.choices?.[0];
    const content: unknown = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      lastProblem = `empty response (finish_reason=${choice?.finish_reason}, error=${JSON.stringify(response.error ?? null)})`;
      continue;
    }
    try {
      const parsed = opts.schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
      lastProblem = `schema mismatch: ${parsed.error.message}`;
    } catch {
      lastProblem = `invalid JSON (finish_reason=${choice?.finish_reason})`;
    }
  }
  throw new VlmError(`Vision model output failed twice: ${lastProblem}`);
}
