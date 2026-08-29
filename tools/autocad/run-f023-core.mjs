#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-016-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-023-core.scr");
const runnerPath = resolve(root, "tools/autocad/run-f023-core.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-023-autocad-core.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function decode(buffer) {
  if (buffer.length > 1 && buffer[1] === 0) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

function runCoreConsole() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("AutoCAD Core Console exceeded the 45 second timeout."));
    }, 45_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = decode(Buffer.concat(stdout));
      const errorText = decode(Buffer.concat(stderr));
      if (code !== 0) {
        const diagnostic = output.replace(/\0/gu, "").slice(-8_000);
        reject(new Error(`AutoCAD Core Console exited ${code}: ${errorText}\n${diagnostic}`));
        return;
      }
      resolveRun(output.replace(/\0/gu, ""));
    });
  });
}

const output = await runCoreConsole();
function marker(name) {
  const pattern = new RegExp(`(?:^|\\r?\\n)F023_${name}=([^\\r\\n]*)`, "gmu");
  return [...output.matchAll(pattern)].at(-1)?.[1]?.trim() ?? null;
}
function numbers(name) {
  return [...(marker(name) ?? "").matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu)].map(([value]) => Number(value));
}
function point(name) {
  const values = numbers(name);
  return values.length >= 2 ? values.slice(0, 2) : null;
}
function controlPoints(name) {
  const values = numbers(name);
  if (values.length % 3 !== 0) return null;
  return Array.from({ length: values.length / 3 }, (_, index) => values.slice(index * 3, index * 3 + 2));
}
function state(prefix) {
  return {
    line: { start: point(`${prefix}_LINE_START`), end: point(`${prefix}_LINE_END`) },
    spline: {
      degree: Number(marker(`${prefix}_SPLINE_DEGREE`)),
      knots: numbers(`${prefix}_SPLINE_KNOTS`),
      controlPoints: controlPoints(`${prefix}_SPLINE_CONTROLS`),
    },
  };
}

const states = {
  before: state("BEFORE"),
  standard: state("STANDARD"),
  undo: state("UNDO"),
  quick: state("QUICK"),
  restored: state("RESTORED"),
};
const near = (left, right, tolerance = 0.002) => Math.abs(left - right) <= tolerance;
const nearPoint = (left, right) => Array.isArray(left) && left.length === 2 && left.every((value, index) => near(value, right[index]));
const nearPoints = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => nearPoint(value, right[index]));
const sameState = (left, right) => nearPoint(left.line.start, right.line.start)
  && nearPoint(left.line.end, right.line.end)
  && left.spline.degree === right.spline.degree
  && left.spline.knots.length === right.spline.knots.length
  && left.spline.knots.every((value, index) => near(value, right.spline.knots[index]))
  && nearPoints(left.spline.controlPoints, right.spline.controlPoints);
const expectedTail = [[800, 0], [866.6667, 66.6667], [933.3333, 133.3333], [1000, 200]];

const checks = {
  version: marker("ACADVER")?.startsWith("24.3") === true,
  beforeLine: nearPoint(states.before.line.start, [200, 500]) && nearPoint(states.before.line.end, [800, 500]),
  beforeSpline: states.before.spline.degree === 3 && states.before.spline.controlPoints?.length === 7 && states.before.spline.knots.length === 11,
  standardLine: nearPoint(states.standard.line.end, [1000, 500]),
  standardSpline: states.standard.spline.degree === 3
    && states.standard.spline.controlPoints?.length === 10
    && states.standard.spline.knots.length === 14
    && nearPoints(states.standard.spline.controlPoints.slice(-4), expectedTail),
  commandUndo: sameState(states.undo, states.before),
  quickMatchesStandard: sameState(states.quick, states.standard),
  globalUndo: sameState(states.restored, states.before),
  edgeExtend: nearPoint(point("EDGE_END"), [100, 1000]),
  completed: output.includes("F023_DONE=1"),
};
const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
const result = {
  schemaVersion: 1,
  rowId: "F-023",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  command: "EXTEND",
  certificationAuthority: false,
  measurementRole: "native-core-reference; desktop live workflow remains required",
  states,
  checks,
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  observedAt: new Date().toISOString(),
  status,
};
if (status !== "PASS") throw new Error(`F-023 AutoCAD Core result mismatch: ${JSON.stringify(result)}\n${output.slice(-5_000)}`);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-023 AutoCAD Core PASS (Standard + Quick line/SPLINE extension, command and global undo).");
