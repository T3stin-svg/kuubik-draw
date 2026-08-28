#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of ["F-099-browser-multiple-viewports.json", "F-099-browser-multiple-viewports.kdraw", "F-099-browser-readback.json"]) {
  await rm(resolve(captureDir, name), { force: true });
}

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f099-multiple-viewports.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "tools/parity/build-f099-browser-readback.mjs")]);
