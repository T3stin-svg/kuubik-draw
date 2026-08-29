#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const captureDir = await mkdtemp(join(tmpdir(), "kuubik-f003-browser-"));

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

try {
  await run(process.execPath, [resolve(root, "node_modules/playwright/cli.js"), "test", "--grep", "F-003"], {
    PARITY_CAPTURE_DIR: captureDir,
  });
  await run(process.execPath, [resolve(root, "tools/parity/build-f003-browser-readback.mjs")], {
    F003_BROWSER_DXF_PATH: resolve(captureDir, "F-003-browser.dxf"),
  });
} finally {
  await rm(captureDir, { recursive: true, force: true });
}
