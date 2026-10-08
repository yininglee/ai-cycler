import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RIDE_MODEL_V2_MODEL_ID,
  RIDE_MODEL_PROVIDER_ID,
  RIDE_MODEL_PROVIDER_RULES_VERSION,
  RideModelClientV2,
  RideModelErrorV2,
  readRideModelProviderConfigV2,
  readRideSemanticModelIdV2,
  type RideModelProviderConfigV2,
} from "../src/ai/ride-model-provider-v2.ts";

const TOKEN = "sf-secret-token-for-tests";

const config: RideModelProviderConfigV2 = {
  apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
  apiToken: TOKEN,
  modelId: "deepseek-ai/DeepSeek-V4-Flash",
  timeoutMs: 1_000,
  maxRequestBytes: 262_144,
  maxResponseBytes: 262_144,
};

function invocation(overrides: Partial<Parameters<RideModelClientV2["run"]>[0]> = {}) {
  return {
    analysisRunId: "run-s5-02",
    requestId: "request-s5-02",
    promptText: "版本化提示词全文（S6-01 生成）",
    promptVersion: "ride-prompt-v2.0.0",
    ...overrides,
  };
}

function okResponse(content: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  }), { status: 200, headers });
}

test("S5-02 config reader returns undefined without a token, keeping the AI_NOT_CONFIGURED contract", () => {
  assert.equal(readRideModelProviderConfigV2({}), undefined);
  assert.equal(readRideModelProviderConfigV2({ SILICONFLOW_API_TOKEN: "   " }), undefined);
});

test("S5-02 config reader applies safe defaults and the selected model baseline", () => {
  const loaded = readRideModelProviderConfigV2({ SILICONFLOW_API_TOKEN: TOKEN });
  assert.equal(loaded?.apiUrl, "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(loaded?.modelId, DEFAULT_RIDE_MODEL_V2_MODEL_ID);
  assert.equal(loaded?.timeoutMs, 25_000);
  assert.equal(loaded?.maxRequestBytes, 262_144);
  assert.equal(loaded?.maxResponseBytes, 262_144);
  const overridden = readRideModelProviderConfigV2({
    SILICONFLOW_API_TOKEN: TOKEN,
    SILICONFLOW_API_URL: "https://api.siliconflow.cn/v1/chat/completions",
    RIDE_MODEL_V2_MODEL_ID: "zai-org/GLM-5.2",
    AI_ANALYSIS_TIMEOUT_MS: "999999999",
  });
  assert.equal(overridden?.modelId, "zai-org/GLM-5.2");
  assert.equal(overridden?.timeoutMs, 300_000);
});

test("S5-02 config reader refuses non-HTTPS endpoints except localhost", () => {
  assert.throws(() => readRideModelProviderConfigV2({ SILICONFLOW_API_TOKEN: TOKEN, SILICONFLOW_API_URL: "http://api.example.com/v1/chat/completions" }), /HTTPS/);
  const local = readRideModelProviderConfigV2({ SILICONFLOW_API_TOKEN: TOKEN, SILICONFLOW_API_URL: "http://127.0.0.1:9999/v1/chat/completions" });
  assert.equal(local?.apiUrl, "http://127.0.0.1:9999/v1/chat/completions");
});

test("S5-02 successful call returns raw text with a complete call record and no secret material", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  let callCount = 0;
  const client = new RideModelClientV2(config, async (url, init) => {
    callCount += 1;
    captured = { url: String(url), init: init as RequestInit };
    return okResponse('{"oneLineLabel":{}}', { "x-request-id": "sf-req-123" });
  });
  const result = await client.run(invocation({ jsonMode: true, maxOutputTokens: 1024 }));

  assert.equal(result.rawText, '{"oneLineLabel":{}}');
  assert.equal(callCount, 1);
  assert.equal(captured?.init.method, "POST");
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.equal((captured?.init.headers as Record<string, string>)["X-Client-Request-Id"], "request-s5-02");

  const body = JSON.parse(String(captured?.init.body)) as Record<string, unknown>;
  assert.equal(body.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.deepEqual(body.response_format, { type: "json_object" });
  // Locked sampling controls (user decision 2026-10-06): low temperature and
  // thinking disabled are always sent so outputs stay deterministic.
  assert.equal(body.temperature, 0.3);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.messages, [{ role: "user", content: "版本化提示词全文（S6-01 生成）" }]);

  const record = result.callRecord;
  assert.equal(record.provider, RIDE_MODEL_PROVIDER_ID);
  assert.equal(record.rulesVersion, RIDE_MODEL_PROVIDER_RULES_VERSION);
  assert.equal(record.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(record.analysisRunId, "run-s5-02");
  assert.equal(record.requestId, "request-s5-02");
  assert.equal(record.promptVersion, "ride-prompt-v2.0.0");
  assert.equal(record.providerRequestId, "sf-req-123");
  assert.equal(record.httpStatus, 200);
  assert.equal(typeof record.latencyMs, "number");
  assert.ok(record.latencyMs >= 0);
  assert.deepEqual(record.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200 });
  assert.equal(record.errorCode, undefined);
  assert.equal(JSON.stringify(record).includes(TOKEN), false);
});

test("S5-02 jsonMode off sends no response_format and default request shape", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const client = new RideModelClientV2(config, async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return okResponse("plain text");
  });
  const result = await client.run(invocation());
  assert.equal("response_format" in (capturedBody ?? {}), false);
  assert.equal("max_tokens" in (capturedBody ?? {}), false);
  assert.equal(result.rawText, "plain text");
});

test("S5-02 oversized request body is rejected before any network call", async () => {
  let callCount = 0;
  const client = new RideModelClientV2(config, async () => {
    callCount += 1;
    return okResponse("unused");
  });
  await assert.rejects(
    () => client.run(invocation({ promptText: "x".repeat(300_000) })),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "PROVIDER_REQUEST_TOO_LARGE");
      assert.equal(error.callRecord.errorCode, "PROVIDER_REQUEST_TOO_LARGE");
      assert.equal(error.callRecord.analysisRunId, "run-s5-02");
      return true;
    },
  );
  assert.equal(callCount, 0);
});

test("S5-02 auth failures (401/403) map to PROVIDER_AUTH_ERROR with a single attempt", async () => {
  for (const status of [401, 403]) {
    let callCount = 0;
    const client = new RideModelClientV2(config, async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: { message: "bad key" } }), { status });
    });
    await assert.rejects(
      () => client.run(invocation()),
      (error: unknown) => {
        assert.ok(error instanceof RideModelErrorV2);
        assert.equal(error.code, "PROVIDER_AUTH_ERROR");
        assert.equal(error.httpStatus, status);
        assert.equal(error.callRecord.errorCode, "PROVIDER_AUTH_ERROR");
        assert.equal(error.callRecord.httpStatus, status);
        return true;
      },
    );
    assert.equal(callCount, 1);
  }
});

test("S5-02 rate limiting (429) maps to PROVIDER_RATE_LIMITED", async () => {
  const client = new RideModelClientV2(config, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => client.run(invocation()),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "PROVIDER_RATE_LIMITED");
      assert.equal(error.httpStatus, 429);
      return true;
    },
  );
});

test("S5-02 other HTTP failures map to PROVIDER_HTTP_ERROR", async () => {
  const client = new RideModelClientV2(config, async () => new Response("server exploded", { status: 500 }));
  await assert.rejects(
    () => client.run(invocation()),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "PROVIDER_HTTP_ERROR");
      assert.equal(error.httpStatus, 500);
      return true;
    },
  );
});

test("S5-02 timeouts map to AI_TIMEOUT with abort observed", async () => {
  let observedAbort = false;
  const client = new RideModelClientV2(config, async (_url, init) => {
    const signal = init?.signal as AbortSignal;
    signal.addEventListener("abort", () => { observedAbort = true; });
    await new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("unreachable in time")), 500);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    });
    return okResponse("unused");
  });
  await assert.rejects(
    () => client.run(invocation({ timeoutMs: 5 })),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "AI_TIMEOUT");
      assert.equal(error.callRecord.errorCode, "AI_TIMEOUT");
      assert.equal(JSON.stringify(error.callRecord).includes(TOKEN), false);
      return true;
    },
  );
  assert.equal(observedAbort, true);
});

test("S5-02 oversized responses are rejected via content-length and actual bytes", async () => {
  const byHeader = new RideModelClientV2(config, async () => new Response("{}", { status: 200, headers: { "content-length": "999999" } }));
  await assert.rejects(() => byHeader.run(invocation()), (error: unknown) => {
    assert.ok(error instanceof RideModelErrorV2);
    assert.equal(error.code, "PROVIDER_RESPONSE_TOO_LARGE");
    return true;
  });

  const byBytes = new RideModelClientV2(
    { ...config, maxResponseBytes: 10 },
    async () => new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(50) } }] }), { status: 200 }),
  );
  await assert.rejects(() => byBytes.run(invocation()), (error: unknown) => {
    assert.ok(error instanceof RideModelErrorV2);
    assert.equal(error.code, "PROVIDER_RESPONSE_TOO_LARGE");
    return true;
  });
});

test("S5-02 non-JSON or non-object responses map to PROVIDER_INVALID_RESPONSE", async () => {
  const notJson = new RideModelClientV2(config, async () => new Response("<html>gateway error</html>", { status: 200 }));
  await assert.rejects(() => notJson.run(invocation()), (error: unknown) => {
    assert.ok(error instanceof RideModelErrorV2);
    assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
    return true;
  });

  const notObject = new RideModelClientV2(config, async () => new Response(JSON.stringify(["array"]), { status: 200 }));
  await assert.rejects(() => notObject.run(invocation()), (error: unknown) => {
    assert.ok(error instanceof RideModelErrorV2);
    assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
    return true;
  });
});

test("S5-02 responses without message content map to PROVIDER_MISSING_CONTENT", async () => {
  const client = new RideModelClientV2(config, async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }));
  await assert.rejects(
    () => client.run(invocation()),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "PROVIDER_MISSING_CONTENT");
      assert.equal(error.callRecord.errorCode, "PROVIDER_MISSING_CONTENT");
      return true;
    },
  );
});

test("S5-02 network-level fetch failures map to PROVIDER_HTTP_ERROR without secrets", async () => {
  const client = new RideModelClientV2(config, async () => { throw new Error("ECONNRESET"); });
  await assert.rejects(
    () => client.run(invocation()),
    (error: unknown) => {
      assert.ok(error instanceof RideModelErrorV2);
      assert.equal(error.code, "PROVIDER_HTTP_ERROR");
      assert.equal(JSON.stringify(error.callRecord).includes(TOKEN), false);
      return true;
    },
  );
});

test("S5-02 semantic model reader returns undefined when unset, trimmed value when set", () => {
  assert.equal(readRideSemanticModelIdV2({}), undefined);
  assert.equal(readRideSemanticModelIdV2({ RIDE_MODEL_V2_SEMANTIC_MODEL_ID: "   " }), undefined);
  assert.equal(readRideSemanticModelIdV2({ RIDE_MODEL_V2_SEMANTIC_MODEL_ID: "  THUDM/glm-4-9b-chat  " }), "THUDM/glm-4-9b-chat");
});

test("S5-02 per-invocation modelId overrides the client model and is reflected in the call record", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const client = new RideModelClientV2(config, async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return okResponse('{"exempt":true}');
  });
  const result = await client.run(invocation({ modelId: "THUDM/glm-4-9b-chat", maxOutputTokens: 128, timeoutMs: 10_000 }));

  assert.equal(capturedBody?.model, "THUDM/glm-4-9b-chat");
  assert.equal(capturedBody?.max_tokens, 128);
  assert.equal(result.callRecord.model, "THUDM/glm-4-9b-chat");
});
