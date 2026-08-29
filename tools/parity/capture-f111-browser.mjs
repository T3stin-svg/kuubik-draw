#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
await mkdir(artifacts, { recursive: true });
for (const name of ["F-111-browser-roundtrip.dxf", "F-111-browser-roundtrip.png", "F-111-browser-matrix.json"]) {
  await rm(resolve(artifacts, name), { force: true });
}

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f111-dxf-roundtrip.spec.ts", "--project=chromium"], {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
    env: { ...process.env, PARITY_CAPTURE_DIR: artifacts },
  });
  child.on("error", rejectRun);
  child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`F-111 browser capture exited ${code}.`)));
});
console.log("F-111 browser artifact captured.");
