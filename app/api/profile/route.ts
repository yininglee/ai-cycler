import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createUserProfile, updateUserProfile, ProfileValidationError, type ProfileInput } from "../../../src/domain/user-profile.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    const session = resolveOrCreateRequestSession(request);
    const profile = await getApplicationRepository().getProfile(session.userId);
    return Response.json(profile ?? createUserProfile(), { headers: { ...headers, ...sessionCookieHeader(session) } });
  } catch (error) {
    return Response.json({ error: error instanceof AuthConfigurationError ? error.code : "PROFILE_READ_FAILED" }, { status: 503, headers });
  }
}

export async function PUT(request: Request): Promise<Response> {
  let session;
  try { session = getRequestSession(request) ?? resolveOrCreateRequestSession(request); } catch (error) {
    return Response.json({ error: error instanceof AuthConfigurationError ? error.code : "AUTH_UNAVAILABLE" }, { status: 503, headers });
  }
  let input: ProfileInput;
  try { input = await request.json() as ProfileInput; } catch { return Response.json({ error: "INVALID_JSON" }, { status: 400, headers }); }
  try {
    const current = await getApplicationRepository().getProfile(session.userId);
    const profile = current ? updateUserProfile(current, input) : createUserProfile(input);
    await getApplicationRepository().saveProfile(session.userId, profile);
    return Response.json(profile, { headers: { ...headers, ...sessionCookieHeader(session) } });
  } catch (error) {
    return Response.json({ error: error instanceof ProfileValidationError ? error.message : "INVALID_PROFILE" }, { status: 422, headers });
  }
}
