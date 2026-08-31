import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { importDxf } from "../../packages/cad-dxf/src/index.js";

const [sourcePath, savedPath, outputPath] = process.argv.slice(2);
if (!sourcePath || !savedPath || !outputPath) {
  throw new Error("Usage: vite-node tools/autocad/f110-desktop-readback.ts <source.dxf> <saved.dxf> <output.json>");
}

const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

function normalize<T>(value: T): T {
  if (typeof value === "number") return (Math.round(value * 1e12) / 1e12) as T;
  if (Array.isArray(value)) return value.map((item) => normalize(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) as T;
  }
  return value;
}

function semantic(document: ReturnType<typeof importDxf>["document"]) {
  const layerNames = new Map(document.layers.map((layer) => [layer.id, layer.name]));
  return normalize({
    units: document.units.linear,
    entities: document.entities.map((entity) => ({
      kind: entity.kind,
      handle: entity.handle,
      layer: layerNames.get(entity.layerId),
    })),
    layers: document.layers.map((layer) => layer.name),
    linetypes: document.linetypes.map((linetype) => linetype.name),
    textStyles: document.textStyles.map((style) => style.name),
    dimensionStyles: document.dimensionStyles.map((style) => style.name),
    blocks: document.blocks.map((block) => ({
      name: block.name,
      handles: block.entities.map((entity) => entity.handle),
    })),
    text: document.entities.find((entity) => entity.handle === "70"),
    mtext: document.entities.find((entity) => entity.handle === "80"),
    dimension: document.entities.find((entity) => entity.handle === "A0"),
    insert: document.entities.find((entity) => entity.handle === "B0"),
  });
}

const sourceBytes = await readFile(sourcePath);
const savedBytes = await readFile(savedPath);
const source = importDxf(sourceBytes, { documentId: "F-110-desktop-source" });
const saved = importDxf(savedBytes, { documentId: "F-110-desktop-saved" });
const sourceSemantic = semantic(source.document);
const savedSemantic = semantic(saved.document);
const expectedHandles = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "A0", "B0"];

if (source.report.skipped.length || saved.report.skipped.length) throw new Error("F-110 Kuubik parser skipped an entity.");
if (saved.document.units.linear !== "mm") throw new Error("F-110 Desktop output lost millimetre units.");
if (saved.document.entities.map((entity) => entity.handle).join(",") !== expectedHandles.join(",")) {
  throw new Error("F-110 Desktop output changed model-space handles.");
}
if (saved.document.blocks.map((block) => block.name).join(",") !== "SYMBOL") {
  throw new Error("F-110 Desktop output changed named blocks.");
}
if (savedSemantic.text?.kind !== "text" || savedSemantic.text.text !== "TÕEND ŠŽ€") {
  throw new Error("F-110 Desktop output changed UTF-8 TEXT content.");
}
if (JSON.stringify(savedSemantic) !== JSON.stringify(sourceSemantic)) {
  throw new Error("F-110 Desktop output changed Kuubik semantic content.");
}

const result = {
  schemaVersion: 1,
  rowId: "F-110",
  authority: "kuubik-dxf-parser",
  status: "PASS",
  source: { path: sourcePath, bytes: sourceBytes.byteLength, sha256: hash(sourceBytes), report: source.report, semantic: sourceSemantic },
  desktopSaved: { path: savedPath, bytes: savedBytes.byteLength, sha256: hash(savedBytes), report: saved.report, semantic: savedSemantic },
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-110 Kuubik Desktop DXF read-back PASS.");
