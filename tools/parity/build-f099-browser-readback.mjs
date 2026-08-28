#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const matrix = JSON.parse(await readFile(resolve(artifactRoot, "F-099-browser-multiple-viewports.json"), "utf8"));
const bytes = await readFile(resolve(artifactRoot, "F-099-browser-multiple-viewports.kdraw"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-099 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const layout = document.layouts?.find((candidate) => candidate.name === "F099 VIEWPORTS");
const [first, second] = matrix.created ?? [];
const result = {
  schemaVersion: 1,
  rowId: "F-099",
  source: "Chromium 1920x1080 live viewport DOM/canvas workflow plus independently decoded production KDRAW1",
  matrix,
  container: { bytes: bytes.byteLength, sha256: sha256(bytes), documentSha256: sha256(documentBytes) },
  document: { revision: document.revision, layout },
  status: "PASS",
};
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-099" || matrix.status !== "PASS" ||
  matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.created?.length !== 2 || first?.kind !== "rectangle" || second?.kind !== "polygon" ||
  first?.id !== "viewport-1" || second?.id !== "viewport-2" || first?.viewCenter !== "0,0" || second?.viewCenter !== "2000,0" ||
  first?.frame?.x + first?.frame?.width >= second?.frame?.x || first?.canvas?.paintedPixels <= 50 || second?.canvas?.paintedPixels <= 50 ||
  first?.clipPath !== "none" || !second?.clipPath?.includes("polygon(") ||
  matrix.afterModelContextDelete?.space !== "PAPER" || JSON.stringify(matrix.afterModelContextDelete?.viewportIds) !== JSON.stringify(["viewport-1"]) ||
  matrix.restored?.length !== 2 || matrix.restored.some((viewport) => viewport.canvas?.paintedPixels <= 50) ||
  matrix.document?.revision !== 6 || matrix.operations?.map((operation) => operation.commandId).join("|") !== "VIEWPORT_CREATE|VIEWPORT_CREATE|VIEWPORT_DELETE|UNDO|VIEWPORT_DELETE|UNDO" ||
  matrix.exported?.sha256 !== sha256(bytes) || !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  layout?.viewports?.length !== 2 || layout.viewports[0]?.id !== "viewport-1" || layout.viewports[1]?.id !== "viewport-2" ||
  layout.viewports[1]?.clipBoundary?.length !== 6 || layout.viewports[0]?.viewCenter?.x !== 0 || layout.viewports[1]?.viewCenter?.x !== 2000
) throw new Error(`F-099 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-099-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-099 Chromium multiple viewport workflow and independent KDRAW1 read-back PASS.");
