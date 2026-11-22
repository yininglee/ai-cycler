import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "../parsers/parser-utils.ts";
import { readResponseBytes } from "./read-response-bytes.ts";

const origin = "https://www.imxingzhe.com";
const fitStorageOrigin = "https://xingzhe-workout.oss-cn-hangzhou.aliyuncs.com";
const callbackPath = "/api/platform/xingzhe/callback";
const tokenPath = "/oauth2/v2/access_token/";
const pageSize = 20;
const maxPages = 3;

export type XingzheCredentials = { accessToken: string; refreshToken?: string; expiresAt?: number };
export type XingzheActivity = { id: number; distance: number; start_time: number; end_time: number };

type TokenRejection = "invalid_client" | "invalid_code" | "redirect_mismatch";
type ResponseIssue = "not_json_object" | "unexpected_code" | "missing_token" | "missing_profile_id";

export class XingzheError extends Error {
  readonly code: "authorization" | "rate_limit" | "protocol" | "upstream";
  readonly retryAt?: number;
  readonly upstreamStatus?: number;
  readonly tokenRejection?: TokenRejection;
  readonly responseIssue?: ResponseIssue;
  readonly profileFields?: string[];
  readonly upstreamCode?: number;
  constructor(code: XingzheError["code"], details: {
    retryAt?: number; upstreamStatus?: number; tokenRejection?: TokenRejection;
    responseIssue?: ResponseIssue; profileFields?: string[]; upstreamCode?: number;
  } = {}) {
    super(code);
    this.code = code;
    this.retryAt = details.retryAt;
    this.upstreamStatus = details.upstreamStatus;
    this.tokenRejection = details.tokenRejection;
    this.responseIssue = details.responseIssue;
    this.profileFields = details.profileFields;
    this.upstreamCode = details.upstreamCode;
  }
}

export type XingzheConfig = { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: Buffer };
export type XingzheSetupIssue = "disabled" | "incomplete" | "invalid_callback";
type XingzheSetup = { config: XingzheConfig; issue?: never } | { config: null; issue: XingzheSetupIssue };

export function readXingzheSetup(): XingzheSetup {
  if (process.env.XINGZHE_SYNC_ENABLED !== "true") return { config: null, issue: "disabled" };
  const clientId = process.env.XINGZHE_CLIENT_ID?.trim();
  const clientSecret = process.env.XINGZHE_CLIENT_SECRET?.trim();
  const sessionSecret = process.env.SESSION_SECRET;
  const redirectUri = process.env.XINGZHE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !redirectUri) {
    return { config: null, issue: "incomplete" };
  }
  try {
    const redirect = new URL(redirectUri);
    const loopback = redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
    if ((redirect.protocol !== "https:" && !loopback) || redirect.pathname !== callbackPath
      || redirect.username || redirect.password || redirect.search || redirect.hash) return { config: null, issue: "invalid_callback" };
    const encryptionKey = createHmac("sha256", sessionSecret).update("cycler:xingzhe:credentials:v1").digest();
    return { config: { clientId, clientSecret, redirectUri: redirect.toString(), encryptionKey } };
  } catch {
    return { config: null, issue: "invalid_callback" };
  }
}

export function readXingzheConfig(): XingzheConfig | null {
  return readXingzheSetup().config;
}

export function xingzheAuthorizationUrl(config: XingzheConfig, state: string): string {
  const url = new URL("/oauth2/v2/authorize", origin);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "read", state,
  }).toString();
  return url.toString();
}

export function sealXingzheCredentials(config: XingzheConfig, owner: string, id: string, tokens: XingzheCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([owner, id])));
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function openXingzheCredentials(config: XingzheConfig, owner: string, id: string, sealed: string): XingzheCredentials {
  try {
    const data = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([owner, id])));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    throw new XingzheError("authorization");
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function profileFieldTypes(payload: Record<string, unknown>): string[] {
  const fields = ["id", "user_id", "uid", "userId", "userid", "athlete_id", "data", "user", "result"];
  const data = object(payload.data);
  return [
    ...fields.filter(key => Object.hasOwn(payload, key)).map(key => `${key}:${typeof payload[key]}`),
    ...(data ? fields.filter(key => Object.hasOwn(data, key)).map(key => `data.${key}:${typeof data[key]}`) : []),
  ];
}

function tokenRejection(payload?: Record<string, unknown>): TokenRejection | undefined {
  const error = [payload?.error, payload?.error_description, payload?.msg]
    .filter((value): value is string => typeof value === "string").join(" ");
  if (/invalid[ _-]client|client[ _-]secret|应用密钥|客户端密钥/i.test(error)) return "invalid_client";
  if (/redirect[ _-]uri|回调地址/i.test(error)) return "redirect_mismatch";
  if (/invalid[ _-](?:grant|(?:access[ _-]|authorization[ _-])?code)|code[ _-](?:invalid|expired)|授权码/i.test(error)) return "invalid_code";
  return undefined;
}

function retryTime(value: string | null): number {
  if (!value) return Date.now() + 60_000;
  if (/^\d+$/.test(value)) return Date.now() + Math.max(1, Number(value)) * 1000;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now() ? time : Date.now() + 60_000;
}

export function createXingzheClient(config: XingzheConfig, fetchImpl: typeof fetch = fetch, cancellation?: AbortSignal) {
  const timeout = () => cancellation
    ? AbortSignal.any([cancellation, AbortSignal.timeout(12_000)])
    : AbortSignal.timeout(12_000);
  const rateLimited = (response: Response) => new XingzheError("rate_limit", {
    upstreamStatus: response.status, retryAt: retryTime(response.headers.get("retry-after")),
  });
  async function send(url: URL, init: RequestInit) {
    const signal = timeout();
    try {
      signal.throwIfAborted();
      return await fetchImpl(url, { cache: "no-store", redirect: "error", ...init, signal });
    } catch {
      throw new XingzheError("upstream");
    }
  }
  async function request(path: string, authorization: string, body?: FormData) {
    const response = await send(new URL(path, origin), {
      method: body ? "POST" : "GET", body, headers: { Authorization: `Bearer ${authorization}` },
    });
    const upstreamStatus = response.status;
    if (upstreamStatus === 429) throw rateLimited(response);
    if (body && [400, 401, 403].includes(upstreamStatus)) {
      const rejection = object(await response.json().catch(() => null));
      if (rejection?.code === 429 || (rejection?.code === 400 && rejection.msg === "API Limited")) throw rateLimited(response);
      throw new XingzheError("authorization", { upstreamStatus, tokenRejection: tokenRejection(rejection) });
    }
    if ([401, 403].includes(upstreamStatus)) throw new XingzheError("authorization", { upstreamStatus });
    if (!response.ok && upstreamStatus !== 400) throw new XingzheError("upstream", { upstreamStatus });
    const payload = object(await response.json().catch(() => null));
    if (!payload) throw new XingzheError("protocol", { upstreamStatus, responseIssue: "not_json_object" });
    if (payload.code === 401 || payload.code === 403) {
      throw new XingzheError("authorization", { upstreamStatus, tokenRejection: body ? tokenRejection(payload) : undefined });
    }
    if (payload.code === 429 || (payload.code === 400 && payload.msg === "API Limited")) {
      throw rateLimited(response);
    }
    if (body && typeof payload.error === "string" && payload.error.trim()) {
      throw new XingzheError("authorization", { upstreamStatus, tokenRejection: tokenRejection(payload) });
    }
    if (!response.ok) throw new XingzheError("upstream", { upstreamStatus });
    if (typeof payload.code === "number" && payload.code !== 0 && payload.code !== 200) {
      const upstreamCode = Number.isInteger(payload.code) && payload.code >= 100 && payload.code < 600 ? payload.code : undefined;
      throw new XingzheError("protocol", { upstreamStatus, responseIssue: "unexpected_code", upstreamCode });
    }
    return payload;
  }

  async function token(fields: Record<string, string>, refreshToken?: string): Promise<XingzheCredentials> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const payload = await request(tokenPath, `${config.clientId}:${config.clientSecret}`, form);
    const validToken = (val: unknown): val is string => typeof val === "string" && /^[\x21-\x7e]{1,4096}$/.test(val);
    if (!validToken(payload.access_token)) throw new XingzheError("protocol", { responseIssue: "missing_token" });
    const expiresAt = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? Date.now() + payload.expires_in * 1000
      : typeof payload.expires_at === "number" && Number.isFinite(payload.expires_at) ? payload.expires_at * 1000 : undefined;
    return {
      accessToken: payload.access_token,
      refreshToken: validToken(payload.refresh_token) ? payload.refresh_token : refreshToken,
      expiresAt,
    };
  }

  return {
    exchange(code: string) {
      return token({ code, grant_type: "authorization_code", redirect_uri: config.redirectUri });
    },
    refresh(refreshToken: string) {
      return token({ refresh_token: refreshToken, grant_type: "refresh_token" }, refreshToken);
    },
    async accountId(accessToken: string) {
      const payload = await request("/openapi/v1/athlete/info/", accessToken);
      const profile = object(payload.data) ?? payload;
      const id = profile.id ?? profile.user_id;
      if ((typeof id === "number" && Number.isSafeInteger(id) && id > 0)
        || (typeof id === "string" && /^[1-9]\d{0,31}$/.test(id))) return String(id);
      throw new XingzheError("protocol", { responseIssue: "missing_profile_id", profileFields: profileFieldTypes(payload) });
    },
    async downloadFit(activityId: number, accessToken: string): Promise<Uint8Array | null> {
      const url = new URL(`/api/v1/workout/${activityId}/fit/`, origin);
      let response = await send(url, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "manual" });
      if ([302, 303, 307, 308].includes(response.status)) {
        const target = URL.parse(response.headers.get("location") ?? "", url);
        await response.body?.cancel();
        // The website export returns a signed URL. The OAuth token stays on Xingzhe.
        if (!target || target.origin !== fitStorageOrigin || target.username || target.password
          || target.hash || !/\.fit$/i.test(target.pathname)) return null;
        response = await send(target, { credentials: "omit" });
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 429) throw rateLimited(response);
        return null;
      }
      return readResponseBytes(response, MAX_UPLOAD_BYTES, () => new XingzheError("protocol"));
    },
    async *activities(accessToken: string): AsyncGenerator<XingzheActivity | null> {
      for (let page = 0; page < maxPages; page++) {
        const offset = page * pageSize;
        const payload = await request(`/openapi/v1/activities/?limit=${pageSize}&offset=${offset}`, accessToken);
        if (!Array.isArray(payload.results) || payload.results.length > pageSize) throw new XingzheError("protocol");
        for (const row of payload.results) {
          const activity = object(row);
          if (activity && typeof activity.sport === "number" && activity.sport !== 3) continue;
          if (activity?.sport !== 3 || typeof activity.id !== "number" || !Number.isSafeInteger(activity.id) || activity.id <= 0
            || typeof activity.start_time !== "number" || !Number.isSafeInteger(activity.start_time) || activity.start_time <= 0
            || !Number.isFinite(new Date(activity.start_time).getTime())
            || typeof activity.end_time !== "number" || !Number.isSafeInteger(activity.end_time) || activity.end_time <= activity.start_time
            || typeof activity.distance !== "number" || !Number.isFinite(activity.distance)) {
            yield null;
            continue;
          }
          yield { id: activity.id, start_time: activity.start_time, end_time: activity.end_time, distance: activity.distance };
        }
        // Follow only the documented endpoint. The returned next URL may use HTTP.
        if (payload.results.length === 0 || (!payload.next && !(typeof payload.count === "number" && payload.count > offset + pageSize))) break;
      }
    },
  };
}
