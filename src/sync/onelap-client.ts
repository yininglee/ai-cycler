import { createHash, randomBytes } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "../parsers/parser-utils.ts";

const ORIGIN = "https://u.onelap.cn";
const RECORDS = "/api/otm/ride_record";
const PAGE_SIZE = 20;
const MAX_PAGES = 3;
type JsonObject = Record<string, unknown>;

export class OneLapError extends Error {
  readonly code: "authorization" | "rate_limit" | "upstream" | "protocol";
  readonly retryAt?: number;

  constructor(code: OneLapError["code"], retryAt?: number) {
    super(code);
    this.code = code;
    this.retryAt = retryAt;
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function fitUrl(value: unknown, depth = 0): string | undefined {
  const row = object(value);
  if (!row || depth > 5) return undefined;
  for (const key of ["fitUrl", "fit_url", "fitKey"]) {
    const field = row[key];
    if (typeof field === "string" && field.trim() && field.length <= 2048) return field.trim();
  }
  for (const field of Object.values(row)) {
    const match = fitUrl(field, depth + 1);
    if (match) return match;
  }
}

async function readBytes(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) throw new OneLapError("protocol");
  if (Number(response.headers.get("content-length")) > max) {
    await response.body.cancel();
    throw new OneLapError("protocol");
  }
  const reader = response.body.getReader();
  const buffers: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new OneLapError("protocol");
      }
      buffers.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(buffers, size);
}

export function createOneLapClient(config: { token: string; signingKey: string; cookie?: string }, signal: AbortSignal, fetchImpl = fetch) {
  async function request(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetchImpl(`${ORIGIN}${path}`, {
        ...init,
        headers: { Authorization: config.token, Origin: ORIGIN, Referer: `${ORIGIN}/recordPage`, ...(config.cookie ? { Cookie: config.cookie } : {}), ...init?.headers },
        redirect: "manual", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      });
    } catch { throw new OneLapError("upstream"); }
    if (response.ok) return response;
    await response.body?.cancel();
    if ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400 && new URL(response.headers.get("location") ?? ORIGIN, ORIGIN).pathname === "/login")) throw new OneLapError("authorization");
    if (response.status === 429) {
      const value = response.headers.get("retry-after");
      const now = Date.now();
      const retryAt = value && /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value ?? "");
      throw new OneLapError("rate_limit", Number.isFinite(retryAt) ? Math.max(now + 60_000, retryAt) : now + 30 * 60_000);
    }
    throw new OneLapError(response.status >= 500 ? "upstream" : "protocol");
  }

  async function json(path: string, init?: RequestInit) {
    const response = await request(path, init);
    if (response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      throw new OneLapError("authorization");
    }
    const bytes = await readBytes(response, 2 * 1024 * 1024);
    let row: JsonObject | undefined;
    try { row = object(JSON.parse(new TextDecoder().decode(bytes))); } catch { /* Contract mismatch. */ }
    if (!row) throw new OneLapError("protocol");
    if ([401, 403, "401", "403"].includes(row.code as number | string)) throw new OneLapError("authorization");
    return row;
  }

  return {
    async *activities() {
      const seen = new Set<string>();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const nonce = randomBytes(8).toString("hex");
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = createHash("md5").update(`limit=${PAGE_SIZE}&nonce=${nonce}&page=${page}&timestamp=${timestamp}&key=${config.signingKey}`).digest("hex");
        const data = object((await json(`${RECORDS}/list`, {
          method: "POST", body: JSON.stringify({ page, limit: PAGE_SIZE }),
          headers: { "Content-Type": "application/json", nonce, timestamp, sign },
        })).data);
        if (!Array.isArray(data?.list) || data.list.length > PAGE_SIZE) throw new OneLapError("protocol");
        for (const value of data.list) {
          const row = object(value);
          const id = row?._id ?? row?.id ?? row?.record_id;
          if ((typeof id !== "string" && typeof id !== "number") || !/^[\w-]{1,128}$/.test(String(id))) throw new OneLapError("protocol");
          const activityId = String(id);
          if (seen.has(activityId)) continue;
          seen.add(activityId);
          yield { id: activityId, url: fitUrl(row) };
        }
        const pages = Number(data.pages);
        if (data.list.length === 0 || (pages > 0 ? page >= pages : data.list.length < PAGE_SIZE)) break;
      }
    },
    async download(activity: { id: string; url?: string }) {
      const url = activity.url ?? fitUrl(await json(`${RECORDS}/analysis/${encodeURIComponent(activity.id)}`));
      if (!url) throw new OneLapError("protocol");
      // fitUrl is a file identifier for the vendor endpoint. Never fetch it as a URL.
      const key = encodeURIComponent(Buffer.from(url, "utf8").toString("base64"));
      return readBytes(await request(`${RECORDS}/analysis/fit_content/${key}`), MAX_UPLOAD_BYTES);
    },
  };
}
