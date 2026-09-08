import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHAT_TOOL_MAX_RESULT_BYTES,
  ChatToolError,
  executeChatTool,
  parseChatToolInvocation,
} from "../src/chat/chat-tools.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { FileApplicationRepository } from "../src/persistence/application-repository.ts";

function privateRecord(fixtureId: string, rideId: string) {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ChatToolError ? error.code : undefined;
}

test("chat tool invocation rejects unknown fields, dimensions, capabilities and oversized lists", () => {
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "ride-1", dims: ["summary"], userId: "other" } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "ride-1", dims: ["route"] } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "ride-1", caps: ["distance", "distance"] } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "ride-1", caps: ["distance", "timing", "speed", "elevation", "heartRate", "power", "cadence", "route", "trend"] } }), (error) => errorCode(error) === "INVALID_INPUT");
});

test("get_ride_context returns only requested dimensions and no private raw data", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l3-fit-power", "private-ride"));
    const invocation = parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "private-ride", dims: ["power"] } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "get_ride_context");
    if (result.tool !== "get_ride_context") return;
    assert.deepEqual(result.dimensions, ["power"]);
    assert.ok(result.claims.some((claim) => claim.key === "avgPowerW"));
    assert.equal(result.claims.some((claim) => claim.key === "distanceM" || claim.key === "avgHeartRateBpm"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["fileName", "points", "coordinateSpace", "userScope", "owner-a", "sourceField"]) assert.equal(serialized.includes(forbidden), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("get_capabilities returns only requested capability states", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l1-built-in-sample", "private-ride"));
    const invocation = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "private-ride", caps: ["distance", "power"] } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "get_capabilities");
    if (result.tool !== "get_capabilities") return;
    assert.deepEqual(result.capabilities.map((capability) => capability.key), ["distance", "power"]);
    assert.equal(result.capabilities[0].available, true);
    assert.equal(result.capabilities[1].available, false);
    assert.equal(result.capabilities[1].unavailableReason, "FIELD_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing and cross-owner rides return the same NOT_FOUND error", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l2-fit-heart-rate", "private-ride"));
    const ownedByOther = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "private-ride", caps: ["heartRate"] } });
    const missing = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "missing-ride", caps: ["heartRate"] } });
    await assert.rejects(executeChatTool(repository, "owner-b", ownedByOther), (error) => errorCode(error) === "NOT_FOUND");
    await assert.rejects(executeChatTool(repository, "owner-b", missing), (error) => errorCode(error) === "NOT_FOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat tools never call repository write methods", async () => {
  const record = privateRecord("l1-built-in-sample", "read-only-ride");
  const writes: string[] = [];
  const repository = {
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner" && rideId === "read-only-ride" ? record : null,
    getProfile: async () => null,
    listRides: async () => [],
    findRideIdByContentHash: async () => null,
    saveRide: async () => { writes.push("saveRide"); },
    deleteRide: async () => { writes.push("deleteRide"); return true; },
    saveProfile: async () => { writes.push("saveProfile"); },
    saveAnalysisRun: async () => { writes.push("saveAnalysisRun"); },
    getAnalysisRun: async () => null,
    getConsent: async () => null,
    saveConsent: async () => { writes.push("saveConsent"); },
    saveDemoEvent: async () => { writes.push("saveDemoEvent"); },
    listDemoEvents: async () => [],
    deleteAccount: async () => { writes.push("deleteAccount"); },
  };
  await executeChatTool(repository, "owner", parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "read-only-ride", caps: ["distance"] } }));
  assert.deepEqual(writes, []);
});

test("chat tool timeout uses the stable TIMEOUT error without exposing repository details", async () => {
  const repository = {
    getRide: async () => await new Promise<null>(() => {}),
    getProfile: async () => null,
  } as unknown as FileApplicationRepository;
  const invocation = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "slow-ride", caps: ["distance"] } });
  await assert.rejects(executeChatTool(repository, "owner", invocation), (error) => errorCode(error) === "TIMEOUT");
});
