#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rows = [
  {
    rowId: "F-020",
    artifact: "evidence/artifacts/F-020-autocad-readback.json",
    sources: {
      scriptSha256: "parity/autocad/F-020.scr",
      matrixScriptSha256: "tools/autocad/f020-standard-matrix.ps1",
      runnerScriptSha256: "tools/autocad/run-f020.mjs",
      escapeHelperSha256: "tools/autocad/send-escape.ps1",
    },
  },
  {
    rowId: "F-021",
    artifact: "evidence/artifacts/F-021-autocad-readback.json",
    sources: {
      scriptSha256: "parity/autocad/F-021.scr",
      matrixScriptSha256: "tools/autocad/f021-standard-matrix.ps1",
      runnerScriptSha256: "tools/autocad/run-f021.mjs",
    },
  },
];

for (const row of rows) {
  const artifact = JSON.parse(await readFile(resolve(root, row.artifact), "utf8"));
  if (
    artifact.rowId !== row.rowId || artifact.status !== "PASS"
    || artifact.automationProcessOwned !== true
    || artifact.automationProcessTerminated !== true
    || artifact.processSetRestored !== true
  ) {
    throw new Error(`${row.rowId} AutoCAD artifact does not prove a successful owned-process run.`);
  }
  for (const [field, source] of Object.entries(row.sources)) {
    const current = sha256(await readFile(resolve(root, source)));
    if (artifact[field] !== current) {
      throw new Error(`${row.rowId} ${field} is stale for ${source}: artifact=${artifact[field] ?? "missing"}, current=${current}.`);
    }
  }
}

console.log("F-020/F-021 AutoCAD runner-source ratchet PASS.");
