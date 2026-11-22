import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { POST as account } from "../app/api/account/route.ts";
import { POST as uploadOne } from "../app/api/rides/import/route.ts";
import { POST as uploadBatch } from "../app/api/rides/import/onelap-batch/route.ts";
import { getAccountRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import type { OnelapBatchResult } from "../src/imports/onelap-batch.ts";

const endpoint = "http://localhost/api/rides/import/onelap-batch";

async function register(name: string) {
  const response = await account(new Request("http://localhost/api/account", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register", email: `${name}@example.test`, password: "test cycling account" }),
  }));
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

function fit(name: string) {
  return readFile(new URL(`../test-data/demo-imported-rides/${name}.fit`, import.meta.url));
}

function upload(name: string, data: Uint8Array) {
  return new File([new Uint8Array(data)], name);
}

function request(cookie: string, ...files: File[]) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return new Request(endpoint, { method: "POST", headers: { Cookie: cookie }, body });
}

function zip(entries: [string, Buffer][]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const fileName = Buffer.from(name);
    const compressed = deflateRawSync(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    local.push(header, fileName, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, fileName);
    offset += header.length + fileName.length + compressed.length;
  }
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(central.reduce((size, item) => size + item.length, 0), 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, footer]);
}

test("Onelap ZIP and FIT batches share single-file dedup and keep successes after bad files", async () => {
  const cookie = await register("onelap-batch-a");
  const [first, second, third] = await Promise.all([fit("demo-ride-2026-08-20"), fit("demo-ride-2026-07-18"), fit("demo-ride-2026-10-05")]);
  const body = new FormData();
  body.append("file", upload("single.fit", first));
  body.set("platform", "onelap");
  assert.equal((await uploadOne(new Request("http://localhost/api/rides/import", { method: "POST", headers: { Cookie: cookie }, body }))).status, 201);

  const broken = Buffer.from("broken FIT");
  const archive = upload("OTM.zip", zip([["旧骑行/first.FIT", first], ["新骑行/second.fit", second],
    ["__MACOSX/._data.fit", broken], ["README.txt", broken], ["坏文件.fit", broken]]));
  const response = await uploadBatch(request(cookie, archive));
  assert.equal(response.status, 200);
  const imported: OnelapBatchResult = await response.json();
  assert.deepEqual([imported.added, imported.duplicate, imported.failed], [1, 1, 1]);
  assert.equal(imported.failures[0]?.fileName, "坏文件.fit");
  const result: OnelapBatchResult = await (await uploadBatch(request(cookie,
    upload("renamed.FIT", second), upload("new.fit", third), upload("again.fit", third)))).json();
  assert.deepEqual([result.added, result.duplicate, result.failed], [1, 2, 0]);
  const retried: OnelapBatchResult = await (await uploadBatch(request(cookie, archive))).json();
  assert.deepEqual([retried.added, retried.duplicate, retried.failed], [0, 2, 1]);

  const other = await register("onelap-batch-b");
  const otherResult: OnelapBatchResult = await (await uploadBatch(request(other, upload("same.fit", first)))).json();
  assert.equal(otherResult.added, 1);
  const ownerId = getAccountRequestSession(request(cookie))!.userId;
  const repository = getApplicationRepository();
  const rides = await repository.listRides(ownerId);
  assert.equal(rides.length, 3);
  assert.ok(rides.every(({ record }) => record.activity.source.platformId === "onelap" && !record.activity.source.fileName));
  assert.equal(await repository.getRide(ownerId, otherResult.rideIds[0]!), null);
});

test("Onelap batch rejects uploads without an account and ZIPs without usable entries", async () => {
  const cookie = await register("onelap-batch-invalid");
  const emptyZip = upload("no-rides.zip", zip([["README.txt", Buffer.from("no rides")]]));
  assert.equal((await uploadBatch(request("", emptyZip))).status, 401);
  const crossSite = request(cookie, emptyZip);
  crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await uploadBatch(crossSite)).status, 403);
  const tooLarge = request(cookie, emptyZip);
  tooLarge.headers.set("Content-Length", String(104 * 1024 * 1024));
  assert.equal((await uploadBatch(tooLarge)).status, 413);
  const missingFit = await uploadBatch(request(cookie, emptyZip));
  assert.equal(missingFit.status, 422);
  assert.match((await missingFit.json()).message, /没有找到 FIT/);
  assert.equal((await uploadBatch(request(cookie, upload("invalid.zip", Buffer.from("broken"))))).status, 422);
  assert.equal((await uploadBatch(request(cookie, emptyZip, upload("ride.fit", Buffer.alloc(0))))).status, 422);
});
