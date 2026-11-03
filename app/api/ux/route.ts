import { resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createUserProfile, demoBaselineProfile } from "../../../src/domain/user-profile.ts";

export async function PUT(request: Request) {
  try {
    const session = resolveOrCreateRequestSession(request);
    const input = await request.json();
    const repository = getApplicationRepository();
    let profile = await repository.getProfile(session.userId) ?? createUserProfile();
    const now = new Date().toISOString();
    if (input.action === "blank") {
      // Reset only the prototype view; uploaded files remain in storage.
      profile = { ...createUserProfile(), ux: { mode: "blank", blankSince: now, goal: null, skipped: false } };
    } else if (input.action === "demo") {
      profile = { ...demoBaselineProfile(), ux: { ...profile.ux, mode: "demo", skipped: false } };
    } else if (input.action === "skip") {
      profile.ux = { ...profile.ux, skipped: input.skipped === true };
    } else if (input.action === "goal") {
      return Response.json({ error: "GOAL_MANAGED_BY_TRAINING_PLAN", message: "请在制定训练计划时设置本次计划目标。" }, { status: 410 });
    } else return Response.json({ error: "未知操作" }, { status: 400 });
    await repository.saveProfile(session.userId, profile);
    return Response.json(profile, { headers: { "Cache-Control": "no-store", ...sessionCookieHeader(session) } });
  } catch { return Response.json({ error: "保存失败，请稍后重试" }, { status: 503 }); }
}
