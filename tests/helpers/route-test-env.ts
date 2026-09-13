import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// Route tests run as parallel `node --test` processes. Without an isolated
// data root every process reads and writes the same
// .local-data/application-state.json, and the repository's mtime-based
// reload surfaces another process's overwrites mid-test. Give each process
// its own root instead.
const root = mkdtempSync(join(tmpdir(), "ai-cycling-route-tests-"));
process.env.LOCAL_DATA_DIR = root;
// Same reasoning for the bundled demo "already imported" rides: they are part of
// the runtime dataset (visible to every session), so contract tests must assert
// on a baseline without them — otherwise "no ride yet" / "first ride" paths get
// shadowed by demo data.
process.env.DEMO_IMPORTED_RIDES_ENABLED = "false";
after(() => rmSync(root, { recursive: true, force: true }));
