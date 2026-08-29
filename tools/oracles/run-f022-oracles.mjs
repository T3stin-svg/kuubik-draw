#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { probeOracles } from "./probe-tools.mjs";
import { verifyNetworkIsolationAttestation } from "./network-isolation.mjs";
import { isolatedEnvironment, readPdf, run } from "./run-fixtures.mjs";

const root = process.cwd();
const sourcePath = resolve(root, "evidence/artifacts/F-022-kuubik.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-022-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-headless.py");
const runnerPath = resolve(root, "tools/oracles/run-f022-oracles.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourcePaths = [
  "tools/oracles/freecad-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f022-oracles.mjs",
];
const close = (left, right, tolerance = 1e-7) => Math.abs(left - right) <= tolerance;

function parseJsonLine(stdout) {
  const jsonLine = stdout.split(/\r?\n/u).find((line) => line.trimStart().startsWith("{"));
  if (!jsonLine) throw new Error(`FreeCAD F-022 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
  return JSON.parse(jsonLine);
}

async function runLibreCad(tool, environment, directory, sourceBytes) {
  const input = join(directory, "F-022-kuubik.dxf");
  const output = join(directory, "F-022-librecad.pdf");
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
    vectorGeometryPresent: pdf.vectorOperators.paintedPathOperators > 0
      && pdf.vectorOperators.lineToOperators > 0
      && pdf.vectorOperators.cubicCurveOperators > 0,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-022 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return {
    fixture: "F-022 production TRIM DXF rendered by LibreCAD 2.2.1.5",
    inputSha256: sha256(sourceBytes),
    output: pdf,
    checks,
  };
}

async function runFreeCad(tool, environment, directory) {
  const payload = {
    operation: "spline-intersections",
    controlPoints: [
      { x: 0, y: 0 }, { x: 100 / 3, y: 100 },
      { x: 200 / 3, y: -100 }, { x: 100, y: 0 },
    ],
    boundaries: [
      [{ x: 25, y: -100 }, { x: 25, y: 100 }],
      [{ x: 75, y: -100 }, { x: 75, y: 100 }],
    ],
  };
  const input = `${JSON.stringify(payload)}\n`;
  const script = join(directory, "freecad-headless.py");
  await writeFile(script, await readFile(freeCadScriptPath));
  const process = run(tool.executable, [
    "--safe-mode",
    "-u", join(directory, "freecad-user.cfg"),
    "-s", join(directory, "freecad-system.cfg"),
    script,
  ], {
    cwd: directory,
    env: await isolatedEnvironment(environment, directory),
    input,
  });
  const output = parseJsonLine(process.stdout);
  const version = output.freecadVersion;
  const intersections = output.result?.intersections;
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(version) && version[0] === "1" && version[1] === "1" && version[2] === "3",
    exactPinnedCommit: Array.isArray(version) && version.includes("145529fe741292ff0b3977a01195bf0247425794"),
    cubicSplineTopology: output.result?.degree === 3 && output.result?.poleCount === 4,
    exactIntersections: Array.isArray(intersections) && intersections.length === 2
      && close(intersections[0]?.x, 25) && close(intersections[0]?.y, 28.125)
      && close(intersections[1]?.x, 75) && close(intersections[1]?.y, -28.125),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-022 geometry mismatch: ${JSON.stringify({ checks, output })}`);
  return {
    fixture: "F-022 cubic SPLINE intersections independently evaluated by FreeCAD/OCCT",
    inputSha256: sha256(input),
    output,
    checks,
  };
}

const sourceBytes = await readFile(sourcePath);
const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) {
    reports.push(publicTool);
    continue;
  }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f022-${tool.oracle}-`));
  try {
    const fixtureReport = tool.oracle === "librecad"
      ? await runLibreCad(tool, process.env, directory, sourceBytes)
      : await runFreeCad(tool, process.env, directory);
    reports.push({
      ...publicTool,
      status: networkIsolation.proven ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
      certificationAuthority: false,
      sandbox: {
        disposableDirectory: true,
        inputPolicy: "synthetic-and-generated-F-022-output-only",
        networkIsolationProven: networkIsolation.proven,
        networkPolicy: networkIsolation.proven
          ? "signed protected-runner os-egress-deny attestation"
          : "not isolated; dead-proxy variables are defense in depth only",
        timeoutMs: 30_000,
        oneProcessPerFixture: true,
      },
      fixtureReport,
    });
  } catch (error) {
    reports.push({
      ...publicTool,
      status: "FAIL",
      certificationAuthority: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const result = {
  schemaVersion: 1,
  rowId: "F-022",
  certificationAuthority: false,
  generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-022-kuubik.dxf",
  sourceArtifactSha256: sha256(sourceBytes),
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
