import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { proxy } from "../proxy.ts";
import { POST as account } from "../app/api/account/route.ts";
import { accountReturnPath } from "../src/auth/account-return-path.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";

function request(path: string, method = "GET", cookie?: string): Request {
  return new Request(`https://cycler.example.test${path}`, { method, headers: cookie ? { Cookie: cookie } : undefined });
}

test("Cycler gates application pages and APIs on a registered account session", async () => {
  const guest = resolveOrCreateRequestSession(request("/")).setCookie!.split(";")[0];
  assert.equal(proxy(request("/account")), undefined);
  assert.equal(proxy(request("/api/account", "POST")), undefined);
  assert.equal(proxy(request("/api/account", "DELETE", guest))?.status, 401);

  for (const path of ["/", "/chat", "/import", "/pmc", "/profile", "/rides/example?tab=data", "/connections/xingzhe"]) {
    const response = proxy(request(path, "GET", guest));
    assert.equal(response?.status, 303);
    const target = new URL(response!.headers.get("location")!);
    assert.equal(target.pathname, "/account");
    assert.equal(target.searchParams.get("returnTo"), path === "/" ? null : path);
  }
  for (const [path, method] of [
    ["/api/rides/summary", "GET"], ["/api/rides/import", "POST"], ["/api/chat", "POST"],
    ["/api/training-plans", "GET"], ["/api/profile", "PUT"], ["/api/platform/xingzhe/callback", "GET"],
  ]) {
    const response = proxy(request(path, method));
    assert.equal(response?.status, 401);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.equal(response?.headers.has("set-cookie"), false);
  }
  assert.equal(proxy(request("/api/profile", "GET", "cycler-account=forged"))?.status, 401);

  const signIn = (body: object, cookie?: string) => account(new Request("https://cycler.example.test/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  }));
  const registered = await signIn({ action: "register", email: "require-login@example.test", password: "test-only cycling password" });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie")!.split(";")[0];
  assert.equal(proxy(request("/chat", "GET", cookie)), undefined);
  assert.equal(proxy(request("/api/profile", "GET", cookie)), undefined);
  assert.equal(proxy(request("/api/account", "DELETE", cookie)), undefined);
  assert.equal((await signIn({ action: "logout" }, cookie)).status, 200);
  assert.equal(proxy(request("/chat", "GET", cookie))?.status, 303);
  assert.equal(proxy(request("/api/profile", "GET", `${cookie}; ${guest}`))?.status, 401);
});

test("sign-in deep links stay within Cycler pages", () => {
  assert.equal(accountReturnPath("/rides/example?tab=data"), "/rides/example?tab=data");
  assert.equal(accountReturnPath("/connections/xingzhe?from=chat"), "/connections/xingzhe?from=chat");
  for (const unsafe of [undefined, ["somewhere"], "https://elsewhere.test/import", "//elsewhere.test", "/\\elsewhere.test",
    "/account", "/api/rides/summary", "/rides/../../api/account", "/\t/elsewhere.test"]) {
    assert.equal(accountReturnPath(unsafe), "/chat");
  }
});

test("old login query URLs redirect without credentials or a referrer", () => {
  const response = proxy(request("/account?email=test%40example.test&password=test-only&returnTo=%2Fimport"));
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), "https://cycler.example.test/account?returnTo=%2Fimport");
  assert.equal(response?.headers.get("referrer-policy"), "no-referrer");
});
