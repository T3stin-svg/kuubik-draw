#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { probeOracles } from "./probe-tools.mjs";
import { verifyNetworkIsolationAttestation } from "./network-isolation.mjs";
import { isolatedEnvironment, readPdf, run } from "./run-fixtures.mjs";

const root = process.cwd();
const sourcePath = resolve(root, "evidence/artifacts/F-028-kuubik.dxf");
const readbackPath = resolve(root, "evidence/artifacts/F-028-independent-readback.json");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-028-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-f028-headless.py");
const runnerPath = resolve(root, "tools/oracles/run-f028-oracles.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const pointClose = (left, right) => close(left?.x, right?.x) && close(left?.y, right?.y);
const sourcePaths = [
  "tools/oracles/freecad-f028-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f028-oracles.mjs",
];

function parseJsonLine(stdout) {
  const line = stdout.split(/\r?\n/u).find((item) => item.trimStart().startsWith("{"));
  if (!line) throw new Error(`FreeCAD F-028 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
  return JSON.parse(line);
}

function uniqueKnots(values) {
  const knots = [];
  const multiplicities = [];
  for (const value of values) {
    if (knots.length && close(knots.at(-1), value, 1e-12)) multiplicities[multiplicities.length - 1] += 1;
    else { knots.push(value); multiplicities.push(1); }
  }
  return { knots, multiplicities };
}

async function runLibreCad(tool, environment, directory, sourceBytes) {
  const input = join(directory, "F-028-kuubik.dxf");
  const output = join(directory, "F-028-librecad.pdf");
  await writeFile(input, sourceBytes);
  const process = run(tool.executable, ["dxf2pdf", "--fit", "--paper", "210x297", "-o", output, input], {
    cwd: directory,
    env: await isolatedEnvironment(environment, directory),
  });
  const pdf = readPdf(await readFile(output));
  const checks = {
    exitCodeZero: process.status === 0,
    exactProductionDxfInput: sha256(await readFile(input)) === sha256(sourceBytes),
    validSinglePageVectorPdf: pdf.hasPdfHeader && pdf.hasEof && pdf.pages === 1 && pdf.imageXObjects === 0,
    vectorLengthenGeometryPresent: pdf.vectorOperators.paintedPathOperators > 0
      && pdf.vectorOperators.lineToOperators > 0
      && pdf.vectorOperators.cubicCurveOperators > 0,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-028 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return { fixture: "F-028 production LENGTHEN DXF rendered by LibreCAD 2.2.1.5", inputSha256: sha256(sourceBytes), output: pdf, checks };
}

async function runFreeCad(tool, environment, directory, fixture) {
  const input = `${JSON.stringify({ operation: "lengthen-output-readback", ...fixture })}\n`;
  const script = join(directory, "freecad-f028-headless.py");
  await writeFile(script, await readFile(freeCadScriptPath));
  const process = run(tool.executable, ["--safe-mode", "-u", join(directory, "freecad-user.cfg"), "-s", join(directory, "freecad-system.cfg"), script], {
    cwd: directory,
    env: await isolatedEnvironment(environment, directory),
    input,
  });
  const output = parseJsonLine(process.stdout);
  const linesById = Object.fromEntries((output.result?.lines ?? []).map((item) => [item.id, item]));
  const splinesById = Object.fromEntries((output.result?.splines ?? []).map((item) => [item.id, item]));
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(output.freecadVersion) && output.freecadVersion[0] === "1" && output.freecadVersion[1] === "1" && output.freecadVersion[2] === "3",
    exactPinnedCommit: Array.isArray(output.freecadVersion) && output.freecadVersion.includes("145529fe741292ff0b3977a01195bf0247425794"),
    everyLineReconstructed: fixture.lines.every((item) => pointClose(linesById[item.id]?.start, item.start)
      && pointClose(linesById[item.id]?.end, item.end)
      && close(linesById[item.id]?.length, Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y))),
    everySplineReconstructed: fixture.splines.every((item) => {
      const actual = splinesById[item.id];
      const normalizedExpected = item.weights.map((weight) => weight / item.weights[0]);
      const normalizedActual = actual?.weights?.map((weight) => weight / actual.weights[0]);
      return actual && actual.degree === item.degree && actual.rational === true && actual.length > 0
        && normalizedActual?.every((weight, index) => close(weight, normalizedExpected[index], 1e-12))
        && JSON.stringify(actual.knots) === JSON.stringify(item.knots)
        && JSON.stringify(actual.multiplicities) === JSON.stringify(item.multiplicities)
        && item.controlPoints.every((point, index) => pointClose(actual.poles[index], point));
    }),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-028 curve mismatch: ${JSON.stringify({ checks, output, fixture })}`);
  return { fixture: "F-028 lengthened line and unchanged rational control-point SPLINE independently rebuilt by FreeCAD 1.1.3/OCCT", inputSha256: sha256(input), output, checks };
}

const sourceBytes = await readFile(sourcePath);
const readbackBytes = await readFile(readbackPath);
const readback = JSON.parse(readbackBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(sourceBytes.toString("utf8"));
const lines = (dxf?.entities ?? []).filter(({ type }) => type === "LINE").map((entity) => ({ id: entity.handle, start: entity.vertices[0], end: entity.vertices[1] }));
const splines = (readback.expected ?? []).filter(({ kind }) => kind === "spline").map((entity) => ({
  id: entity.handle,
  degree: entity.degree,
  controlPoints: entity.controlPoints,
  weights: entity.weights,
  ...uniqueKnots(entity.knots),
}));
const fixture = { lines, splines };
if (lines.length !== 1 || splines.length !== 1) throw new Error(`F-028 oracle source matrix mismatch: ${JSON.stringify(fixture)}`);

const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) { reports.push(publicTool); continue; }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f028-${tool.oracle}-`));
  try {
    const fixtureReport = tool.oracle === "librecad"
      ? await runLibreCad(tool, process.env, directory, sourceBytes)
      : await runFreeCad(tool, process.env, directory, fixture);
    reports.push({
      ...publicTool,
      status: networkIsolation.proven ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
      certificationAuthority: false,
      sandbox: {
        disposableDirectory: true,
        inputPolicy: "synthetic-generated-F-028-output-only",
        networkIsolationProven: networkIsolation.proven,
        networkPolicy: networkIsolation.proven ? "signed protected-runner os-egress-deny attestation" : "not isolated; dead-proxy variables are defense in depth only",
        timeoutMs: 30_000,
        oneProcessPerFixture: true,
      },
      fixtureReport,
    });
  } catch (error) {
    reports.push({ ...publicTool, status: "FAIL", certificationAuthority: false, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const result = {
  schemaVersion: 1,
  rowId: "F-028",
  certificationAuthority: false,
  generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-028-kuubik.dxf",
  sourceArtifactSha256: sha256(sourceBytes),
  readbackArtifact: "evidence/artifacts/F-028-independent-readback.json",
  readbackArtifactSha256: sha256(readbackBytes),
  fixture,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  runnerSha256: sha256(await readFile(runnerPath)),
  freeCadScriptSha256: sha256(await readFile(freeCadScriptPath)),
  networkIsolation,
  reports,
  status: reports.some((report) => report.status === "FAIL") ? "FAIL" : "SECONDARY_ORACLE_REPORT_COMPLETE",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exitCode = 1;
