#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");
await mkdir(captureDir, { recursive: true });
for (const name of [
  "F-103-browser-plot-style.json", "F-103-browser-color-no-lineweights.svg", "F-103-browser-color-no-lineweights.pdf",
  "F-103-browser-grayscale.svg", "F-103-browser-grayscale.pdf", "F-103-browser-color-alpha.svg", "F-103-browser-color-alpha.pdf",
  "F-103-browser-monochrome.svg", "F-103-browser-monochrome.pdf", "F-103-browser-plot-style.kdraw",
  "F-103-browser-monochrome.png", "F-103-browser-color-no-lineweights.png", "F-103-browser-grayscale.png",
  "F-103-browser-color-alpha.png", "F-103-browser-monochrome-output.png", "F-103-browser-readback.json",
]) await rm(resolve(captureDir, name), { force: true });

function run(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f103-plot-style.spec.ts"], { PARITY_CAPTURE_DIR: captureDir });
await run(process.execPath, [resolve(root, "tools/parity/build-f103-browser-readback.mjs")]);
