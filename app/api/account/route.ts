import { getRequestSession, requiresOidcSession } from "../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";

export const runtime = "nodejs";

export async function DELETE(request: Request): Promise<Response> {
  const session = getRequestSession(request);
  if (requiresOidcSession()) return Response.json({ error: "AUTH_CONFIGURATION_REQUIRED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_requested", attributes: { scope: "account" } }));
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_completed", attributes: { scope: "account" } }));
  await getApplicationRepository().deleteAccount(session.userId);
  return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": "ai-cycling-buddy-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" } });
}
