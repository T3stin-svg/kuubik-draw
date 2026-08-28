#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of [
  "F-106-browser-matrix.json", "F-106-browser-model-controls.png", "F-106-browser-extents.pdf", "F-106-browser-extents.svg",
  "F-106-browser-window.pdf", "F-106-browser-display.pdf", "F-106-browser-extents.png", "F-106-browser-window.png",
  "F-106-browser-display.png", "F-106-browser-readback.json",
]) await rm(resolve(captureDir, name), { force: true });

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f106-model-print.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "tools/parity/build-f106-browser-readback.mjs")]);
