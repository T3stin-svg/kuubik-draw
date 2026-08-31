import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { readBlockAttributes } from "../blocks/contracts.js";
import { readDimensionAssociation, readHatchAssociation, readLeaderContract, readTableContract } from "./contracts.js";
import { TABLE_STYLES_EXTENSION_KEY } from "./table.js";

export type AnnotationBlockDxfCapabilityId =
  | "dimension-linear"
  | "dimension-aligned"
  | "dimension-angular"
  | "dimension-radial"
  | "dimension-diameter"
  | "dimension-ordinate"
  | "dimension-style"
  | "dimension-style-profile"
  | "dimension-association"
  | "dimension-chain"
  | "text-style"
  | "mtext-layout"
  | "leader"
  | "leader-association"
  | "mleader"
  | "hatch-solid"
  | "hatch-line-pattern"
  | "hatch-islands"
  | "hatch-association"
  | "table"
  | "block-definition"
  | "block-nesting"
  | "insert-transform"
  | "block-attributes";

export type DxfCapabilityLevel = "exact" | "lossy" | "unsupported";

export interface AnnotationBlockDxfRequirement {
  capability: AnnotationBlockDxfCapabilityId;
  rowIds: string[];
  handles: string[];
  minimumVersion: "AC1018" | "AC1021";
}

export interface AnnotationBlockDxfDeclaration {
  adapterId: string;
  dxfVersion: string;
  capabilities: Partial<Record<AnnotationBlockDxfCapabilityId, DxfCapabilityLevel>>;
}

export interface AnnotationBlockDxfEvaluation {
  requirements: AnnotationBlockDxfRequirement[];
  rejected: Array<AnnotationBlockDxfRequirement & {
    declared: DxfCapabilityLevel | "missing";
    reason: "capability" | "version";
  }>;
}

export interface AnnotationBlockDxfCapabilityReceipt {
  schemaVersion: 1;
  declaration: AnnotationBlockDxfDeclaration;
  requirements: AnnotationBlockDxfRequirement[];
}

export class AnnotationBlockDxfCapabilityError extends Error {
  constructor(readonly evaluation: AnnotationBlockDxfEvaluation) {
    super(`DXF adapter cannot preserve annotation/block semantics exactly: ${evaluation.rejected.map((item) => `${item.capability}=${item.reason === "version" ? `requires-${item.minimumVersion}` : item.declared}`).join(", ")}.`);
    this.name = "AnnotationBlockDxfCapabilityError";
  }
}

function extensionKind(entity: CadEntity): string | null {
  const value = entity.extensionData?.["kuubik.annotation.v1"];
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { kind?: unknown }).kind === "string"
    ? (value as { kind: string }).kind
    : null;
}

function requirementMetadata(capability: AnnotationBlockDxfCapabilityId): Pick<AnnotationBlockDxfRequirement, "rowIds" | "minimumVersion"> {
  switch (capability) {
    case "dimension-linear": return { rowIds: ["F-061"], minimumVersion: "AC1018" };
    case "dimension-aligned": return { rowIds: ["F-062"], minimumVersion: "AC1018" };
    case "dimension-angular":
    case "dimension-radial":
    case "dimension-diameter":
    case "dimension-ordinate": return { rowIds: ["F-063"], minimumVersion: "AC1018" };
    case "dimension-style": return { rowIds: ["F-066"], minimumVersion: "AC1018" };
    case "dimension-style-profile": return { rowIds: ["F-066"], minimumVersion: "AC1018" };
    case "dimension-association": return { rowIds: ["F-065"], minimumVersion: "AC1018" };
    case "dimension-chain": return { rowIds: ["F-064", "F-065"], minimumVersion: "AC1018" };
    case "text-style": return { rowIds: ["F-058"], minimumVersion: "AC1018" };
    case "mtext-layout": return { rowIds: ["F-057"], minimumVersion: "AC1018" };
    case "leader": return { rowIds: ["F-059"], minimumVersion: "AC1018" };
    case "leader-association": return { rowIds: ["F-059", "F-060"], minimumVersion: "AC1018" };
    case "mleader": return { rowIds: ["F-060"], minimumVersion: "AC1021" };
    case "hatch-solid":
    case "hatch-line-pattern": return { rowIds: ["F-067"], minimumVersion: "AC1018" };
    case "hatch-islands":
    case "hatch-association": return { rowIds: ["F-067"], minimumVersion: "AC1018" };
    case "table": return { rowIds: ["F-068"], minimumVersion: "AC1018" };
    case "block-definition": return { rowIds: ["F-087"], minimumVersion: "AC1018" };
    case "insert-transform": return { rowIds: ["F-088"], minimumVersion: "AC1018" };
    case "block-nesting": return { rowIds: ["F-089", "F-090"], minimumVersion: "AC1018" };
    case "block-attributes": return { rowIds: ["F-091"], minimumVersion: "AC1018" };
  }
}

export function requiredAnnotationBlockDxfCapabilities(document: KDrawDocumentV1): AnnotationBlockDxfRequirement[] {
  const handles = new Map<AnnotationBlockDxfCapabilityId, Set<string>>();
  const add = (capability: AnnotationBlockDxfCapabilityId, handle: string): void => {
    const items = handles.get(capability) ?? new Set<string>();
    items.add(handle);
    handles.set(capability, items);
  };
  if (document.dimensionStyles.length) add("dimension-style", "$DIMSTYLE");
  for (const style of document.dimensionStyles) if (style.overrides?.["kuubik.dimensionStyle.v1"] !== undefined) add("dimension-style-profile", `$DIMSTYLE:${style.id}`);
  if (document.textStyles.length) add("text-style", "$TEXTSTYLE");
  if (document.metadata.extensions?.[TABLE_STYLES_EXTENSION_KEY] !== undefined) add("table", "$TABLESTYLE");
  for (const entity of document.entities) {
    if (entity.kind === "dimension") {
      add(`dimension-${entity.dimensionKind}` as AnnotationBlockDxfCapabilityId, entity.handle);
      const association = readDimensionAssociation(entity);
      if (association?.associative) add("dimension-association", entity.handle);
      if (association?.chain) add("dimension-chain", entity.handle);
    }
    if (entity.kind === "mtext") add("mtext-layout", entity.handle);
    if (entity.kind === "leader") {
      add(extensionKind(entity) === "mleader" ? "mleader" : "leader", entity.handle);
      if (readLeaderContract(entity)?.associative) add("leader-association", entity.handle);
    }
    if (entity.kind === "hatch") {
      const association = readHatchAssociation(entity);
      if (extensionKind(entity) === "hatch" && association === null) throw new TypeError(`Malformed HATCH extension contract: ${entity.handle}.`);
      add(association?.pattern.type === "solid" || entity.pattern.trim().toLocaleUpperCase("en-US") === "SOLID" ? "hatch-solid" : "hatch-line-pattern", entity.handle);
      if (entity.loops.some((loop) => loop.isHole) || (association !== null && (association.boundaryHandles.length > 1 || association.islandDetection !== "normal"))) add("hatch-islands", entity.handle);
      if (entity.associative) add("hatch-association", entity.handle);
    }
    if (entity.kind === "blockRef") {
      add("insert-transform", entity.handle);
      if (Object.keys(entity.attributes ?? {}).length) add("block-attributes", entity.handle);
    }
    if (readTableContract(entity)) add("table", entity.handle);
  }
  for (const block of document.blocks) {
    add("block-definition", `$BLOCK:${block.id}`);
    if (block.entities.some((entity) => entity.kind === "blockRef")) add("block-nesting", `$BLOCK:${block.id}`);
    if (readBlockAttributes(block).length) add("block-attributes", `$BLOCK:${block.id}`);
  }
  return [...handles.entries()].sort(([first], [second]) => first.localeCompare(second, "en-US")).map(([capability, requirementHandles]) => ({
    capability,
    ...requirementMetadata(capability),
    handles: [...requirementHandles].sort((first, second) => first.localeCompare(second, "en-US")),
  }));
}

export function evaluateAnnotationBlockDxfCapabilities(document: KDrawDocumentV1, declaration: AnnotationBlockDxfDeclaration): AnnotationBlockDxfEvaluation {
  if (!declaration.adapterId.trim() || !declaration.dxfVersion.trim()) throw new TypeError("DXF capability declaration requires adapter id and version.");
  const requirements = requiredAnnotationBlockDxfCapabilities(document);
  const versionRank = declaration.dxfVersion.match(/^AC(\d{4})$/)?.[1];
  if (!versionRank) throw new TypeError(`Unsupported DXF version declaration: ${declaration.dxfVersion}.`);
  const rejected: AnnotationBlockDxfEvaluation["rejected"] = [];
  for (const requirement of requirements) {
    const declared = declaration.capabilities[requirement.capability] ?? "missing";
    if (declared !== "exact") rejected.push({ ...requirement, declared, reason: "capability" });
    else if (Number(versionRank) < Number(requirement.minimumVersion.slice(2))) rejected.push({ ...requirement, declared, reason: "version" });
  }
  return { requirements, rejected };
}

export function assertAnnotationBlockDxfCapabilities(document: KDrawDocumentV1, declaration: AnnotationBlockDxfDeclaration): AnnotationBlockDxfRequirement[] {
  const evaluation = evaluateAnnotationBlockDxfCapabilities(document, declaration);
  if (evaluation.rejected.length) throw new AnnotationBlockDxfCapabilityError(evaluation);
  return evaluation.requirements;
}

export function createAnnotationBlockDxfCapabilityReceipt(document: KDrawDocumentV1, declaration: AnnotationBlockDxfDeclaration): AnnotationBlockDxfCapabilityReceipt {
  return { schemaVersion: 1, declaration: structuredClone(declaration), requirements: structuredClone(assertAnnotationBlockDxfCapabilities(document, declaration)) };
}

export function readBackAnnotationBlockDxfCapabilityReceipt(document: KDrawDocumentV1, value: unknown): AnnotationBlockDxfCapabilityReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== 1) throw new TypeError("Annotation/block DXF capability receipt schema is invalid.");
  const receipt = value as AnnotationBlockDxfCapabilityReceipt;
  if (typeof receipt.declaration !== "object" || receipt.declaration === null || !Array.isArray(receipt.requirements)) throw new TypeError("Annotation/block DXF capability receipt payload is invalid.");
  const requirements = assertAnnotationBlockDxfCapabilities(document, receipt.declaration);
  if (JSON.stringify(requirements) !== JSON.stringify(receipt.requirements)) throw new Error("Annotation/block DXF capability receipt does not match the document read-back.");
  return structuredClone(receipt);
}
