import { AccountSessionExpiredError, resolveOrCreateRequestSession, sessionCookieHeader, signInRequiredResponse } from "../../../src/auth/session.ts";
import { claimFirstChatOnboarding } from "../../../src/auth/account-store.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createUserProfile, demoBaselineProfile } from "../../../src/domain/user-profile.ts";

export async function PUT(request: Request) {
  try {
    const session = resolveOrCreateRequestSession(request);
    const input = await request.json();
    if (input.action === "claim_chat_onboarding") {
      if (!session.accountEmail) return signInRequiredResponse();
      return Response.json({ showOnboarding: claimFirstChatOnboarding(session.userId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (session.accountEmail && (input.action === "blank" || input.action === "demo")) {
      return Response.json({ error: "演示设置仅在访客模式下可用。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
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
  } catch (error) {
    if (error instanceof AccountSessionExpiredError) return signInRequiredResponse();
    return Response.json({ error: "保存失败，请稍后重试" }, { status: 503 });
  }
}
