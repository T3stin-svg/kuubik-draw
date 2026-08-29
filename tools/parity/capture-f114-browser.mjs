#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of [
  "F-114-browser-matrix.json", "F-114-browser-vector.pdf", "F-114-browser-publish.png",
  "F-114-browser-vector-1.png", "F-114-browser-vector-2.png", "F-114-browser-readback.json",
]) await rm(resolve(captureDir, name), { force: true });

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f114-vector-pdf.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "tools/parity/build-f114-browser-readback.mjs")]);
