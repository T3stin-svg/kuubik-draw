#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const captureDir = resolve(root, "evidence/artifacts");

function run(executable, args, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`${executable} exited ${code}.`)));
  });
}

await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "e2e/f018-rotate.spec.ts"], {
  PARITY_CAPTURE_DIR: captureDir,
});
await run(process.execPath, [resolve(root, "tools/parity/build-f018-browser-readback.mjs")]);
