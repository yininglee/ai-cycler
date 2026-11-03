import assert from "node:assert/strict";
import { test } from "node:test";
import { createClientRequestId } from "../src/ui/client-request-id.ts";

test("client request IDs work when HTTP browsers omit randomUUID", (t) => {
  const webCrypto = globalThis.crypto;
  t.mock.getter(globalThis, "crypto", () => ({
    getRandomValues: webCrypto.getRandomValues.bind(webCrypto),
  }));

  const first = createClientRequestId();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(createClientRequestId(), first);
});
