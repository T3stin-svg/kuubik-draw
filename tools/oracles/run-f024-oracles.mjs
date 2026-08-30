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
const sourcePath = resolve(root, "evidence/artifacts/F-024-browser.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-024-oracles.json");
const freeCadScriptPath = resolve(root, "tools/oracles/freecad-f024-headless.py");
const runnerPath = resolve(root, "tools/oracles/run-f024-oracles.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const pointClose = (left, right, tolerance = 1e-8) => close(left?.x, right?.x, tolerance) && close(left?.y, right?.y, tolerance);
const normalizedSweep = (start, end) => {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  return sweep;
};
const atAngle = (center, radius, angle) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
const sourcePaths = [
  "tools/oracles/freecad-f024-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f024-oracles.mjs",
];

function arcFromBulge(entity, index) {
  const start = entity.vertices[index];
  const end = entity.vertices[(index + 1) % entity.vertices.length];
  const bulge = start.bulge;
  const dx = end.x - start.x; const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (start.x + end.x) / 2 - (dy / chord) * centerOffset, y: (start.y + end.y) / 2 + (dx / chord) * centerOffset };
  const sweep = 4 * Math.atan(bulge);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const midAngle = startAngle + sweep / 2;
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  return { id: `${entity.handle}#${index}`, center, radius, sweep: Math.abs(sweep), start: { x: start.x, y: start.y }, mid: atAngle(center, radius, midAngle), end: { x: end.x, y: end.y } };
}

function sourceArcs(dxf) {
  const values = [];
  for (const entity of dxf?.entities ?? []) {
    if (entity.type === "LWPOLYLINE") {
      for (let index = 0; index < entity.vertices.length; index += 1) {
        if (Math.abs(entity.vertices[index]?.bulge ?? 0) > 1e-12) values.push(arcFromBulge(entity, index));
      }
    } else if (entity.type === "ARC") {
      const sweep = normalizedSweep(entity.startAngle, entity.endAngle);
      values.push({
        id: entity.handle,
        center: { x: entity.center.x, y: entity.center.y },
        radius: entity.radius,
        sweep,
        start: atAngle(entity.center, entity.radius, entity.startAngle),
        mid: atAngle(entity.center, entity.radius, entity.startAngle + sweep / 2),
        end: atAngle(entity.center, entity.radius, entity.startAngle + sweep),
      });
    }
  }
  return values;
}

function parseJsonLine(stdout) {
  const line = stdout.split(/\r?\n/u).find((item) => item.trimStart().startsWith("{"));
  if (!line) throw new Error(`FreeCAD F-024 oracle did not emit JSON: ${stdout.slice(0, 2000)}`);
  return JSON.parse(line);
}

async function runLibreCad(tool, environment, directory, sourceBytes) {
  const input = join(directory, "F-024-browser.dxf");
  const output = join(directory, "F-024-librecad.pdf");
  await writeFile(input, sourceBytes);
  const process = run(tool.executable, ["dxf2pdf", "--fit", "--paper", "210x297", "-o", output, input], {
    cwd: directory, env: await isolatedEnvironment(environment, directory),
  });
  const pdf = readPdf(await readFile(output));
  const checks = {
    exitCodeZero: process.status === 0,
    exactBrowserDxfInput: sha256(await readFile(input)) === sha256(sourceBytes),
    validSinglePageVectorPdf: pdf.hasPdfHeader && pdf.hasEof && pdf.pages === 1 && pdf.imageXObjects === 0,
    vectorPolylineAndArcsPresent: pdf.vectorOperators.paintedPathOperators > 0 && pdf.vectorOperators.lineToOperators > 0 && pdf.vectorOperators.cubicCurveOperators > 0,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD F-024 read-back mismatch: ${JSON.stringify({ checks, pdf })}`);
  return { fixture: "F-024 browser FILLET DXF rendered by LibreCAD 2.2.1.5", inputSha256: sha256(sourceBytes), output: pdf, checks };
}

async function runFreeCad(tool, environment, directory, arcs) {
  const payload = { operation: "circular-arc-readback", arcs: arcs.map(({ id, start, mid, end }) => ({ id, start, mid, end })) };
  const input = `${JSON.stringify(payload)}\n`;
  const script = join(directory, "freecad-f024-headless.py");
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
    everyArcReconstructed: arcs.every((arc) => {
      const actual = byId[arc.id];
      return actual && pointClose(actual.center, arc.center) && close(actual.radius, arc.radius)
        && close(actual.length, arc.radius * arc.sweep) && pointClose(actual.start, arc.start) && pointClose(actual.end, arc.end)
        && close(Math.hypot(actual.startTangent.x, actual.startTangent.y), 1)
        && close(Math.hypot(actual.endTangent.x, actual.endTangent.y), 1);
    }),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD F-024 circular arc mismatch: ${JSON.stringify({ checks, output, arcs })}`);
  return { fixture: "F-024 bulge and standalone fillet arcs independently rebuilt by FreeCAD/OCCT", inputSha256: sha256(input), output, checks };
}

const sourceBytes = await readFile(sourcePath);
const dxf = new DxfParser().parseSync(sourceBytes.toString("utf8"));
const arcs = sourceArcs(dxf);
if (arcs.length !== 4
  || arcs.filter((arc) => close(arc.radius, 10) && close(arc.sweep, Math.PI / 2)).length !== 3
  || arcs.filter((arc) => close(arc.radius, 60) && close(arc.sweep, Math.PI / 2)).length !== 1) {
  throw new Error(`F-024 oracle source arc matrix mismatch: ${JSON.stringify(arcs)}`);
}
const probes = await probeOracles();
const networkIsolation = await verifyNetworkIsolationAttestation(probes);
const reports = [];
for (const tool of probes) {
  const { executable: _privateExecutable, ...publicTool } = tool;
  if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) { reports.push(publicTool); continue; }
  const directory = await mkdtemp(join(tmpdir(), `kuubik-f024-${tool.oracle}-`));
  try {
    const fixtureReport = tool.oracle === "librecad"
      ? await runLibreCad(tool, process.env, directory, sourceBytes)
      : await runFreeCad(tool, process.env, directory, arcs);
    reports.push({
      ...publicTool,
      status: networkIsolation.proven ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
      certificationAuthority: false,
      sandbox: {
        disposableDirectory: true,
        inputPolicy: "synthetic-generated-F-024-output-only",
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
  rowId: "F-024",
  certificationAuthority: false,
  generatedAt: new Date().toISOString(),
  sourceArtifact: "evidence/artifacts/F-024-browser.dxf",
  sourceArtifactSha256: sha256(sourceBytes),
  sourceArcs: arcs,
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
