import { execFileSync } from "node:child_process";

execFileSync("node", ["--test", "tests/ride-interpretation-presentation-view-model-v04-candidate.test.ts"], { stdio: "inherit" });
console.log("Ride interpretation presentation view-model preflight passed: 3 scenarios, no model calls.");
