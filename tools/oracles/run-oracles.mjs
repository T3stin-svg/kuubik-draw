#!/usr/bin/env node
import { probeOracles } from "./probe-tools.mjs";

const requireAll = process.argv.includes("--require");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  certificationAuthority: false,
  tools: await probeOracles(),
};
console.log(JSON.stringify(report, null, 2));
if (requireAll && report.tools.some((tool) => tool.status !== "PASS")) {
  console.error("Required pinned geometry fixtures and read-backs did not PASS on this machine.");
  process.exit(1);
}
