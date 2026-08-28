#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-103.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f103-plot-style.ps1");
const runnerScriptPath = resolve(root, "tools/autocad/run-f103.mjs");
const managedPluginSourcePath = resolve(root, "tools/autocad/F103PlotTransparency.cs");
const renderedPixelReaderPath = resolve(root, "tools/parity/read-f103-rendered-png.py");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-103-autocad-readback.json");
const artifactRoot = resolve(root, "evidence/artifacts");
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F103-"));
const resolvedTempRoot = resolve(tmpdir());
if (!temporaryRoot.startsWith(`${resolvedTempRoot}${sep}`)) throw new Error("F-103 temporary root escaped the system temp directory.");
const ownershipToken = randomUUID();
const temporaryPaths = {
  dwg: resolve(temporaryRoot, "f103.dwg"),
  pdfDirectory: resolve(temporaryRoot, "pdf"),
  pid: resolve(temporaryRoot, "f103.pid"),
};
const pdfNames = ["color", "monochrome", "grayscale", "no-lineweights", "transparent"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function resolveOwnedProcessId() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (sidecar.schemaVersion === 1 && sidecar.owned === true && sidecar.token === ownershipToken && Number.isInteger(sidecar.processId) && sidecar.processId > 0) return sidecar.processId;
    throw new Error("F-103 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function terminateOwnedProcess(processId) {
  if (processId <= 0) return false;
  try { process.kill(processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try { process.kill(processId, 0); } catch { return true; }
  }
  return false;
}

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0) : [];
}

async function waitForNoResidualAcadProcesses() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (acadProcessIds().length === 0) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

function decodedPdfStreams(bytes) {
  const streams = [];
  const streamMarker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  let cursor = 0;
  while (cursor < bytes.length) {
    const marker = bytes.indexOf(streamMarker, cursor);
    if (marker < 0) break;
    let start = marker + streamMarker.length;
    if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
    else if (bytes[start] === 0x0a || bytes[start] === 0x0d) start += 1;
    const end = bytes.indexOf(endMarker, start);
    if (end < 0) break;
    let body = bytes.subarray(start, end);
    while (body.length && (body.at(-1) === 0x0a || body.at(-1) === 0x0d)) body = body.subarray(0, -1);
    const dictionary = bytes.subarray(Math.max(0, marker - 1500), marker).toString("latin1");
    if (/\/FlateDecode/u.test(dictionary)) {
      try { body = inflateSync(body); } catch {}
    }
    streams.push(body.toString("latin1"));
    cursor = end + endMarker.length;
  }
  return streams;
}

function independentPdfSummary(bytes) {
  const text = bytes.toString("latin1");
  const streams = decodedPdfStreams(bytes);
  const operators = streams.join("\n");
  const widthValues = [...operators.matchAll(/(?:^|\s)([-+]?\d*\.?\d+)\s+w(?:\s|$)/gu)].map((match) => Number(match[1])).filter(Number.isFinite);
  const strokeColors = [...operators.matchAll(/(?:^|\s)([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+RG(?:\s|$)/gu)].map((match) => match.slice(1, 4).map(Number));
  const fillColors = [...operators.matchAll(/(?:^|\s)([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+rg(?:\s|$)/gu)].map((match) => match.slice(1, 4).map(Number));
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type\s*\/Page\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
    decodedStreams: streams.length,
    decodedStreamSha256: sha256(Buffer.from(operators, "latin1")),
    widthValues: [...new Set(widthValues)].toSorted((a, b) => a - b),
    strokeColors,
    fillColors,
    imageObjects: (text.match(/\/Subtype\s*\/Image\b/gu) ?? []).length,
    softMasks: (text.match(/\/SMask\b/gu) ?? []).length,
    extGStates: (text.match(/\/ExtGState\b/gu) ?? []).length,
  };
}

async function renderPdf(pdfPath, profile) {
  const prefix = resolve(temporaryRoot, `render-${profile}`);
  const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
  const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
  execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", pdfPath, prefix], { windowsHide: true, stdio: "pipe" });
  const pngPath = `${prefix}.png`;
  const bytes = await readFile(pngPath);
  const artifactPath = resolve(artifactRoot, `F-103-autocad-${profile}.png`);
  await mkdir(artifactRoot, { recursive: true });
  await copyFile(pngPath, artifactPath);
  return { bytes: bytes.byteLength, sha256: sha256(bytes), absolutePath: artifactPath, artifactPath: `evidence/artifacts/F-103-autocad-${profile}.png` };
}

function readRenderedPixels(rendered) {
  const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
  const argumentsForReader = Object.entries(rendered).map(([key, value]) => `${key}=${value.absolutePath}`);
  return JSON.parse(execFileSync(python, [renderedPixelReaderPath, ...argumentsForReader], { windowsHide: true, encoding: "utf8" }));
}

async function runMatrix() {
  let ownedProcessId = 0;
  try {
    await mkdir(temporaryPaths.pdfDirectory, { recursive: true });
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg,
        "-PdfDirectory", temporaryPaths.pdfDirectory,
        "-PidPath", temporaryPaths.pid,
        "-OwnershipToken", ownershipToken,
      ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      let timedOut = false;
      let forceTimeout;
      child.stdout.on("data", (chunk) => { stdout.push(chunk); if (process.env.DEBUG_F103 === "1") process.stdout.write(chunk); });
      child.stderr.on("data", (chunk) => { stderr.push(chunk); if (process.env.DEBUG_F103 === "1") process.stderr.write(chunk); });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        forceTimeout = setTimeout(() => {
          try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
        }, 5_000);
      }, 240_000);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout); clearTimeout(forceTimeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    ownedProcessId = await resolveOwnedProcessId();
    const automationProcessTerminated = await terminateOwnedProcess(ownedProcessId);
    if (ownedProcessId > 0 && !automationProcessTerminated) throw new Error(`Owned AutoCAD process ${ownedProcessId} remained after F-103.`);
    const noResidualAcadProcesses = await waitForNoResidualAcadProcesses();
    if (!noResidualAcadProcesses) throw new Error("An AutoCAD process remained after F-103.");
    if (childResult.timedOut) throw new Error("AutoCAD F-103 matrix exceeded the 240 second timeout.");
    if (childResult.code !== 0) throw new Error(`AutoCAD F-103 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{");
    const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownedProcessId) throw new Error("AutoCAD PID sidecar and COM read-back disagreed.");
    const pdfReadback = {};
    const pngReadback = {};
    for (const name of pdfNames) {
      const pdfPath = resolve(temporaryPaths.pdfDirectory, `${name}.pdf`);
      const bytes = await readFile(pdfPath);
      const profileKey = name === "no-lineweights" ? "noLineweights" : name;
      if (matrix.profiles?.[profileKey]?.pdf?.bytes !== bytes.byteLength || matrix.profiles?.[profileKey]?.pdf?.sha256 !== sha256(bytes)) {
        throw new Error(`AutoCAD ${name} PDF hash/length read-back mismatch.`);
      }
      pdfReadback[profileKey] = independentPdfSummary(bytes);
      pngReadback[profileKey] = await renderPdf(pdfPath, name);
    }
    const renderedPixels = readRenderedPixels(pngReadback);
    for (const value of Object.values(pngReadback)) delete value.absolutePath;
    return { ...matrix, automationProcessTerminated, noResidualAcadProcesses, pdfReadback, pngReadback, renderedPixels };
  } finally {
    try {
      if (ownedProcessId <= 0) ownedProcessId = await resolveOwnedProcessId();
      if (ownedProcessId > 0) await terminateOwnedProcess(ownedProcessId);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

const matrix = await runMatrix();
const pdfSummaries = Object.values(matrix.pdfReadback ?? {});
const colorPixels = matrix.renderedPixels?.images?.color?.counts;
const monochromePixels = matrix.renderedPixels?.images?.monochrome?.counts;
const grayscalePixels = matrix.renderedPixels?.images?.grayscale?.counts;
const noLineweightPixels = matrix.renderedPixels?.images?.noLineweights?.counts;
const transparentPixels = matrix.renderedPixels?.images?.transparent?.counts;
const trueColor = [10 / 255, 100 / 255, 220 / 255];
const hasColor = (colors, expected, tolerance = 1e-5) => colors?.some((color) =>
  color.length === 3 && color.every((value, index) => Math.abs(value - expected[index]) <= tolerance));
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-103" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.noResidualAcadProcesses ||
  Object.values(matrix.checks ?? {}).some((value) => value !== true) ||
  matrix.objectsBefore?.byLayerLine?.colorIndex !== 256 || matrix.objectsBefore?.byLayerLine?.lineweight !== -1 ||
  matrix.objectsBefore?.explicitLine?.colorIndex !== 3 || matrix.objectsBefore?.explicitLine?.lineweight !== 35 ||
  matrix.objectsBefore?.trueColorLine?.lineweight !== 0 || matrix.objectsBefore?.trueColorLine?.trueColor?.red !== 10 || matrix.objectsBefore?.trueColorLine?.trueColor?.green !== 100 || matrix.objectsBefore?.trueColorLine?.trueColor?.blue !== 220 ||
  !String(matrix.objectsBefore?.hatch?.transparency).includes("40") ||
  matrix.profiles?.color?.layout?.plotWithPlotStyles !== false || matrix.profiles?.color?.layout?.plotWithLineweights !== true ||
  matrix.profiles?.monochrome?.layout?.styleSheet?.toLowerCase() !== "monochrome.ctb" ||
  matrix.profiles?.grayscale?.layout?.styleSheet?.toLowerCase() !== "grayscale.ctb" ||
  matrix.profiles?.noLineweights?.layout?.plotWithLineweights !== false || matrix.profiles?.noLineweights?.layout?.plotTransparency !== false ||
  matrix.profiles?.transparent?.layout?.plotTransparencyOverride !== 1 || matrix.profiles?.transparent?.layout?.plotTransparency !== true ||
  pdfSummaries.length !== 5 || pdfSummaries.some((summary) => summary.version === null || summary.pages < 1 || !summary.eof) ||
  !matrix.pdfReadback.color.strokeColors.some(([r, g, b]) => r === 1 && g === 0 && b === 0) ||
  !matrix.pdfReadback.color.strokeColors.some(([r, g, b]) => r === 0 && g === 1 && b === 0) ||
  !hasColor(matrix.pdfReadback.color.strokeColors, trueColor) || !hasColor(matrix.pdfReadback.monochrome.strokeColors, trueColor) || !hasColor(matrix.pdfReadback.grayscale.strokeColors, trueColor) ||
  !matrix.pdfReadback.monochrome.strokeColors.some(([r, g, b]) => r === 0 && g === 0 && b === 0) ||
  matrix.pdfReadback.monochrome.strokeColors.some(([r, g, b]) => (r === 1 && g === 0 && b === 0) || (r === 0 && g === 1 && b === 0)) ||
  !matrix.pdfReadback.grayscale.strokeColors.some(([r, g, b]) => Math.abs(r - 0.29804) < 1e-5 && r === g && g === b) ||
  !matrix.pdfReadback.grayscale.strokeColors.some(([r, g, b]) => Math.abs(r - 0.58431) < 1e-5 && r === g && g === b) ||
  matrix.pdfReadback.noLineweights.widthValues.some((value) => value !== 0) ||
  matrix.pdfReadback.transparent.imageObjects < 1 || matrix.pdfReadback.transparent.softMasks < 1 ||
  colorPixels?.red <= 0 || colorPixels?.green <= 0 || colorPixels?.trueColorBlueRange <= 0 || colorPixels?.transparentRedOnWhite !== 0 ||
  monochromePixels?.black <= 0 || monochromePixels?.trueColorBlueRange <= 0 || grayscalePixels?.grayscaleRed <= 0 || grayscalePixels?.grayscaleGreen <= 0 || grayscalePixels?.trueColorBlueRange <= 0 ||
  noLineweightPixels?.red <= 0 || noLineweightPixels?.green <= 0 || transparentPixels?.transparentRedOnWhiteRange <= 0 ||
  new Set(Object.values(matrix.profiles).map((profile) => profile.pdf.sha256)).size !== 5 ||
  matrix.dwg?.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(matrix.dwg?.sha256 ?? "") ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || !matrix.userSettings?.restored || matrix.status !== "PASS"
) throw new Error(`F-103 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  documentation: [
    "https://help.autodesk.com/cloudhelp/2020/ENG/AutoCAD-Core/files/GUID-38F03A2C-6D36-4AD9-BBE0-9CA574BEF218.htm",
    "https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT-MAC/files/GUID-D2820944-F8F0-4810-9E85-C41604FF58D9.htm",
  ],
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  managedPluginSourceSha256: sha256(await readFile(managedPluginSourcePath)),
  runnerScriptSha256: sha256(await readFile(runnerScriptPath)),
  renderedPixelReaderSha256: sha256(await readFile(renderedPixelReaderPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-103 AutoCAD live PASS (${result.engineVersion}, five native PlotToFile profiles and DWG reopen).`);
