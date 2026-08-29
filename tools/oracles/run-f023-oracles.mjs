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
const sourcePath = resolve(root, "evidence/artifacts/F-023-browser-spline.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-023-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-headless.py");
const runnerPath = resolve(root, "tools/oracles/run-f023-oracles.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-8) => Math.abs(left - right) <= tolerance;
const closeList = (left, right, tolerance = 1e-8) => Array.isArray(left) && left.length === right.length
  && left.every((value, index) => Array.isArray(value)
    ? closeList(value, right[index], tolerance)
    : close(value, right[index], tolerance));
const sourcePaths = [
  "tools/oracles/freecad-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f023-oracles.mjs",
];

function rawSplineWeights(text) {
  const lines = text.replace(/\r/gu, "").split("\n");
  const records = []; let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index].trim(); const value = lines[index + 1].trim();
    if (code === "0") { if (current) records.push(current); current = value === "SPLINE" ? { handle: null, weights: [] } : null; }
    else if (current && code === "5") current.handle = value;
    else if (current && code === "41") current.weights.push(Number(value));
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.handle, record.weights]));
}

function splineFromDxf(bytes) {
  const text = bytes.toString("utf8");
  const parsed = new DxfParser().parseSync(text);
  const entity = (parsed?.entities ?? []).find((candidate) => candidate.type === "SPLINE");
  if (!entity) throw new Error("F-023 oracle source has no SPLINE.");
  const weights = rawSplineWeights(text).get(entity.handle) ?? [];
  const knots = entity.knotValues ?? [];
  const distinctKnots = []; const multiplicities = [];
  for (const knot of knots) {
    if (distinctKnots.length === 0 || !close(knot, distinctKnots.at(-1), 1e-12)) { distinctKnots.push(knot); multiplicities.push(1); }
    else multiplicities[multiplicities.length - 1] += 1;
  }
  return {
    handle: entity.handle,
    degree: entity.degreeOfSplineCurve,
    controlPoints: entity.controlPoints?.map(({ x, y }) => ({ x, y })) ?? [],
    knots: distinctKnots,
    multiplicities,
    weights,
    rational: entity.rational === true,
  };
}

function parseJsonLine(stdout) {
  const jsonLine = stdout.split(/\r?\n/u).find((line) => line.trimStart().startsWith("{"));
  if (!jsonLine) throw new Error(`FreeCAD F-023 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
  return JSON.parse(jsonLine);
}

async function runLibreCad(tool, environment, directory, sourceBytes) {
  const input = join(directory, "F-023-browser-spline.dxf");
  const output = join(directory, "F-023-librecad.pdf");
  await writeFile(input, sourceBytes);
  const process = run(tool.executable, ["dxf2pdf", "--fit", "--paper", "210x297", "-o", output, input], {
    cwd: directory, env: await isolatedEnvironment(environment, directory),
  });
  const pdf = readPdf(await readFile(output));
  const checks = {
    exitCodeZero: process.status === 0,
    exactBrowserDxfInput: sha256(await readFile(input)) === sha256(sourceBytes),
    validSinglePageVectorPdf: pdf.hasPdfHeader && pdf.hasEof && pdf.pages === 1 && pdf.imageXObjects === 0,
    vectorSplineAndBoundaryPresent: pdf.vectorOperators.paintedPathOperators > 0
      && pdf.vectorOperators.lineToOperators > 0 && pdf.vectorOperators.cubicCurveOperators > 0,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-023 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return { fixture: "F-023 browser EXTEND DXF rendered by LibreCAD 2.2.1.5", inputSha256: sha256(sourceBytes), output: pdf, checks };
}

async function runFreeCad(tool, environment, directory, sourceSpline) {
  const finalParameter = sourceSpline.knots.at(-1);
  const payload = {
    operation: "rational-spline-readback",
    degree: sourceSpline.degree,
    controlPoints: sourceSpline.controlPoints,
    multiplicities: sourceSpline.multiplicities,
    knots: sourceSpline.knots,
    weights: sourceSpline.weights,
    sampleParameters: [sourceSpline.knots[0], 1, finalParameter],
  };
  const input = `${JSON.stringify(payload)}\n`;
  const script = join(directory, "freecad-headless.py");
  await writeFile(script, await readFile(freeCadScriptPath));
  const process = run(tool.executable, ["--safe-mode", "-u", join(directory, "freecad-user.cfg"), "-s", join(directory, "freecad-system.cfg"), script], {
    cwd: directory, env: await isolatedEnvironment(environment, directory), input,
  });
  const output = parseJsonLine(process.stdout); const version = output.freecadVersion; const result = output.result;
  const expectedPoints = sourceSpline.controlPoints.map(({ x, y }) => [x, y]);
  const actualPoints = result?.poles?.map(({ x, y }) => [x, y]);
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(version) && version[0] === "1" && version[1] === "1" && version[2] === "3",
    exactPinnedCommit: Array.isArray(version) && version.includes("145529fe741292ff0b3977a01195bf0247425794"),
    exactRationalTopology: result?.degree === sourceSpline.degree && result?.poleCount === sourceSpline.controlPoints.length
      && result?.rational === true && closeList(result?.knots, sourceSpline.knots) && closeList(result?.multiplicities, sourceSpline.multiplicities),
    exactPolesAndWeights: closeList(actualPoints, expectedPoints) && closeList(result?.weights, sourceSpline.weights),
    exactJoinAndEndpoint: closeList([result?.samples?.[1]?.x, result?.samples?.[1]?.y], [3, 0])
      && closeList([result?.samples?.[2]?.x, result?.samples?.[2]?.y], expectedPoints.at(-1)),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-023 rational SPLINE mismatch: ${JSON.stringify({ checks, output })}`);
  return { fixture: "F-023 rational SPLINE independently rebuilt and evaluated by FreeCAD/OCCT", inputSha256: sha256(input), output, checks };
}

const sourceBytes = await readFile(sourcePath); const sourceSpline = splineFromDxf(sourceBytes);
if (sourceSpline.degree !== 3 || sourceSpline.controlPoints.length !== 7 || !sourceSpline.rational
  || !closeList(sourceSpline.knots, [0, 1, 1.621334927543]) || !closeList(sourceSpline.multiplicities, [4, 3, 4])) {
  throw new Error(`F-023 oracle source mismatch: ${JSON.stringify(sourceSpline)}`);
}
const probes = await probeOracles(); const networkIsolation = await verifyNetworkIsolationAttestation(probes); const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) { reports.push(publicTool); continue; }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f023-${tool.oracle}-`));
  try {
    const fixtureReport = tool.oracle === "librecad"
      ? await runLibreCad(tool, process.env, directory, sourceBytes)
      : await runFreeCad(tool, process.env, directory, sourceSpline);
    reports.push({
      ...publicTool,
      status: networkIsolation.proven ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
      certificationAuthority: false,
      sandbox: {
        disposableDirectory: true, inputPolicy: "synthetic-generated-F-023-output-only",
        networkIsolationProven: networkIsolation.proven,
        networkPolicy: networkIsolation.proven ? "signed protected-runner os-egress-deny attestation" : "not isolated; dead-proxy variables are defense in depth only",
        timeoutMs: 30_000, oneProcessPerFixture: true,
      },
      fixtureReport,
    });
  } catch (error) {
    reports.push({ ...publicTool, status: "FAIL", certificationAuthority: false, reason: error instanceof Error ? error.message : String(error) });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const result = {
  schemaVersion: 1, rowId: "F-023", certificationAuthority: false, generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-023-browser-spline.dxf", sourceArtifactSha256: sha256(sourceBytes),
  sourceSpline,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  runnerSha256: sha256(await readFile(runnerPath)), freeCadScriptSha256: sha256(await readFile(freeCadScriptPath)), networkIsolation, reports,
  status: reports.some((report) => report.status === "FAIL") ? "FAIL" : "SECONDARY_ORACLE_REPORT_COMPLETE",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exitCode = 1;
