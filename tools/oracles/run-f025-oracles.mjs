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
const sourcePath = resolve(root, "evidence/artifacts/F-025-browser.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-025-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-f025-headless.py");
const runnerPath = resolve(root, "tools/oracles/run-f025-oracles.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const pointClose = (left, right) => close(left?.x, right?.x) && close(left?.y, right?.y);
const sourcePaths = [
  "tools/oracles/freecad-f025-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f025-oracles.mjs",
];

function parseJsonLine(stdout) {
  const line = stdout.split(/\r?\n/u).find((item) => item.trimStart().startsWith("{"));
  if (!line) throw new Error(`FreeCAD F-025 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
  return JSON.parse(line);
}

async function runLibreCad(tool, environment, directory, sourceBytes) {
  const input = join(directory, "F-025-browser.dxf");
  const output = join(directory, "F-025-librecad.pdf");
  await writeFile(input, sourceBytes);
  const process = run(tool.executable, ["dxf2pdf", "--fit", "--paper", "210x297", "-o", output, input], {
    cwd: directory, env: await isolatedEnvironment(environment, directory),
  });
  const pdf = readPdf(await readFile(output));
  const checks = {
    exitCodeZero: process.status === 0,
    exactBrowserDxfInput: sha256(await readFile(input)) === sha256(sourceBytes),
    validSinglePageVectorPdf: pdf.hasPdfHeader && pdf.hasEof && pdf.pages === 1 && pdf.imageXObjects === 0,
    vectorChamferNetworkPresent: pdf.vectorOperators.paintedPathOperators > 0 && pdf.vectorOperators.lineToOperators >= 6,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-025 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return { fixture: "F-025 browser CHAMFER DXF rendered by LibreCAD 2.2.1.5", inputSha256: sha256(sourceBytes), output: pdf, checks };
}

async function runFreeCad(tool, environment, directory, segments) {
  const payload = { operation: "line-network-readback", segments };
  const input = `${JSON.stringify(payload)}\n`;
  const script = join(directory, "freecad-f025-headless.py");
  await writeFile(script, await readFile(freeCadScriptPath));
  const process = run(tool.executable, ["--safe-mode", "-u", join(directory, "freecad-user.cfg"), "-s", join(directory, "freecad-system.cfg"), script], {
    cwd: directory, env: await isolatedEnvironment(environment, directory), input,
  });
  const output = parseJsonLine(process.stdout);
  const byId = Object.fromEntries((output.result ?? []).map((item) => [item.id, item]));
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(output.freecadVersion) && output.freecadVersion[0] === "1" && output.freecadVersion[1] === "1" && output.freecadVersion[2] === "3",
    exactPinnedCommit: Array.isArray(output.freecadVersion) && output.freecadVersion.includes("145529fe741292ff0b3977a01195bf0247425794"),
    everySegmentReconstructed: segments.every((segment) => {
      const actual = byId[segment.id];
      return actual && pointClose(actual.start, segment.start) && pointClose(actual.end, segment.end)
        && close(actual.length, Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y));
    }),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-025 line-network mismatch: ${JSON.stringify({ checks, output })}`);
  return { fixture: "F-025 chamfer line network independently rebuilt by FreeCAD/OCCT", inputSha256: sha256(input), output, checks };
}

const sourceBytes = await readFile(sourcePath);
const parsed = new DxfParser().parseSync(sourceBytes.toString("utf8"));
const segments = (parsed?.entities ?? []).filter((entity) => entity.type === "LINE").map((entity) => ({
  id: entity.handle,
  start: { x: entity.vertices[0].x, y: entity.vertices[0].y },
  end: { x: entity.vertices[1].x, y: entity.vertices[1].y },
}));
if (segments.length !== 6 || JSON.stringify(segments.map(({ id }) => id)) !== JSON.stringify(["10", "20", "30", "40", "41", "42"])) {
  throw new Error(`F-025 oracle source line matrix mismatch: ${JSON.stringify(segments)}`);
}
const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) { reports.push(publicTool); continue; }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f025-${tool.oracle}-`));
  try {
    const fixtureReport = tool.oracle === "librecad"
      ? await runLibreCad(tool, process.env, directory, sourceBytes)
      : await runFreeCad(tool, process.env, directory, segments);
    reports.push({
      ...publicTool,
      status: networkIsolation.proven ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
      certificationAuthority: false,
      sandbox: {
        disposableDirectory: true,
        inputPolicy: "synthetic-generated-F-025-output-only",
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
  rowId: "F-025",
  certificationAuthority: false,
  generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-025-browser.dxf",
  sourceArtifactSha256: sha256(sourceBytes),
  sourceSegments: segments,
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
