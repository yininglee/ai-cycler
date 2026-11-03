import { getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { planRuntime } from "../../../src/training/plan-service.ts";
import { parsePlanIntakePatch, PlanError } from "../../../src/domain/training-plan.ts";
import { ConfirmedWriteError } from "../../../src/chat/chat-write-confirmation.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const exact = (input: Record<string, unknown>, keys: string[]) => Object.keys(input).sort().join() === [...keys].sort().join();
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
async function view(ownerId: string, planId?: string | null, requestedVersion?: number) {
  const context = await (await planRuntime(ownerId)).context();
  const { workspace, ...rest } = context;
  if (planId && workspace.id !== planId) throw new PlanError("NOT_FOUND");
  if (requestedVersion !== undefined && workspace.deletedVersions[String(requestedVersion)]) throw new PlanError("PLAN_DELETED");
  const viewPlan = requestedVersion === undefined ? context.draft ?? context.active : workspace.plans.find(plan => plan.version === requestedVersion) ?? null;
  if (requestedVersion !== undefined && !viewPlan) throw new PlanError("NOT_FOUND");
  return { ...rest, profileChanged: !!viewPlan && viewPlan.basis.profileHash !== context.basis.profileHash, id: workspace.id, version: workspace.version, intake: workspace.intake, intakeVersion: workspace.intakeVersion, confirmedIntakeVersion: workspace.confirmedIntakeVersion, activeVersion: workspace.activeVersion, draftVersion: workspace.draftVersion, activatedAt: workspace.activatedAt, replacedAt: workspace.replacedAt, workoutRecords: workspace.workoutRecords, executionRecords: Object.fromEntries(Object.entries(workspace.executions).map(([key, value]) => [key, { rideId: value.rideId, revision: value.revision }])), viewPlan };
}
function failure(error: unknown) {
  if (error instanceof SyntaxError) return failure(new PlanError("INVALID_INPUT"));
  const known = error instanceof PlanError || error instanceof ConfirmedWriteError;
  const code = known ? error.code : "PLAN_UNAVAILABLE";
  return Response.json({ error: code, ...(error instanceof PlanError ? { issues: error.issues } : {}) }, { status: code === "NOT_FOUND" ? 404 : ["VERSION_CONFLICT", "CONTENT_CHANGED", "IDEMPOTENCY_CONFLICT", "CONFIRMATION_EXPIRED"].includes(code) ? 409 : known ? 422 : 503, headers });
}
export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return Response.json({ id: null, active: null, draft: null }, { headers });
  try {
    const query = new URL(request.url).searchParams;
    const v = query.get("version");
    if (v !== null && (!/^\d+$/.test(v) || !version(Number(v)))) throw new PlanError("INVALID_INPUT");
    return Response.json(await view(session.userId, query.get("planId"), v === null ? undefined : Number(v)), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 32_768) return Response.json({ error: "INVALID_INPUT" }, { status: 413, headers });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 32_768) throw new PlanError("INVALID_INPUT");
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlanError("INVALID_INPUT");
    const session = resolveOrCreateRequestSession(request), service = await planRuntime(session.userId);
    const responseHeaders = { ...headers, ...sessionCookieHeader(session) };
    if (input.action === "prepare" && exact(input, ["action", "patch", "expectedVersion"]) && (input.expectedVersion === null || version(input.expectedVersion))) {
      if (input.expectedVersion === null && Object.keys(parsePlanIntakePatch(input.patch)).length) throw new PlanError("INVALID_INPUT");
      await service.prepare(parsePlanIntakePatch(input.patch), input.expectedVersion === null ? undefined : input.expectedVersion);
    } else if (input.action === "confirm_intake" && exact(input, ["action", "intake", "expectedVersion", "confirmed"]) && input.confirmed === true && version(input.expectedVersion)) {
      await service.confirmIntake(input.intake, input.expectedVersion);
    } else if (input.action === "issue" && exact(input, ["action", "planId", "version", "activeVersion", "idempotencyKey"]) && typeof input.planId === "string" && version(input.version) && (input.activeVersion === null || version(input.activeVersion)) && typeof input.idempotencyKey === "string") {
      const grant = await service.issue({ planId: input.planId, version: input.version, activeVersion: input.activeVersion, idempotencyKey: input.idempotencyKey });
      return Response.json({ grant }, { headers: responseHeaders });
    } else if (input.action === "issue_delete" && exact(input, ["action", "planId", "version", "idempotencyKey"]) && typeof input.planId === "string" && version(input.version) && typeof input.idempotencyKey === "string") {
      return Response.json({ grant: await service.issueDelete({ planId: input.planId, version: input.version, idempotencyKey: input.idempotencyKey }) }, { headers: responseHeaders });
    } else if (input.action === "confirm" && exact(input, ["action", "request"])) {
      return Response.json(await service.confirmation.confirm({ ownerId: session.userId, request: input.request }), { headers: responseHeaders });
    } else if (input.action === "discard" && exact(input, ["action", "version"]) && version(input.version)) {
      await service.store.transaction(session.userId, async tx => { if (tx.domain.version !== input.version) throw new PlanError("VERSION_CONFLICT"); tx.domain.draftVersion = null; });
    } else throw new PlanError("INVALID_INPUT");
    return Response.json(await view(session.userId), { headers: responseHeaders });
  } catch (error) { return failure(error); }
}
