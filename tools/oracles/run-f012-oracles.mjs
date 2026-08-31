#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { probeOracles } from "./probe-tools.mjs";
import { verifyNetworkIsolationAttestation } from "./network-isolation.mjs";
import { isolatedEnvironment, readPdf, run } from "./run-fixtures.mjs";

const root = process.cwd();
const sourcePath = resolve(root, "evidence/artifacts/F-012-kuubik.dxf");
const readbackPath = resolve(root, "evidence/artifacts/F-012-independent-readback.json");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-012-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-f012-headless.py");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const pointClose = (left, right) => close(left?.x, right?.x) && close(left?.y, right?.y);
const sourcePaths = [
  "tools/oracles/freecad-f012-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f012-oracles.mjs",
];

function parseJsonLine(stdout) {
  const line = stdout.split(/\r?\n/u).find((item) => item.trimStart().startsWith("{"));
  if (!line) throw new Error(`FreeCAD F-012 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
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
  const input = join(directory, "F-012-kuubik.dxf");
  const output = join(directory, "F-012-librecad.pdf");
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
    splineCurvesPresent: pdf.vectorOperators.paintedPathOperators > 0 && pdf.vectorOperators.cubicCurveOperators >= 3,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-012 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return { fixture: "F-012 production SPLINE DXF rendered by LibreCAD 2.2.1.5", inputSha256: sha256(sourceBytes), output: pdf, checks };
}

async function runFreeCad(tool, environment, directory, fixture) {
  const input = `${JSON.stringify({ operation: "spline-output-readback", splines: fixture })}\n`;
  const script = join(directory, "freecad-f012-headless.py");
  await writeFile(script, await readFile(freeCadScriptPath));
  const process = run(tool.executable, ["--safe-mode", "-u", join(directory, "freecad-user.cfg"), "-s", join(directory, "freecad-system.cfg"), script], {
    cwd: directory,
    env: await isolatedEnvironment(environment, directory),
    input,
  });
  const output = parseJsonLine(process.stdout);
  const byId = Object.fromEntries((output.result ?? []).map((item) => [item.id, item]));
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(output.freecadVersion) && output.freecadVersion[0] === "1" && output.freecadVersion[1] === "1" && output.freecadVersion[2] === "3",
    exactPinnedCommit: Array.isArray(output.freecadVersion) && output.freecadVersion.includes("145529fe741292ff0b3977a01195bf0247425794"),
    everySplineReconstructed: fixture.every((expected) => {
      const actual = byId[expected.id];
      const normalizedExpected = expected.weights.map((weight) => weight / expected.weights[0]);
      const normalizedActual = actual?.weights?.map((weight) => weight / actual.weights[0]);
      return actual && actual.degree === expected.degree && actual.length > 0
        && normalizedActual?.every((weight, index) => close(weight, normalizedExpected[index], 1e-12))
        && JSON.stringify(actual.knots) === JSON.stringify(expected.knots)
        && JSON.stringify(actual.multiplicities) === JSON.stringify(expected.multiplicities)
        && expected.controlPoints.every((point, index) => pointClose(actual.poles[index], point))
        && pointClose(actual.start, expected.start)
        && pointClose(actual.end, expected.end);
    }),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-012 curve mismatch: ${JSON.stringify({ checks, output, fixture })}`);
  return { fixture: "F-012 open/closed Fit, rational/Object/Fit-Kink/Add-Elevate CV and open/rational/repeated/minimum/periodic/quadratic CV-Delete SPLINE representations independently rebuilt by FreeCAD 1.1.3/OCCT", inputSha256: sha256(input), output, checks };
}

const sourceBytes = await readFile(sourcePath);
const readbackBytes = await readFile(readbackPath);
const readback = JSON.parse(readbackBytes.toString("utf8"));
const fixture = readback.committedDocument.entities.filter(({ kind }) => kind === "spline").map((entity) => ({
  id: entity.handle,
  degree: entity.degree,
  controlPoints: entity.controlPoints,
  weights: entity.weights ?? entity.controlPoints.map(() => 1),
  ...uniqueKnots(entity.knots),
  start: readback.evaluatedEndpointsByHandle?.[entity.handle]?.start,
  end: readback.evaluatedEndpointsByHandle?.[entity.handle]?.end,
}));
if (fixture.length !== 11 || !fixture.some(({ id }) => id === "50") || !fixture.some(({ id }) => id === "70") || !fixture.some(({ id, degree }) => id === "80" && degree === 4) || !fixture.some(({ id, degree, controlPoints }) => id === "90" && degree === 3 && controlPoints.length === 4) || !fixture.some(({ id, degree, controlPoints }) => id === "91" && degree === 3 && controlPoints.length === 5) || !fixture.some(({ id, degree }) => id === "92" && degree === 2) || !fixture.some(({ id }) => id === "93") || !fixture.some(({ id, degree }) => id === "94" && degree === 2)) throw new Error(`F-012 oracle source matrix mismatch: ${JSON.stringify(fixture)}`);

const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) { reports.push(publicTool); continue; }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f012-${tool.oracle}-`));
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
        inputPolicy: "synthetic-generated-F-012-output-only",
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
  rowId: "F-012",
  certificationAuthority: false,
  generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-012-kuubik.dxf",
  sourceArtifactSha256: sha256(sourceBytes),
  readbackArtifact: "evidence/artifacts/F-012-independent-readback.json",
  readbackArtifactSha256: sha256(readbackBytes),
  fixture,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  networkIsolation,
  reports,
  status: reports.some((report) => report.status === "FAIL") ? "FAIL" : "SECONDARY_ORACLE_REPORT_COMPLETE",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exitCode = 1;
