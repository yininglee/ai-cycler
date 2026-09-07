import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository, type ConsentRecord } from "../../../src/persistence/application-repository.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const POLICY_VERSION = "privacy-v1";

function authError(error: unknown): Response | null {
  if (error instanceof AuthConfigurationError) {
    return Response.json({ error: error.code }, { status: 503, headers });
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = resolveOrCreateRequestSession(request);
    const consent = await getApplicationRepository().getConsent(session.userId);
    return Response.json(consent, { headers: { ...headers, ...sessionCookieHeader(session) } });
  } catch (error) {
    return authError(error) ?? Response.json({ error: "CONSENT_READ_FAILED" }, { status: 500, headers });
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = getRequestSession(request) ?? resolveOrCreateRequestSession(request);
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "INVALID_JSON" }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || (body as Record<string, unknown>).accepted !== true) {
      return Response.json({ error: "CONSENT_REQUIRED" }, { status: 422, headers });
    }
    const consent: ConsentRecord = { policyVersion: POLICY_VERSION, acceptedAt: new Date().toISOString() };
    await getApplicationRepository().saveConsent(session.userId, consent);
    return Response.json(consent, { headers: { ...headers, ...sessionCookieHeader(session) } });
  } catch (error) {
    return authError(error) ?? Response.json({ error: "CONSENT_SAVE_FAILED" }, { status: 500, headers });
  }
}
