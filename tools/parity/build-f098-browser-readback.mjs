#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const matrix = JSON.parse(await readFile(resolve(artifactRoot, "F-098-browser-paper-space.json"), "utf8"));
const bytes = await readFile(resolve(artifactRoot, "F-098-browser-paper-space.kdraw"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-098 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const paperLayout = document.layouts?.find((layout) => layout.name === "F098 PAPER");
const ratio = (metrics) => metrics.sheet.width / metrics.sheet.height;
const result = {
  schemaVersion: 1,
  rowId: "F-098",
  observedAt: new Date().toISOString(),
  source: "Chromium 1920x1080 live DOM/canvas measurement plus independently decoded production KDRAW1",
  matrix,
  container: { bytes: bytes.byteLength, sha256: sha256(bytes), documentSha256: sha256(documentBytes) },
  document: { revision: document.revision, layout: paperLayout },
  status: "PASS",
};
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-098" || matrix.status !== "PASS" ||
  matrix.beforeReload?.viewport?.width !== 1920 || matrix.beforeReload?.viewport?.height !== 1080 ||
  matrix.beforeReload?.area?.width <= 1500 || matrix.beforeReload?.area?.height <= 700 ||
  matrix.beforeReload?.sheet?.width <= 700 || matrix.beforeReload?.sheet?.height <= 500 ||
  Math.abs(ratio(matrix.beforeReload) - (420 / 297)) > 0.01 ||
  matrix.beforeReload?.canvasBitmap?.paintedPixels <= 100 || matrix.afterReload?.canvasBitmap?.paintedPixels <= 100 ||
  matrix.beforeReload?.colors?.desk !== "rgb(52, 58, 64)" || matrix.beforeReload?.colors?.sheet !== "rgb(255, 255, 255)" ||
  JSON.stringify(matrix.beforeReload?.paper) !== JSON.stringify({ widthMm: 420, heightMm: 297 }) ||
  JSON.stringify(matrix.afterReload?.paper) !== JSON.stringify(matrix.beforeReload?.paper) ||
  matrix.consoleErrors?.length !== 0 || matrix.exported?.sha256 !== sha256(bytes) ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  paperLayout?.paper?.widthMm !== 420 || paperLayout?.paper?.heightMm !== 297 || paperLayout?.entities?.[0]?.kind !== "circle"
) throw new Error(`F-098 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-098-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-098 Chromium paper sheet and independent KDRAW1 read-back PASS.");
