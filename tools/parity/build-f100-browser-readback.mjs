#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const matrix = JSON.parse(await readFile(resolve(artifactRoot, "F-100-browser-viewport-view.json"), "utf8"));
const bytes = await readFile(resolve(artifactRoot, "F-100-browser-viewport-view.kdraw"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-100 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const layout = document.layouts?.find((candidate) => candidate.name === "F100 VIEW");
const viewport = layout?.viewports?.[0];
const result = {
  schemaVersion: 1,
  rowId: "F-100",
  source: "Chromium 1920x1080 live viewport controls/pointer/canvas workflow plus independently decoded production KDRAW1",
  matrix,
  container: { bytes: bytes.byteLength, sha256: sha256(bytes), documentSha256: sha256(documentBytes) },
  document: { revision: document.revision, viewport },
  status: "PASS",
};
const close = (a, b, tolerance = 1e-8) => Math.abs(a - b) <= tolerance;
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-100" || matrix.status !== "PASS" ||
  matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.preset?.center?.x !== 1000 || matrix.preset?.center?.y !== -500 || matrix.preset?.scaleLabel !== "1:20" ||
  !close(matrix.preset?.scaleDenominator, 20, 1e-12) || !close(matrix.preset?.twistAngleRad, Math.PI / 6, 1e-12) ||
  matrix.presetPixels?.paintedPixels <= 100 || matrix.presetPixels?.slope >= -0.45 || matrix.presetPixels?.slope <= -0.7 ||
  !close(matrix.cursorZoom?.delta?.x, 0) || !close(matrix.cursorZoom?.delta?.y, 0) ||
  Math.abs(matrix.cursorZoom?.markerPixelDelta?.x) > 0.5 || Math.abs(matrix.cursorZoom?.markerPixelDelta?.y) > 0.5 ||
  matrix.cursorZoom?.markerBefore?.count < 8 || matrix.cursorZoom?.markerAfter?.count < 8 ||
  matrix.cursorZoom?.zoomed?.scaleLabel !== "1:18.182 (Custom)" ||
  matrix.panned?.center?.x === matrix.cursorZoom?.zoomed?.center?.x || matrix.panned?.center?.y === matrix.cursorZoom?.zoomed?.center?.y ||
  !close(matrix.panned?.center?.x, matrix.pan?.expectedCenter?.x) || !close(matrix.panned?.center?.y, matrix.pan?.expectedCenter?.y) ||
  matrix.pan?.canvas?.width <= 0 || matrix.pan?.canvas?.height <= 0 ||
  !close(matrix.panned?.scaleDenominator, matrix.cursorZoom?.zoomed?.scaleDenominator, 1e-12) ||
  !close(matrix.panned?.twistAngleRad, Math.PI / 6, 1e-12) ||
  !close(matrix.restored?.center?.x, matrix.panned?.center?.x) || !close(matrix.restored?.center?.y, matrix.panned?.center?.y) ||
  matrix.document?.revision !== 5 || matrix.operations?.map((operation) => operation.commandId).join("|") !== "VIEWPORT_VIEW|VIEWPORT_ZOOM|VIEWPORT_PAN|UNDO|VIEWPORT_PAN" ||
  matrix.exported?.sha256 !== sha256(bytes) || !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  document.revision !== 5 || viewport?.id !== "viewport-f100" ||
  !close(viewport?.viewCenter?.x, matrix.panned?.center?.x) || !close(viewport?.viewCenter?.y, matrix.panned?.center?.y) ||
  !close(viewport?.viewHeight / viewport?.height, matrix.panned?.scaleDenominator, 1e-12) || !close(viewport?.twistAngleRad, Math.PI / 6, 1e-12)
) throw new Error(`F-100 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-100-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-100 Chromium viewport view controls and independent KDRAW1 read-back PASS.");
