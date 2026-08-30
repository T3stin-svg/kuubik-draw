#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const compiler = process.env.CSC ?? "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const autoCadRoot = process.env.AUTOCAD_ROOT ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024";
const fixturePath = resolve(root, "evidence/artifacts/F-027-kuubik.dxf");
const scriptPath = resolve(root, "parity/autocad/F-027-core-measure.scr");
const pluginSourcePath = resolve(root, "tools/autocad/F027StretchPoints.cs");
const probeDirectory = await mkdtemp(join(tmpdir(), "kuubik-f027-"));
const pluginPath = join(probeDirectory, "F027StretchPoints.dll");
const runnerPath = resolve(root, "tools/autocad/run-f027-core.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-027-autocad-core.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (buffer) => buffer.length > 1 && buffer[1] === 0 ? buffer.toString("utf16le") : buffer.toString("utf8");

function run(command, args, timeoutMs, label) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, F027_PLUGIN: pluginPath }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${label} exceeded ${timeoutMs / 1000} seconds.`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const text = decode(Buffer.concat(stdout)).replaceAll("\0", "");
      const errorText = decode(Buffer.concat(stderr)).replaceAll("\0", "");
      if (code !== 0) reject(new Error(`${label} exited ${code}: ${errorText}\n${text.slice(-8000)}`));
      else resolveRun(text);
    });
  });
}

await run(compiler, [
  "/nologo", "/target:library", `/out:${pluginPath}`,
  `/reference:${join(autoCadRoot, "accoremgd.dll")}`,
  `/reference:${join(autoCadRoot, "acdbmgd.dll")}`,
  `/reference:${join(autoCadRoot, "acmgd.dll")}`,
  pluginSourcePath,
], 30_000, "F-027 stretch-point probe compile");
const output = await run(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], 60_000, "F-027 AutoCAD Core Console");

function marker(name) {
  return [...output.matchAll(new RegExp(`(?:^|\\r?\\n)F027_${name}=([^\\r\\n]*)`, "gmu"))].at(-1)?.[1]?.trim() ?? null;
}
function numbers(name) {
  return (marker(name)?.match(/-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/g) ?? []).map(Number);
}
const close = (actual, expected, tolerance = 1e-9) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const checks = {
  version: marker("ACADVER")?.startsWith("24.3") === true,
  lineStart: numbers("LINE_START").slice(0, 2).every((value, index) => close(value, [0, 0][index])),
  lineEnd: numbers("LINE_END").slice(0, 2).every((value, index) => close(value, [125, 5][index])),
  polylineVertices: marker("POLY_VERTICES")?.includes("[125.0000000000000,105.0000000000000") === true,
  circleCenterMoves: numbers("CIRCLE_CENTER").slice(0, 2).every((value, index) => close(value, [105, 55][index])),
  arcCenter: numbers("ARC_CENTER").slice(0, 2).every((value, index) => close(value, [312.7957603151085, -10.80921417988332][index], 1e-10)),
  arcRadius: close(numbers("ARC_RADIUS")[0], 113.3125, 1e-10),
  arcParameters: close(numbers("ARC_START")[0], 0.139975357410291, 1e-12) && close(numbers("ARC_END")[0], 3.04605442683294, 1e-12),
  halfEllipseCenter: numbers("ELLIPSE_CENTER").slice(0, 2).every((value, index) => close(value, [612.5, 2.5][index], 1e-10)),
  halfEllipseMajor: numbers("ELLIPSE_MAJOR").slice(0, 2).every((value, index) => close(value, [-112.5, -2.5][index], 1e-10)),
  halfEllipseRatio: close(numbers("ELLIPSE_RATIO")[0], 0.444334745702938, 1e-12),
  quarterEllipse: numbers("ELLIPSE_QUARTER_CENTER").slice(0, 2).every((value, index) => close(value, [1009.852004872791, -1.07776424224631][index], 1e-10))
    && numbers("ELLIPSE_QUARTER_MAJOR").slice(0, 2).every((value, index) => close(value, [115.564843901568, 2.120881991279924][index], 1e-10))
    && close(numbers("ELLIPSE_QUARTER_RATIO")[0], 0.444723039979619, 1e-12)
    && close(numbers("ELLIPSE_QUARTER_START")[0], 0.077190120252004, 1e-12)
    && close(numbers("ELLIPSE_QUARTER_END")[0], 1.647986447046899, 1e-12),
  arbitraryEllipse: numbers("ELLIPSE_ARBITRARY_CENTER").slice(0, 2).every((value, index) => close(value, [1411.829841509392, 1.85597636325139][index], 1e-10))
    && numbers("ELLIPSE_ARBITRARY_MAJOR").slice(0, 2).every((value, index) => close(value, [115.0044951266435, 2.012807544972077][index], 1e-10))
    && close(numbers("ELLIPSE_ARBITRARY_RATIO")[0], 0.436048585567155, 1e-12)
    && close(numbers("ELLIPSE_ARBITRARY_START")[0], 0.325000916237422, 1e-12)
    && close(numbers("ELLIPSE_ARBITRARY_END")[0], 2.225000916237421, 1e-12),
  generalEllipse: numbers("ELLIPSE_GENERAL_CENTER").slice(0, 2).every((value, index) => close(value, [1611.635257118392, 1.727492471203771][index], 1e-10))
    && numbers("ELLIPSE_GENERAL_MAJOR").slice(0, 2).every((value, index) => close(value, [113.458656164376, 1.499879904856769][index], 1e-10))
    && close(numbers("ELLIPSE_GENERAL_RATIO")[0], 0.443593165956495, 1e-12)
    && close(numbers("ELLIPSE_GENERAL_START")[0], 0.035246266949151, 1e-12)
    && close(numbers("ELLIPSE_GENERAL_END")[0], 2.235246266949152, 1e-12),
  rotatedHalfEllipse: numbers("ELLIPSE_ROTATED_CENTER").slice(0, 2).every((value, index) => close(value, [1812.5, 2.5][index], 1e-10))
    && numbers("ELLIPSE_ROTATED_MAJOR").slice(0, 2).every((value, index) => close(value, [-92.5, -62.5][index], 1e-10))
    && close(numbers("ELLIPSE_ROTATED_RATIO")[0], 0.447885929022389, 1e-12)
    && close(numbers("ELLIPSE_ROTATED_START")[0], Math.PI, 1e-12)
    && close(numbers("ELLIPSE_ROTATED_END")[0], Math.PI * 2, 1e-12),
  fullEllipseEdgeDoesNotStretch: numbers("ELLIPSE_FULL_EDGE_CENTER").slice(0, 2).every((value, index) => close(value, [2100, 0][index]))
    && numbers("ELLIPSE_FULL_EDGE_MAJOR").slice(0, 2).every((value, index) => close(value, [100, 0][index]))
    && close(numbers("ELLIPSE_FULL_EDGE_RATIO")[0], 0.5),
  fullEllipseCenterWindowDoesNotSelectGeometry: numbers("ELLIPSE_FULL_CENTER_CENTER").slice(0, 2).every((value, index) => close(value, [2400, 0][index]))
    && numbers("ELLIPSE_FULL_CENTER_MAJOR").slice(0, 2).every((value, index) => close(value, [100, 0][index]))
    && close(numbers("ELLIPSE_FULL_CENTER_RATIO")[0], 0.5),
  edgeOnlyCircleDoesNotMove: numbers("EDGE_CIRCLE_CENTER").slice(0, 2).every((value, index) => close(value, [900, 0][index])),
  individualMovesWhole: numbers("INDIVIDUAL_START").slice(0, 2).every((value, index) => close(value, [25, 505][index], 1e-9))
    && numbers("INDIVIDUAL_END").slice(0, 2).every((value, index) => close(value, [125, 505][index], 1e-9)),
  nativeStretchPointsObserved: output.includes("F027_STRETCH_POINTS=F027_ARC|Arc") && output.includes("F027_STRETCH_POINTS=F027_ELLIPSE|Ellipse"),
  completed: marker("DONE")?.startsWith("1") === true,
};
const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
const markerNames = [
  "LINE_START", "LINE_END", "POLY_VERTICES", "CIRCLE_CENTER", "ARC_CENTER", "ARC_RADIUS", "ARC_START", "ARC_END",
  "ELLIPSE_CENTER", "ELLIPSE_MAJOR", "ELLIPSE_RATIO", "ELLIPSE_START", "ELLIPSE_END",
  "ELLIPSE_QUARTER_CENTER", "ELLIPSE_QUARTER_MAJOR", "ELLIPSE_QUARTER_RATIO", "ELLIPSE_QUARTER_START", "ELLIPSE_QUARTER_END",
  "ELLIPSE_ARBITRARY_CENTER", "ELLIPSE_ARBITRARY_MAJOR", "ELLIPSE_ARBITRARY_RATIO", "ELLIPSE_ARBITRARY_START", "ELLIPSE_ARBITRARY_END",
  "ELLIPSE_GENERAL_CENTER", "ELLIPSE_GENERAL_MAJOR", "ELLIPSE_GENERAL_RATIO", "ELLIPSE_GENERAL_START", "ELLIPSE_GENERAL_END",
  "ELLIPSE_ROTATED_CENTER", "ELLIPSE_ROTATED_MAJOR", "ELLIPSE_ROTATED_RATIO", "ELLIPSE_ROTATED_START", "ELLIPSE_ROTATED_END",
  "ELLIPSE_FULL_EDGE_CENTER", "ELLIPSE_FULL_EDGE_MAJOR", "ELLIPSE_FULL_EDGE_RATIO",
  "ELLIPSE_FULL_CENTER_CENTER", "ELLIPSE_FULL_CENTER_MAJOR", "ELLIPSE_FULL_CENTER_RATIO",
  "EDGE_CIRCLE_CENTER", "INDIVIDUAL_START", "INDIVIDUAL_END", "DONE",
];
const report = {
  schemaVersion: 1,
  rowId: "F-027",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  certificationAuthority: false,
  measurementRole: "native-core-reference; isolated desktop live crossing workflow remains required",
  markers: Object.fromEntries(markerNames.map((name) => [name, marker(name)])),
  stretchPointObservations: output.split(/\r?\n/).filter((line) => line.startsWith("F027_STRETCH_POINTS=")),
  checks,
  knownImplementationGaps: [
    "A physical crossing-polygon gesture and isolated AutoCAD Desktop live evidence remain required before score 1.00.",
  ],
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  pluginSourceSha256: sha256(await readFile(pluginSourcePath)),
  pluginBinarySha256: sha256(await readFile(pluginPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  observedAt: new Date().toISOString(),
  status,
};
if (status !== "PASS") throw new Error(`F-027 AutoCAD Core result mismatch: ${JSON.stringify(report)}\n${output.slice(-8000)}`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-027 AutoCAD Core STRETCH reference PASS; crossing-polygon/Desktop gates remain.");
