import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { z } from "zod";

// Thin wrapper around the vision model: image(s) + prompt in, schema-validated
// JSON out. Every closet call (extract, dedup, match) goes through `vlmJson`.

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new VlmError("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

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

// Gemini only takes inline bytes (or its own Files API), so URLs are fetched.
async function imagePart(image: ImageInput): Promise<Part> {
  if ("base64" in image) {
    return { inlineData: { mimeType: image.mediaType, data: image.base64 } };
  }
  const res = await fetch(image.url);
  if (!res.ok) throw new VlmError(`Image fetch failed (${res.status}): ${image.url}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { inlineData: { mimeType, data } };
}

export class VlmError extends Error {}

const MAX_RETRIES = 4;
// Longer suggested waits mean a daily quota is exhausted; fail instead of hanging.
const MAX_RETRY_WAIT_MS = 90_000;

// The free tier allows only a few requests per minute, and the model sometimes
// returns 503 under load. On 429 we wait the delay the API suggests (or 15s);
// on 5xx we back off 5s, 10s, 20s, 40s.
async function generateWithBackoff(
  params: GenerateContentParameters,
): Promise<GenerateContentResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getClient().models.generateContent(params);
    } catch (err) {
      const retryable = err instanceof ApiError && (err.status === 429 || err.status >= 500);
      if (!retryable || attempt >= MAX_RETRIES) throw err;
      const waitMs = err.status === 429 ? suggestedRetryMs(err.message) : 5_000 * 2 ** attempt;
      if (waitMs > MAX_RETRY_WAIT_MS) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

// 429 bodies carry RetryInfo, e.g. "retryDelay":"23703s".
function suggestedRetryMs(message: string): number {
  const delay = message.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  return delay ? Math.ceil(Number(delay[1]) * 1000) + 1000 : 15_000;
}

/**
 * Sends images + prompt and returns output validated against `schema`.
 * JSON output is forced via a response schema, temperature is 0 so the same
 * photo gives the same answer, and invalid output is retried once.
 */
export async function vlmJson<T extends z.ZodType>(opts: {
  schema: T;
  images: ImageInput[];
  prompt: string;
  system?: string;
}): Promise<z.infer<T>> {
  const parts: Part[] = [
    ...(await Promise.all(opts.images.map(imagePart))),
    { text: opts.prompt },
  ];
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(opts.schema);

  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await generateWithBackoff({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...(opts.system ? { systemInstruction: opts.system } : {}),
      },
    });

    const finish = response.candidates?.[0]?.finishReason;
    if (!response.text) {
      lastProblem = `empty response (finishReason=${finish}, block=${response.promptFeedback?.blockReason})`;
      continue;
    }
    try {
      const parsed = opts.schema.safeParse(JSON.parse(response.text));
      if (parsed.success) return parsed.data;
      lastProblem = `schema mismatch: ${parsed.error.message}`;
    } catch {
      lastProblem = `invalid JSON (finishReason=${finish})`;
    }
  }
  throw new VlmError(`VLM output failed twice: ${lastProblem}`);
}
