#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createEmptyDocument, createPaperLayout, serializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const source = createEmptyDocument({ documentId: "F-098-readback", now: "2026-08-28T00:00:00.000Z" });
const created = createPaperLayout(source, {
  name: "F098 PAPER",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 60, y: 60 }, radius: 30 }],
});
const document = { ...source, layouts: created.layouts };
const bytes = Buffer.from(await serializeKDraw(document, [], "2026-08-28T00:00:00.000Z"));
await writeFile(resolve(artifactRoot, "F-098-paper-space.kdraw"), bytes);

const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-098 KDRAW1 magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const parsed = JSON.parse(documentBytes.toString("utf8"));
const layout = parsed.layouts?.find((candidate) => candidate.name === "F098 PAPER");
const result = {
  schemaVersion: 1,
  rowId: "F-098",
  observedAt: new Date().toISOString(),
  source: "production cad-core createPaperLayout and serializeKDraw; independent magic/base64/length/SHA/document reader",
  container: { bytes: bytes.byteLength, sha256: sha256(bytes), documentBytes: documentBytes.byteLength, documentSha256: sha256(documentBytes) },
  layout,
  paperWorld: layout ? { minX: 0, minY: 0, maxX: layout.paper.widthMm, maxY: layout.paper.heightMm } : null,
  status: "PASS",
};
if (
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  parsed.revision !== 0 || layout?.kind !== "paper" || layout?.paper?.widthMm !== 420 || layout?.paper?.heightMm !== 297 ||
  layout?.paper?.marginsMm?.left !== 10 || layout?.entities?.length !== 1 || layout.entities[0]?.kind !== "circle" ||
  result.paperWorld?.maxX !== 420 || result.paperWorld?.maxY !== 297
) throw new Error(`F-098 independent read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-098-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-098 positive paper geometry and independent KDRAW1 read-back PASS.");
