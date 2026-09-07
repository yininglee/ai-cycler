import { getRequestSession } from "../../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../../src/persistence/application-repository.ts";
import { createDemoEvent } from "../../../../src/observability/demo-events.ts";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = getRequestSession(request);
  const { id } = await params;
  if (!session) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!await getApplicationRepository().getRide(session.userId, id)) {
    return Response.json({ deleted: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_requested", attributes: { scope: "ride" } }));
  const deleted = await getApplicationRepository().deleteRide(session.userId, id);
  if (deleted) await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_completed", attributes: { scope: "ride" } }));
  return Response.json({ deleted }, { status: deleted ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
