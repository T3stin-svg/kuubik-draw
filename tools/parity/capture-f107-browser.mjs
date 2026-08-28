#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of ["F-107-browser-matrix.json", "F-107-browser-page-setups.png", "F-107-browser-template.json", "F-107-browser-readback.json"]) {
  await rm(resolve(captureDir, name), { force: true });
}

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f107-named-page-setups.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "node_modules/vite-node/vite-node.mjs"), resolve(root, "tools/parity/build-f107-browser-readback.mjs")]);
