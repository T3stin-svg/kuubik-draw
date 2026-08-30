import type {
  CadAppearance,
  CadBlockDefinition,
  CadEntity,
  CadEntityBase,
  CadLayer,
  CadLayout,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import { assertKDrawDocumentV1 } from "@kuubik/cad-schema";
import { createEmptyDocument } from "./document.js";
import { aciColor } from "./plot-style.js";

type UnknownRecord = Record<string, unknown>;

export interface LegacyImportReport {
  sourceDrawBlobs: number;
  importedEntities: number;
  proxyEntities: number;
  layers: number;
  blocks: number;
  layouts: number;
  attachments: number;
  ignoredKinds: string[];
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
  checksum: string;
}

export interface LegacyImportResult {
  document: KDrawDocumentV1;
  report: LegacyImportReport;
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function point(value: unknown): { x: number; y: number } {
  const item = record(value);
  return { x: finite(item?.x), y: finite(item?.y) };
}

function appearance(value: UnknownRecord): CadAppearance | undefined {
  const output: CadAppearance = {};
  const sourceColor = typeof value.color === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(value.color) ? value.color : undefined;
  const sourceAci = typeof value.aciIndex === "number" && Number.isInteger(value.aciIndex) && value.aciIndex >= 1 && value.aciIndex <= 255
    ? value.aciIndex
    : undefined;
  if (value.colorMethod === "trueColor" && sourceColor !== undefined) {
    output.color = sourceColor;
    output.colorMethod = "trueColor";
    if (sourceAci !== undefined) output.aciIndex = sourceAci;
  } else if (sourceAci !== undefined) {
    // Legacy indexed colour is authoritative: derive the RGB render fallback so
    // the renderer, plot output and native DXF group 62 cannot disagree.
    output.color = aciColor(sourceAci);
    output.colorMethod = "aci";
    output.aciIndex = sourceAci;
  } else if (sourceColor !== undefined) {
    output.color = sourceColor;
    if (value.colorMethod === "aci" || value.colorMethod === "trueColor") output.colorMethod = value.colorMethod;
  }
  if (typeof value.lwMm === "number" && Number.isFinite(value.lwMm)) output.lineweightMm = value.lwMm;
  if (typeof value.lt === "string") output.linetypeId = value.lt;
  if (typeof value.linetypeScale === "number" && Number.isFinite(value.linetypeScale) && value.linetypeScale > 0) output.linetypeScale = value.linetypeScale;
  if (typeof value.thickness === "number" && Number.isFinite(value.thickness)) output.thickness = value.thickness;
  if (typeof value.plotStyleId === "string" && value.plotStyleId) output.plotStyleId = value.plotStyleId;
  if (typeof value.materialId === "string" && value.materialId) output.materialId = value.materialId;
  return Object.keys(output).length > 0 ? output : undefined;
}

function collectRecords(value: unknown, result: UnknownRecord[], seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((child) => collectRecords(child, result, seen));
    return;
  }
  const item = record(value);
  if (!item || seen.has(item)) return;
  seen.add(item);
  if (typeof item.k === "string") result.push(item);
  Object.values(item).forEach((child) => collectRecords(child, result, seen));
}

function mapLegacyEntity(value: unknown, fallbackLayer: string): CadEntity | null {
  const source = record(value);
  const geometry = record(source?.g);
  if (!source || !geometry || typeof source.id !== "string" || typeof geometry.t !== "string") return null;
  const style = appearance(source);
  const base: CadEntityBase = {
    handle: source.id,
    layerId: typeof source.layerId === "string" && source.layerId ? source.layerId : fallbackLayer,
    ...(style ? { appearance: style } : {}),
  };

  switch (geometry.t) {
    case "line":
      return { kind: "line", ...base, start: point(geometry.a), end: point(geometry.b) };
    case "pline": {
      const vertices = Array.isArray(geometry.pts)
        ? geometry.pts.map((item) => {
            const vertex = record(item);
            return {
              ...point(item),
              ...(typeof vertex?.b === "number" && Number.isFinite(vertex.b) ? { bulge: vertex.b } : {}),
            };
          })
        : [];
      return { kind: "polyline", ...base, vertices, closed: geometry.closed === true };
    }
    case "circle":
      return { kind: "circle", ...base, center: point(geometry.c), radius: finite(geometry.r) };
    case "ellipse":
      return {
        kind: "ellipse",
        ...base,
        center: point(geometry.c),
        majorAxis: point(geometry.major),
        ratio: finite(geometry.ratio, 1),
        startParameter: finite(geometry.start, 0),
        endParameter: finite(geometry.end, Math.PI * 2),
      };
    case "text":
    case "mtext":
      return {
        kind: geometry.t,
        ...base,
        position: point(geometry.at),
        text: typeof geometry.s === "string" ? geometry.s : "",
        height: finite(geometry.hMm, 2.5),
        rotationRad: (finite(geometry.rot) * Math.PI) / 180,
        ...(typeof geometry.ts === "string" ? { styleId: geometry.ts } : {}),
      };
    case "leader":
      return {
        kind: "leader",
        ...base,
        vertices: Array.isArray(geometry.pts) ? geometry.pts.map(point) : [],
        ...(typeof geometry.s === "string" ? { text: geometry.s } : {}),
      };
    case "dim": {
      const dimensionKind =
        geometry.kind === "angular"
          ? "angular"
          : geometry.kind === "radius"
            ? "radial"
            : geometry.kind === "diameter"
              ? "diameter"
              : geometry.kind === "aligned"
                ? "aligned"
                : "linear";
      return {
        kind: "dimension",
        ...base,
        dimensionKind,
        definitionPoints: [geometry.p1, geometry.p2, geometry.p3].filter((item) => record(item)).map(point),
        styleId: typeof geometry.styleId === "string" ? geometry.styleId : "legacy-default",
      };
    }
    case "hatch":
      return {
        kind: "hatch",
        ...base,
        pattern: typeof geometry.pat === "string" ? geometry.pat : "SOLID",
        associative: geometry.associative === true,
        loops: Array.isArray(geometry.loops)
          ? geometry.loops.map((loop, index) => {
              const loopRecord = record(loop);
              return {
                vertices: Array.isArray(loopRecord?.pts) ? loopRecord.pts.map(point) : [],
                isHole: index > 0,
              };
            })
          : [],
      };
    case "blockRef":
      return {
        kind: "blockRef",
        ...base,
        blockId: typeof geometry.defId === "string" ? geometry.defId : "missing-block",
        insertion: point(geometry.at),
        scale: { x: finite(geometry.scale, 1) * (geometry.mir === true ? -1 : 1), y: finite(geometry.scale, 1) },
        rotationRad: (finite(geometry.rot) * Math.PI) / 180,
        ...(record(geometry.av) ? { attributes: geometry.av as Record<string, string> } : {}),
      };
    default:
      return {
        kind: "proxy",
        ...base,
        originalType: `legacy:${geometry.t}`,
        raw: structuredClone(source),
      };
  }
}

function uniqueHandle(entity: CadEntity, used: Set<string>): CadEntity {
  if (!used.has(entity.handle)) {
    used.add(entity.handle);
    return entity;
  }
  let index = 2;
  while (used.has(`${entity.handle}-${index}`)) index += 1;
  const renamed = { ...entity, handle: `${entity.handle}-${index}` } as CadEntity;
  used.add(renamed.handle);
  return renamed;
}

function checksum(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function entityPoints(entity: CadEntity): { x: number; y: number }[] {
  switch (entity.kind) {
    case "line": return [entity.start, entity.end];
    case "polyline": return entity.vertices;
    case "circle": return [
      { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
      { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius },
    ];
    case "ellipse": return [
      { x: entity.center.x - Math.abs(entity.majorAxis.x), y: entity.center.y - Math.abs(entity.majorAxis.y) },
      { x: entity.center.x + Math.abs(entity.majorAxis.x), y: entity.center.y + Math.abs(entity.majorAxis.y) },
    ];
    case "text": case "mtext": return [entity.position];
    case "leader": return entity.vertices;
    case "dimension": return entity.definitionPoints;
    case "blockRef": return [entity.insertion];
    default: return [];
  }
}

export function importLegacyDrawProject(
  legacyProject: unknown,
  documentId: string,
  now = new Date().toISOString(),
): LegacyImportResult {
  const records: UnknownRecord[] = [];
  collectRecords(legacyProject, records);
  const document = createEmptyDocument({ documentId, now, units: "mm" });
  const ignoredKinds = new Set<string>();
  const layerMap = new Map<string, CadLayer>(document.layers.map((layer) => [layer.id, layer]));
  const blockMap = new Map<string, CadBlockDefinition>();
  const layoutMap = new Map<string, CadLayout>();
  const handles = new Set<string>();
  let sourceDrawBlobs = 0;

  for (const item of records) {
    const kind = item.k;
    if (kind === "drawLayers" && Array.isArray(item.layers)) {
      for (const value of item.layers) {
        const layer = record(value);
        if (!layer || typeof layer.id !== "string") continue;
        const layerAppearance = appearance(layer);
        layerMap.set(layer.id, {
          id: layer.id,
          name: typeof layer.name === "string" ? layer.name : layer.id,
          visible: layer.vis !== false,
          frozen: false,
          locked: layer.lock === true,
          plottable: layer.plot !== false,
          ...(layerAppearance ? { appearance: layerAppearance } : {}),
        });
      }
      continue;
    }
    if (kind === "draw" && Array.isArray(item.ents)) {
      sourceDrawBlobs += 1;
      for (const value of item.ents) {
        const entity = mapLegacyEntity(value, "0");
        if (entity) document.entities.push(uniqueHandle(entity, handles));
      }
      continue;
    }
    if (kind === "drawBlocks" && Array.isArray(item.defs)) {
      for (const value of item.defs) {
        const definition = record(value);
        if (!definition || typeof definition.id !== "string") continue;
        const entities = Array.isArray(definition.ents)
          ? definition.ents.flatMap((entity) => {
              const mapped = mapLegacyEntity(entity, "0");
              return mapped ? [uniqueHandle(mapped, handles)] : [];
            })
          : [];
        blockMap.set(definition.id, {
          id: definition.id,
          name: typeof definition.name === "string" ? definition.name : definition.id,
          basePoint: { x: 0, y: 0 },
          entities,
        });
      }
      continue;
    }
    if (kind === "drawLayouts" && Array.isArray(item.layouts)) {
      for (const value of item.layouts) {
        const layout = record(value);
        const paper = record(layout?.paper);
        if (!layout || typeof layout.id !== "string" || !paper) continue;
        layoutMap.set(layout.id, {
          id: layout.id,
          name: typeof layout.name === "string" ? layout.name : layout.id,
          kind: "paper",
          paper: {
            widthMm: finite(paper.widthMm, 297),
            heightMm: finite(paper.heightMm, 210),
            marginsMm: {
              top: finite(record(paper.marginsMm)?.top),
              right: finite(record(paper.marginsMm)?.right),
              bottom: finite(record(paper.marginsMm)?.bottom),
              left: finite(record(paper.marginsMm)?.left),
            },
          },
          viewports: [],
        });
      }
      continue;
    }
    if (kind === "pdfUnderlays" && Array.isArray(item.refs)) {
      for (const value of item.refs) {
        const attachment = record(value);
        if (!attachment || typeof attachment.sourceKey !== "string" || typeof attachment.name !== "string") continue;
        document.attachments.push({
          id: typeof attachment.id === "string" ? attachment.id : attachment.sourceKey,
          mediaType: "application/pdf",
          sha256: attachment.sourceKey.toLowerCase(),
          fileName: attachment.name,
          role: "underlay",
        });
      }
      continue;
    }
    if (typeof kind === "string") ignoredKinds.add(kind);
  }

  document.layers = [...layerMap.values()];
  document.blocks = [...blockMap.values()];
  document.layouts.push(...layoutMap.values());
  const points = document.entities.flatMap(entityPoints);
  const extents = points.length
    ? {
        minX: Math.min(...points.map((item) => item.x)),
        minY: Math.min(...points.map((item) => item.y)),
        maxX: Math.max(...points.map((item) => item.x)),
        maxY: Math.max(...points.map((item) => item.y)),
      }
    : null;
  document.metadata = {
    ...document.metadata,
    source: "legacy-kuubik-3d-read-only-import",
    extensions: { legacyChecksum: checksum(JSON.stringify(legacyProject)) },
  };
  assertKDrawDocumentV1(document);

  return {
    document,
    report: {
      sourceDrawBlobs,
      importedEntities: document.entities.length,
      proxyEntities: document.entities.filter((entity) => entity.kind === "proxy").length,
      layers: document.layers.length,
      blocks: document.blocks.length,
      layouts: document.layouts.length,
      attachments: document.attachments.length,
      ignoredKinds: [...ignoredKinds].sort(),
      extents,
      checksum: checksum(JSON.stringify(document)),
    },
  };
}
