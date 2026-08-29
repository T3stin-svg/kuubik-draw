#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "evidence/artifacts/F-109-production.dxf");
const scriptPath = resolve(root, "parity/autocad/F-109.scr");
const expectedPath = resolve(root, "parity/expected/F-109.json");
const runnerPath = resolve(root, "tools/autocad/run-f109.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-109-autocad-core-readback.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stdout = await new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const out = []; const error = [];
  child.stdout.on("data", (chunk) => out.push(chunk)); child.stderr.on("data", (chunk) => error.push(chunk));
  const timeout = setTimeout(() => { child.kill(); rejectRun(new Error("F-109 AutoCAD Core Console exceeded 45 seconds.")); }, 45_000);
  child.on("error", (reason) => { clearTimeout(timeout); rejectRun(reason); });
  child.on("close", (code) => {
    clearTimeout(timeout);
    const output = Buffer.concat(out).toString("utf16le");
    if (code !== 0) rejectRun(new Error(`F-109 AutoCAD Core Console exited ${code}:\n${Buffer.concat(out).toString("utf16le")}\n${Buffer.concat(error).toString("utf16le")}`));
    else resolveRun(output);
  });
});

// Core Console can echo AutoLISP's returned string after the plain printed
// marker. Stop before a literal `\\n` as well as a real newline so the final
// DONE marker is not read back as `1\\n`.
const marker = (name) => [...stdout.matchAll(new RegExp(`F109_${name}=([^"\\\\\\r\\n]+)`, "gu"))].at(-1)?.[1]?.trim() ?? null;
const expected = JSON.parse(await readFile(expectedPath, "utf8"));
const entities = Object.fromEntries(Object.keys(expected.entities).map((type) => [type, Number(marker(`ENTITY_${type}`))]));
const layers = Object.fromEntries(Object.keys(expected.layers).map((name) => {
  const [color, lineweight, linetype, trueColor, transparencyRaw] = (marker(`LAYER_${name}`) ?? "").split("|");
  return [name, { color: Number(color), lineweight: Number(lineweight), linetype, trueColor: Number(trueColor) < 0 ? null : Number(trueColor), transparencyRaw: Number(transparencyRaw) < 0 ? null : Number(transparencyRaw) }];
}));
const lineSemantic = (handle) => {
  const [type, layer, color, trueColor, linetype, lineweight, transparencyRaw, startX, startY, endX, endY] = (marker(`SEM_${handle}`) ?? "").split("|");
  return { type, layer, color: Number(color), trueColor: Number(trueColor) < 0 ? null : Number(trueColor), linetype, lineweight: Number(lineweight), transparencyRaw: Number(transparencyRaw) < 0 ? null : Number(transparencyRaw), start: [Number(startX), Number(startY)], end: [Number(endX), Number(endY)] };
};
const hatchTopology = (handle) => {
  const source = marker(`HATCH_${handle}`) ?? "";
  const result = { loopCount: 0, loops: [] };
  let loop = null;
  for (const token of source.split(";").filter(Boolean)) {
    const separator = token.indexOf(":");
    const code = Number(token.slice(0, separator)); const value = token.slice(separator + 1);
    if (code === 91) result.loopCount = Number(value);
    else if (code === 92) { loop = { flags: Number(value), closed: false, hasBulge: false, vertexCount: 0, vertices: [] }; result.loops.push(loop); }
    else if (!loop) continue;
    else if (code === 72) loop.hasBulge = Number(value) === 1;
    else if (code === 73) loop.closed = Number(value) === 1;
    else if (code === 93) loop.vertexCount = Number(value);
    else if (code === 10) loop.vertices.push([...value.split(",").map(Number), 0]);
    else if (code === 42 && loop.vertices.length) loop.vertices.at(-1)[2] = Number(value);
  }
  return result;
};
const result = {
  schemaVersion: 1,
  rowId: "F-109",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  sourceSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  implementationSha256: {
    autocadScript: sha256(await readFile(scriptPath)),
    autocadCore: sha256(await readFile(runnerPath)),
    expected: sha256(await readFile(expectedPath)),
  },
  units: Number(marker("UNITS")), totalEntities: Number(marker("TOTAL")), entities,
  bulgedPolylines: Number(marker("BULGED")), layers,
  semanticRecords: { "1000": lineSemantic("1000"), "1001": lineSemantic("1001"), "1209": { text: marker("TEXT_1209") } },
  hatchTopology: Object.fromEntries(["1300", "1301", "1302", "1303", "1304", "1305", "1306"].map((handle) => [handle, hatchTopology(handle)])),
  dimensionTextStyleHandle: marker("DIMSTYLE_TEXT_HANDLE"),
  styles: ["NORMAL", "STANDARD"].filter((name) => marker(`STYLE_${name}`) === "PRESENT"),
  extents: { min: (marker("EXTMIN") ?? "").split("|").map(Number), max: (marker("EXTMAX") ?? "").split("|").map(Number) },
  observedAt: new Date().toISOString(), status: marker("DONE") === "1" ? "PASS" : "FAIL",
};
const problems = [];
if (!result.engineVersion?.startsWith("24.3")) problems.push(`AutoCAD version ${result.engineVersion}`);
for (const key of ["units", "totalEntities", "bulgedPolylines"]) if (result[key] !== expected[key]) problems.push(`${key}=${result[key]}`);
for (const [type, count] of Object.entries(expected.entities)) if (result.entities[type] !== count) problems.push(`${type}=${result.entities[type]}`);
for (const [name, layer] of Object.entries(expected.layers)) {
  const actual = result.layers[name];
  if (!actual || actual.color !== layer.color || actual.lineweight !== layer.lineweight || actual.linetype?.toUpperCase() !== layer.linetype || actual.trueColor !== layer.trueColor || actual.transparencyRaw !== layer.transparencyRaw) problems.push(`layer ${name}=${JSON.stringify(actual)}`);
}
for (const style of expected.styles) if (!result.styles.includes(style)) problems.push(`missing style ${style}`);
for (const handle of ["1000", "1001"]) {
  const wanted = expected.requiredSemanticRecords[handle]; const actual = result.semanticRecords[handle];
  const wantedColor = wanted.color;
  const wantedTransparencyRaw = handle === "1000" ? 33554585 : 33554649;
  if (actual.type !== wanted.type || actual.layer !== wanted.layer || actual.color !== wantedColor || actual.trueColor !== wanted.trueColor || actual.linetype !== wanted.linetype || actual.lineweight !== wanted.lineweight || actual.transparencyRaw !== wantedTransparencyRaw || JSON.stringify(actual.start) !== JSON.stringify(wanted.start) || JSON.stringify(actual.end) !== JSON.stringify(wanted.end)) problems.push(`semantic ${handle}=${JSON.stringify(actual)}`);
}
if (result.semanticRecords["1209"].text !== expected.requiredSemanticRecords["1209"].text) problems.push(`unicode text=${JSON.stringify(result.semanticRecords["1209"].text)}`);
if (result.dimensionTextStyleHandle !== expected.dimensionStyleRecords.Standard.textStyleHandle) problems.push(`DIMTXSTY=${result.dimensionTextStyleHandle}`);
if (JSON.stringify(result.hatchTopology) !== JSON.stringify(expected.nativeHatchTopology)) problems.push(`hatch topology=${JSON.stringify(result.hatchTopology)}`);
if (JSON.stringify(result.extents) !== JSON.stringify(expected.autoCadExtents)) problems.push(`extents=${JSON.stringify(result.extents)}`);
if (result.status !== "PASS") problems.push("missing done marker");
if (problems.length) throw new Error(`F-109 AutoCAD mismatch: ${problems.join("; ")}`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-109 AutoCAD live PASS (${result.engineVersion}, ${result.totalEntities} entities).`);
