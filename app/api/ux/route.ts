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
      if (input.goal !== null && (typeof input.goal?.title !== "string" || !input.goal.title.trim() || input.goal.title.length > 80 || typeof input.goal.detail !== "string" || input.goal.detail.length > 400)) {
        return Response.json({ error: "请填写目标，补充说明不超过 400 字" }, { status: 422 });
      }
      profile.ux = { ...profile.ux, goal: input.goal === null ? null : { title: input.goal.title.trim(), detail: input.goal.detail.trim(), updatedAt: now } };
    } else return Response.json({ error: "未知操作" }, { status: 400 });
    await repository.saveProfile(session.userId, profile);
    return Response.json(profile, { headers: { "Cache-Control": "no-store", ...sessionCookieHeader(session) } });
  } catch { return Response.json({ error: "保存失败，请稍后重试" }, { status: 503 }); }
}
