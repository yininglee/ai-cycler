import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createUserProfile, demoBaselineProfile, updateUserProfile, ProfileValidationError, type ProfileInput } from "../../../src/domain/user-profile.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/**
 * 演示模式下的个人资料预置：新会话首次读取时写入一份演示基线
 * （28 岁 / 175cm / 72kg / 192bpm / FTP 220），使 demo 不再需要手填。
 * 设置 DEMO_PROFILE_SEED=off 可关闭，恢复“未填写即为空”的原始行为。
 */
function demoSeedEnabled(): boolean {
  return process.env.DEMO_PROFILE_SEED !== "off";
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = resolveOrCreateRequestSession(request);
    const repository = getApplicationRepository();
    const stored = await repository.getProfile(session.userId);
    if (!stored && !session.accountEmail && demoSeedEnabled()) {
      const seeded = demoBaselineProfile();
      await repository.saveProfile(session.userId, seeded);
      return Response.json(seeded, { headers: { ...headers, ...sessionCookieHeader(session) } });
    }
    return Response.json(stored ?? createUserProfile(), { headers: { ...headers, ...sessionCookieHeader(session) } });
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
