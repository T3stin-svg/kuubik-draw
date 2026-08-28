#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const matrix = JSON.parse(await readFile(resolve(artifactRoot, "F-101-browser-viewport-lock.json"), "utf8"));
const bytes = await readFile(resolve(artifactRoot, "F-101-browser-viewport-lock.kdraw"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-101 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const layout = document.layouts?.find((candidate) => candidate.name === "F101 LOCK");
const viewport = layout?.viewports?.[0];
const result = {
  schemaVersion: 1,
  rowId: "F-101",
  source: "Chromium 1920x1080 live display-lock/navigation/model-edit workflow plus independently decoded production KDRAW1",
  matrix,
  container: { bytes: bytes.byteLength, sha256: sha256(bytes), documentSha256: sha256(documentBytes) },
  document: { revision: document.revision, entityCount: document.entities?.length, viewport },
  status: "PASS",
};
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-101" || matrix.status !== "PASS" ||
  matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.initial?.locked !== false || matrix.initial?.navigationEnabled !== true ||
  matrix.locked?.locked !== true || matrix.locked?.navigationEnabled !== false ||
  JSON.stringify(matrix.afterLockedWheel) !== JSON.stringify(matrix.locked) ||
  JSON.stringify(matrix.afterLockedPan) !== JSON.stringify(matrix.locked) ||
  JSON.stringify(matrix.afterLockedDirect) !== JSON.stringify(matrix.locked) ||
  matrix.afterLockedEdit?.revision !== 2 || matrix.afterLockedEdit?.entityCount !== 2 ||
  matrix.zoomed?.locked !== false || matrix.zoomed?.navigationEnabled !== true ||
  matrix.panned?.center === matrix.zoomed?.center || matrix.relocked?.locked !== true || matrix.relocked?.navigationEnabled !== false ||
  matrix.restored?.locked !== true || matrix.restored?.navigationEnabled !== false || matrix.restored?.spaceContext !== "model" ||
  matrix.document?.revision !== 8 || matrix.document?.entityCount !== 2 || matrix.document?.viewport?.locked !== true ||
  matrix.operations?.map((operation) => operation.commandId).join("|") !== "VIEWPORT_LOCK|LINE|VIEWPORT_LOCK|VIEWPORT_ZOOM|VIEWPORT_PAN|VIEWPORT_LOCK|UNDO|VIEWPORT_LOCK" ||
  matrix.exported?.sha256 !== sha256(bytes) || !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  document.revision !== 8 || document.entities?.length !== 2 || viewport?.id !== "viewport-f101" || viewport?.locked !== true ||
  JSON.stringify(viewport) !== JSON.stringify(matrix.document.viewport)
) throw new Error(`F-101 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-101-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-101 Chromium display lock and independent KDRAW1 read-back PASS.");
