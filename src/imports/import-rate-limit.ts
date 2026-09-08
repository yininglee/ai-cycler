/**
 * MVP-FOUNDATION-04：按会话（ownerId）的导入限流。
 * 进程内滑动窗口，适用于本地 Demo 与单实例部署；生产多实例需迁移到共享存储。
 * 默认 10 次 / 60 秒，可用 IMPORT_RATE_LIMIT_MAX / IMPORT_RATE_LIMIT_WINDOW_MS 覆盖。
 */

export const DEFAULT_IMPORT_RATE_LIMIT_MAX = 10;
export const DEFAULT_IMPORT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface ImportRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class ImportRateLimiter {
  readonly max: number;
  readonly windowMs: number;
  readonly #hits = new Map<string, number[]>();

  constructor(max = DEFAULT_IMPORT_RATE_LIMIT_MAX, windowMs = DEFAULT_IMPORT_RATE_LIMIT_WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  check(ownerId: string, now = Date.now()): ImportRateLimitDecision {
    const windowStart = now - this.windowMs;
    const hits = (this.#hits.get(ownerId) ?? []).filter((at) => at > windowStart);
    if (hits.length >= this.max) {
      this.#hits.set(ownerId, hits);
      const retryAfterMs = Math.max(1, hits[0]! + this.windowMs - now);
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1_000) };
    }
    hits.push(now);
    this.#hits.set(ownerId, hits);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

let singleton: ImportRateLimiter | null = null;

export function getImportRateLimiter(): ImportRateLimiter {
  if (!singleton) {
    const max = Number(process.env.IMPORT_RATE_LIMIT_MAX);
    const windowMs = Number(process.env.IMPORT_RATE_LIMIT_WINDOW_MS);
    singleton = new ImportRateLimiter(
      Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_IMPORT_RATE_LIMIT_MAX,
      Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : DEFAULT_IMPORT_RATE_LIMIT_WINDOW_MS,
    );
  }
  return singleton;
}
