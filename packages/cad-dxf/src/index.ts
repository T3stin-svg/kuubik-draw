import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface DxfExportReport {
  emittedHandles: string[];
  handleMap: Record<string, string>;
  skipped: Array<{ handle: string; kind: CadEntity["kind"]; reason: string }>;
}

export interface DxfReadbackSummary {
  acadVersion: string | null;
  entityTypes: Record<string, number>;
  handles: string[];
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

function pair(code: number, value: string | number): string {
  return `${String(code).padStart(3, " ")}\r\n${value}\r\n`;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("DXF coordinates must be finite.");
  return Number(value.toPrecision(15)).toString();
}

function entityHeader(type: string, handle: string, layer: string): string {
  return pair(0, type) + pair(5, handle.toUpperCase()) + pair(100, "AcDbEntity") + pair(8, layer);
}

function emitEntity(entity: CadEntity, dxfHandle: string): string | null {
  switch (entity.kind) {
    case "line":
      return (
        entityHeader("LINE", dxfHandle, entity.layerId) +
        pair(100, "AcDbLine") +
        pair(10, number(entity.start.x)) + pair(20, number(entity.start.y)) + pair(30, 0) +
        pair(11, number(entity.end.x)) + pair(21, number(entity.end.y)) + pair(31, 0)
      );
    case "circle":
      return (
        entityHeader("CIRCLE", dxfHandle, entity.layerId) +
        pair(100, "AcDbCircle") +
        pair(10, number(entity.center.x)) + pair(20, number(entity.center.y)) + pair(30, 0) +
        pair(40, number(entity.radius))
      );
    case "polyline":
      return (
        entityHeader("LWPOLYLINE", dxfHandle, entity.layerId) +
        pair(100, "AcDbPolyline") + pair(90, entity.vertices.length) + pair(70, entity.closed ? 1 : 0) +
        entity.vertices
          .map((vertex) => pair(10, number(vertex.x)) + pair(20, number(vertex.y)) + (vertex.bulge === undefined ? "" : pair(42, number(vertex.bulge))))
          .join("")
      );
    default: return null;
  }
}

function mappedHandles(entities: readonly CadEntity[]): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const entity of entities) {
    const candidate = entity.handle.toUpperCase();
    let numeric = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(entity.handle)) {
      numeric ^= byte;
      numeric = Math.imul(numeric, 0x01000193) >>> 0;
    }
    let mapped = /^[1-9A-F][0-9A-F]*$/.test(candidate) ? candidate : numeric.toString(16).toUpperCase();
    if (mapped === "0") mapped = "1";
    while (used.has(mapped)) mapped = (Number.parseInt(mapped, 16) + 1).toString(16).toUpperCase();
    used.add(mapped);
    result[entity.handle] = mapped;
  }
  return result;
}

const INSUNITS: Record<KDrawDocumentV1["units"]["linear"], number> = {
  unitless: 0,
  in: 1,
  ft: 2,
  mm: 4,
  cm: 5,
  m: 6,
};

export function exportDxf(document: KDrawDocumentV1): { text: string; report: DxfExportReport } {
  const emittedHandles: string[] = [];
  const handleMap = mappedHandles(document.entities);
  const skipped: DxfExportReport["skipped"] = [];
  const entities = document.entities
    .map((entity) => {
      const output = emitEntity(entity, handleMap[entity.handle]!);
      if (output) emittedHandles.push(entity.handle);
      else skipped.push({ handle: entity.handle, kind: entity.kind, reason: "DXF adapter not implemented for this entity kind." });
      return output ?? "";
    })
    .join("");
  const text =
    pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, "AC1015") +
    pair(9, "$INSUNITS") + pair(70, INSUNITS[document.units.linear]) + pair(0, "ENDSEC") +
    pair(0, "SECTION") + pair(2, "ENTITIES") + entities + pair(0, "ENDSEC") + pair(0, "EOF");
  return { text, report: { emittedHandles, handleMap, skipped } };
}

export function readDxfSummary(text: string): DxfReadbackSummary {
  const lines = text.replaceAll("\r", "").split("\n");
  const pairs: Array<{ code: number; value: string }> = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index]?.trim() ?? "", 10);
    if (Number.isInteger(code)) pairs.push({ code, value: lines[index + 1]?.trim() ?? "" });
  }
  const entityTypes: Record<string, number> = {};
  const handles: string[] = [];
  const points: Array<{ x: number; y: number }> = [];
  let acadVersion: string | null = null;
  let inEntities = false;
  let currentType: string | null = null;
  let pendingX: number | null = null;
  let currentCircleCenter: { x: number; y: number } | null = null;
  for (let index = 0; index < pairs.length; index += 1) {
    const item = pairs[index]!;
    if (item.code === 2 && item.value === "ENTITIES") inEntities = true;
    if (item.code === 0 && item.value === "ENDSEC") inEntities = false;
    if (item.code === 9 && item.value === "$ACADVER") acadVersion = pairs[index + 1]?.value ?? null;
    if (!inEntities) continue;
    if (item.code === 0 && ["LINE", "CIRCLE", "LWPOLYLINE"].includes(item.value)) {
      currentType = item.value;
      currentCircleCenter = null;
      entityTypes[item.value] = (entityTypes[item.value] ?? 0) + 1;
    } else if (currentType && item.code === 5) {
      handles.push(item.value);
    } else if (currentType && [10, 11].includes(item.code)) {
      pendingX = Number(item.value);
    } else if (currentType && pendingX !== null && [20, 21].includes(item.code)) {
      const parsed = { x: pendingX, y: Number(item.value) };
      points.push(parsed);
      if (currentType === "CIRCLE" && item.code === 20) currentCircleCenter = parsed;
      pendingX = null;
    } else if (currentType === "CIRCLE" && item.code === 40 && currentCircleCenter) {
      const radius = Number(item.value);
      points.push(
        { x: currentCircleCenter.x - radius, y: currentCircleCenter.y - radius },
        { x: currentCircleCenter.x + radius, y: currentCircleCenter.y + radius },
      );
    }
  }
  const extents = points.length
    ? {
        minX: Math.min(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)),
        maxY: Math.max(...points.map((point) => point.y)),
      }
    : null;
  return { acadVersion, entityTypes, handles, extents };
}
