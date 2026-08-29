#!/usr/bin/env node
import { probeOracles } from "./probe-tools.mjs";
import { runOracleFixtures } from "./run-fixtures.mjs";
import { verifyNetworkIsolationAttestation } from "./network-isolation.mjs";
import { basename } from "node:path";

const requireAll = process.argv.includes("--require");
const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const internalTools = await runOracleFixtures(probes, process.env, networkIsolation);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  certificationAuthority: false,
  networkIsolation,
  tools: internalTools.map(({ executable, ...tool }) => ({
    ...tool,
    ...(tool.reason && executable ? { reason: tool.reason.replaceAll(executable, basename(executable)) } : {}),
    ...(executable ? { executableName: basename(executable) } : {}),
  })),
};
console.log(JSON.stringify(report, null, 2));
if (requireAll && internalTools.some((tool) => tool.status !== "PASS")) {
  console.error("Required pinned geometry fixtures and read-backs did not PASS on this machine.");
  process.exit(1);
}
