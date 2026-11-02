import assert from "node:assert/strict";

/** Exercises the real HTTP adapter with an explicit tool request, without paid models. */
export async function withRequestedChatTool(tool: string, input: unknown, work: () => Promise<void>) {
  const env = { CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: "false", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const original = globalThis.fetch;
  Object.assign(process.env, env);
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.ok(body.messages[1].content.includes("<chat_request>"));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool, input }] }) } }] });
  }) as typeof fetch;
  try { await work(); }
  finally { globalThis.fetch = original; for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
