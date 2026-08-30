#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "evidence/artifacts/F-022-browser-spline-source.dxf");
const scriptPath = resolve(root, "parity/autocad/F-026-core.scr");
const runnerPath = resolve(root, "tools/autocad/run-f026-core.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-026-autocad-core.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (buffer) => buffer.length > 1 && buffer[1] === 0 ? buffer.toString("utf16le") : buffer.toString("utf8");

const output = await new Promise((resolveRun, reject) => {
  const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = []; const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
  const timeout = setTimeout(() => { child.kill(); reject(new Error("F-026 AutoCAD Core Console exceeded 60 seconds.")); }, 60_000);
  child.on("error", (error) => { clearTimeout(timeout); reject(error); });
  child.on("close", (code) => { clearTimeout(timeout); const text = decode(Buffer.concat(stdout)).replaceAll("\0", ""); const errorText = decode(Buffer.concat(stderr)).replaceAll("\0", ""); if (code !== 0) reject(new Error(`F-026 AutoCAD Core Console exited ${code}: ${errorText}\n${text.slice(-8000)}`)); else resolveRun(text); });
});

function marker(name) {
  return [...output.matchAll(new RegExp(`(?:^|\\r?\\n)F026_${name}=([^\\r\\n]*)`, "gmu"))].at(-1)?.[1]?.trim() ?? null;
}
const checks = {
  version: marker("ACADVER")?.startsWith("24.3") === true,
  rationalSpline: Number(marker("SPLINE_COUNT")) === 2,
  defaultSelectionFirst: Number(marker("DEFAULT_COUNT")) === 2,
  explicitFirst: Number(marker("FIRST_COUNT")) === 2,
  atPoint: Number(marker("AT_COUNT")) === 2,
  circleForward: marker("CIRCLE_FORWARD_TYPES")?.startsWith("ARC:") === true,
  circleReverse: marker("CIRCLE_REVERSE_TYPES")?.startsWith("ARC:") === true,
  arc: Number(marker("ARC_COUNT")) >= 1,
  ellipse: Number(marker("ELLIPSE_COUNT")) === 1,
  openPolyline: Number(marker("OPEN_POLY_COUNT")) === 2,
  closedPolyline: Number(marker("CLOSED_POLY_COUNT")) === 1,
  lockedLayerMeasured: Number(marker("LOCKED_COUNT")) >= 1,
  offLayerMeasured: Number(marker("OFF_COUNT")) >= 1,
  frozenLayerMeasured: Number(marker("FROZEN_COUNT")) >= 1,
  unsupportedMeasured: Number(marker("UNSUPPORTED_COUNT")) === 1,
  completed: marker("DONE")?.startsWith("1") === true,
};
const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
const report = { schemaVersion: 1, rowId: "F-026", benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation", engine: "Autodesk AutoCAD Core Console 2024", engineVersion: marker("ACADVER"), certificationAuthority: false, measurementRole: "native-core-reference; isolated desktop live workflow remains required", markers: Object.fromEntries(["SPLINE_COUNT", "DEFAULT_COUNT", "FIRST_COUNT", "AT_COUNT", "CIRCLE_FORWARD_TYPES", "CIRCLE_REVERSE_TYPES", "ARC_COUNT", "ELLIPSE_COUNT", "OPEN_POLY_COUNT", "CLOSED_POLY_COUNT", "LOCKED_COUNT", "OFF_COUNT", "FROZEN_COUNT", "UNSUPPORTED_COUNT", "DONE"].map((name) => [name, marker(name)])), checks, fixtureSha256: sha256(await readFile(fixturePath)), scriptSha256: sha256(await readFile(scriptPath)), runnerSha256: sha256(await readFile(runnerPath)), observedAt: new Date().toISOString(), status };
if (status !== "PASS") throw new Error(`F-026 AutoCAD Core result mismatch: ${JSON.stringify(report)}\n${output.slice(-8000)}`);
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-026 AutoCAD Core BREAK reference PASS; desktop certification remains required.");
