import { getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { executionRuntime } from "../../../src/training/execution-service.ts";
import { planDate, PlanError } from "../../../src/domain/training-plan.ts";
import { ConfirmedWriteError } from "../../../src/chat/chat-write-confirmation.ts";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === keys.sort().join();
function failure(error: unknown): Response {
  if (error instanceof SyntaxError) return failure(new PlanError("INVALID_INPUT"));
  const known = error instanceof PlanError || error instanceof ConfirmedWriteError;
  const code = known ? error.code : "EXECUTION_UNAVAILABLE";
  return Response.json({ error: code }, { status: code === "NOT_FOUND" ? 404 : ["VERSION_CONFLICT", "CONTENT_CHANGED", "CONFIRMATION_EXPIRED"].includes(code) ? 409 : known ? 422 : 503, headers });
}
export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return Response.json({ status: "no_plan", date: null, ref: null }, { headers });
  try {
    const query = new URL(request.url).searchParams, planId = query.get("planId"), date = query.get("date"), v = query.get("version"), offset = query.get("offset");
    if (planId !== null && !identifier(planId) || date !== null && !planDate(date) || v !== null && (!/^\d+$/.test(v) || !integer(Number(v), 1)) || offset !== null && (!/^\d+$/.test(offset) || !integer(Number(offset)) || Number(offset) > 100_000)) throw new PlanError("INVALID_INPUT");
    return Response.json(await (await executionRuntime(session.userId)).context({ ...(planId ? { planId } : {}), ...(date ? { date } : {}), ...(v ? { version: Number(v) } : {}), ...(offset ? { offset: Number(offset) } : {}) }), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 16_384) throw new PlanError("INVALID_INPUT");
    const text = await request.text(); if (Buffer.byteLength(text) > 16_384) throw new PlanError("INVALID_INPUT");
    const input: unknown = JSON.parse(text); if (!object(input)) throw new PlanError("INVALID_INPUT");
    const session = resolveOrCreateRequestSession(request), service = await executionRuntime(session.userId);
    const responseHeaders = { ...headers, ...sessionCookieHeader(session) };
    if (input.action === "confirm" && exact(input, ["action", "request"])) return Response.json(await service.confirmation.confirm({ ownerId: session.userId, request: input.request }), { headers: responseHeaders });
    if (!identifier(input.planId) || !integer(input.version, 1) || !planDate(input.date)) throw new PlanError("INVALID_INPUT");
    const ref = { planId: input.planId, version: input.version, date: input.date };
    if (input.action === "issue_link" && exact(input, ["action", "planId", "version", "date", "rideId", "expectedRevision", "idempotencyKey"]) && identifier(input.rideId) && integer(input.expectedRevision) && identifier(input.idempotencyKey)) {
      return Response.json({ grant: await service.issueLink({ ...ref, rideId: input.rideId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey }) }, { headers: responseHeaders });
    }
    if (input.action === "assess" && exact(input, ["action", "planId", "version", "date", "expectedRevision", "force"]) && integer(input.expectedRevision, 1) && typeof input.force === "boolean") {
      await service.assess({ ...ref, expectedRevision: input.expectedRevision, force: input.force });
      return Response.json(await service.context(ref), { headers: responseHeaders });
    }
    throw new PlanError("INVALID_INPUT");
  } catch (error) { return failure(error); }
}
