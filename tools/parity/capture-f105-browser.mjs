#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of [
  "F-105-browser-matrix.json", "F-105-browser-publish.png", "F-105-browser-excluded.pdf", "F-105-browser-multi.pdf",
  "F-105-browser-plan.pdf", "F-105-browser-section.pdf", "F-105-browser-multi-1.png", "F-105-browser-multi-2.png",
  "F-105-browser-excluded.png", "F-105-browser-display.pdf", "F-105-browser-display.json", "F-105-browser-readback.json",
]) await rm(resolve(captureDir, name), { force: true });

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f105-batch-publish.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "tools/parity/build-f105-browser-readback.mjs")]);
