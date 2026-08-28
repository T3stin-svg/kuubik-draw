#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-102.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f102-page-setup.ps1");
const runnerScriptPath = resolve(root, "tools/autocad/run-f102.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-102-autocad-readback.json");
const browserEvidencePath = resolve(root, "evidence/artifacts/F-102-browser-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const close = (actual, expected, tolerance) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
const temporaryStem = resolve(tmpdir(), `KuubikDraw-F102-${randomUUID()}`); const ownershipToken = randomUUID();
const temporaryPaths = { dwg: `${temporaryStem}.dwg`, bak: `${temporaryStem}.bak`, pdf: `${temporaryStem}.pdf`, displayPdf: `${temporaryStem}.display.pdf`, pid: `${temporaryStem}.pid` };
const browserEvidenceBytes = await readFile(browserEvidencePath);
const browserEvidence = JSON.parse(browserEvidenceBytes.toString("utf8"));
const requestedDisplayWindow = browserEvidence.matrix?.display?.source;
if (!requestedDisplayWindow || [requestedDisplayWindow.x, requestedDisplayWindow.y, requestedDisplayWindow.width, requestedDisplayWindow.height].some((value) => !Number.isFinite(value)) || requestedDisplayWindow.width <= 0 || requestedDisplayWindow.height <= 0) {
  throw new Error("F-102 AutoCAD run requires the current Chromium paper-space Display window evidence.");
}

async function resolveOwnedProcessId() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (sidecar.schemaVersion === 1 && sidecar.owned === true && sidecar.token === ownershipToken && Number.isInteger(sidecar.processId) && sidecar.processId > 0) return sidecar.processId;
    throw new Error("F-102 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
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

async function removeTemporaryFiles() { await Promise.all(Object.values(temporaryPaths).map((path) => rm(path, { force: true }))); }

function decodedPdfStreams(bytes) {
  const streams = []; const streamMarker = Buffer.from("stream"); const endMarker = Buffer.from("endstream"); let cursor = 0;
  while (cursor < bytes.length) {
    const marker = bytes.indexOf(streamMarker, cursor); if (marker < 0) break;
    let start = marker + streamMarker.length;
    if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
    else if (bytes[start] === 0x0a || bytes[start] === 0x0d) start += 1;
    const end = bytes.indexOf(endMarker, start); if (end < 0) break;
    let body = bytes.subarray(start, end); while (body.length && (body.at(-1) === 0x0a || body.at(-1) === 0x0d)) body = body.subarray(0, -1);
    const dictionary = bytes.subarray(Math.max(0, marker - 1000), marker).toString("latin1");
    if (/\/FlateDecode/u.test(dictionary)) { try { body = inflateSync(body); } catch {} }
    streams.push(body.toString("latin1")); cursor = end + endMarker.length;
  }
  return streams;
}

function pdfVectorSegments(streams) {
  const number = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)"; const segments = [];
  for (const stream of streams) {
    const matrixMatch = stream.match(new RegExp(`(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+(${number})\\s+cm`, "u"));
    const matrix = matrixMatch ? matrixMatch.slice(1).map(Number) : [1, 0, 0, 1, 0, 0];
    const pattern = new RegExp(`(${number})\\s+w\\s+(${number})\\s+(${number})\\s+m\\s+(${number})\\s+(${number})\\s+l\\s+S`, "gu");
    for (const match of stream.matchAll(pattern)) {
      const [lineWidth, x1, y1, x2, y2] = match.slice(1).map(Number); const [a, b, c, d, e, f] = matrix;
      const startPt = { x: a * x1 + c * y1 + e, y: b * x1 + d * y1 + f };
      const endPt = { x: a * x2 + c * y2 + e, y: b * x2 + d * y2 + f };
      segments.push({ lineWidth, startPt, endPt, deltaMm: { x: Math.abs(endPt.x - startPt.x) * 25.4 / 72, y: Math.abs(endPt.y - startPt.y) * 25.4 / 72 } });
    }
  }
  return segments;
}

function independentPdfSummary(bytes) {
  const text = bytes.toString("latin1"); const media = text.match(/\/MediaBox\s*\[\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*\]/u);
  const streams = decodedPdfStreams(bytes);
  if (process.env.DEBUG_F102_PDF === "1") process.stderr.write(`${streams.join("\n---STREAM---\n")}\n`);
  const lineSegments = pdfVectorSegments(streams); const dominantLine = lineSegments.toSorted((a, b) => b.lineWidth - a.lineWidth)[0] ?? null;
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type\s*\/Page\b/gu) ?? []).length,
    mediaBoxPt: media ? { x0: Number(media[1]), y0: Number(media[2]), x1: Number(media[3]), y1: Number(media[4]) } : null,
    eof: /%%EOF\s*$/u.test(text),
    decodedStreamSha256: sha256(Buffer.from(streams.join("\n"), "latin1")),
    lineSegments: lineSegments.length,
    dominantLine,
  };
}

async function runMatrix() {
  await removeTemporaryFiles(); let ownedProcessId = 0;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg, "-TempPdfPath", temporaryPaths.pdf,
        "-PidPath", temporaryPaths.pid, "-OwnershipToken", ownershipToken,
        "-DisplayX", String(requestedDisplayWindow.x), "-DisplayY", String(requestedDisplayWindow.y),
        "-DisplayWidth", String(requestedDisplayWindow.width), "-DisplayHeight", String(requestedDisplayWindow.height),
      ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = []; const stderr = []; let timedOut = false; let forceTimeout;
      child.stdout.on("data", (chunk) => { stdout.push(chunk); if (process.env.DEBUG_F102 === "1") process.stdout.write(chunk); });
      child.stderr.on("data", (chunk) => { stderr.push(chunk); if (process.env.DEBUG_F102 === "1") process.stderr.write(chunk); });
      const timeout = setTimeout(() => {
        timedOut = true; child.kill();
        forceTimeout = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5_000);
      }, 240_000);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); clearTimeout(forceTimeout); resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() }); });
    });
    ownedProcessId = await resolveOwnedProcessId(); const automationProcessTerminated = await terminateOwnedProcess(ownedProcessId);
    if (ownedProcessId > 0 && !automationProcessTerminated) throw new Error(`Owned AutoCAD process ${ownedProcessId} remained after F-102.`);
    const noResidualAcadProcesses = await waitForNoResidualAcadProcesses();
    if (!noResidualAcadProcesses) throw new Error("An AutoCAD process remained after F-102.");
    if (childResult.timedOut) throw new Error("AutoCAD F-102 matrix exceeded the 240 second timeout.");
    if (childResult.code !== 0) throw new Error(`AutoCAD F-102 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownedProcessId) throw new Error("AutoCAD PID sidecar and COM read-back disagreed.");
    const pdfBytes = await readFile(temporaryPaths.pdf); const pdfReadback = independentPdfSummary(pdfBytes);
    const displayPdfBytes = await readFile(temporaryPaths.displayPdf); const displayPdfReadback = independentPdfSummary(displayPdfBytes);
    if (matrix.pdf?.bytes !== pdfBytes.byteLength || matrix.pdf?.sha256 !== sha256(pdfBytes)) throw new Error("AutoCAD PDF hash/length read-back mismatch.");
    if (matrix.displayPdf?.bytes !== displayPdfBytes.byteLength || matrix.displayPdf?.sha256 !== sha256(displayPdfBytes)) throw new Error("AutoCAD Display PDF hash/length read-back mismatch.");
    return { ...matrix, automationProcessTerminated, noResidualAcadProcesses, pdfReadback, displayPdfReadback };
  } finally {
    try { if (ownedProcessId <= 0) ownedProcessId = await resolveOwnedProcessId(); if (ownedProcessId > 0) await terminateOwnedProcess(ownedProcessId); }
    finally { await removeTemporaryFiles(); }
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-102" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.noResidualAcadProcesses ||
  Object.values(matrix.checks ?? {}).some((value) => value !== true) ||
  matrix.baseline?.plotType !== 5 || Math.abs(matrix.baseline?.paper?.widthMm - 420) > 0.001 || Math.abs(matrix.baseline?.paper?.heightMm - 297) > 0.001 ||
  matrix.configured?.plotType !== 4 || Math.abs(matrix.configured?.paper?.widthMm - 210) > 0.001 || Math.abs(matrix.configured?.paper?.heightMm - 297) > 0.001 ||
  Math.abs(matrix.configured?.customScale?.denominator - 2) > 1e-9 || matrix.configured?.centerPlot !== false ||
  matrix.afterReopen?.plotType !== 4 || matrix.fit?.plotType !== 1 || matrix.fit?.standardScale !== 0 || matrix.fit?.centerPlot !== true ||
  matrix.outsideWindow?.plotType !== 4 || matrix.outsideWindow?.window?.lowerLeft?.x !== -25 || matrix.outsideWindow?.window?.lowerLeft?.y !== -40 ||
  matrix.display?.plotType !== 0 || matrix.display?.standardScale !== 0 || matrix.display?.centerPlot !== true ||
  !close(matrix.displayWindow?.window?.x, requestedDisplayWindow.x, 0.01) || !close(matrix.displayWindow?.window?.y, requestedDisplayWindow.y, 0.01) ||
  !close(matrix.displayWindow?.window?.width, requestedDisplayWindow.width, 0.01) || !close(matrix.displayWindow?.window?.height, requestedDisplayWindow.height, 0.01) ||
  matrix.restored?.plotType !== 5 || Math.abs(matrix.restored?.customScale?.denominator - 1) > 1e-9 ||
  matrix.pdfReadback?.version === null || matrix.pdfReadback?.pages < 1 || !matrix.pdfReadback?.eof ||
  !close(matrix.pdfReadback?.dominantLine?.deltaMm?.x, 90, 0.2) || !close(matrix.pdfReadback?.dominantLine?.deltaMm?.y, 125, 0.2) ||
  matrix.displayPdfReadback?.version === null || matrix.displayPdfReadback?.pages < 1 || !matrix.displayPdfReadback?.eof ||
  !close(matrix.displayPdfReadback?.dominantLine?.deltaMm?.x, 180 / matrix.display?.customScale?.denominator, 0.2) ||
  !close(matrix.displayPdfReadback?.dominantLine?.deltaMm?.y, 250 / matrix.display?.customScale?.denominator, 0.2) ||
  matrix.dwg?.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(matrix.dwg?.sha256 ?? "") || matrix.pdf?.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(matrix.pdf?.sha256 ?? "") ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-102 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
const result = { ...matrix, browserEvidenceSha256: sha256(browserEvidenceBytes), scriptSha256: sha256(await readFile(scriptPath)), matrixScriptSha256: sha256(await readFile(matrixScriptPath)), runnerScriptSha256: sha256(await readFile(runnerScriptPath)), observedAt: new Date().toISOString() };
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-102 AutoCAD live PASS (${result.engineVersion}, native PAGESETUP/PlotToFile/DWG reopen).`);
