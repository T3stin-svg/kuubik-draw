import type { CadAppearance, CadLayer, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange } from "./transaction.js";

export class CadLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadLayerError";
  }
}

export interface CadLayerPlan {
  commandId: string;
  args: Record<string, unknown>;
  changes: CadChange[];
}

function validatedName(name: string): string {
  const value = name.trim();
  if (value.length === 0 || value.length > 255 || /[<>/\\"\:;?*|=,]/.test(value)) throw new CadLayerError("Layer name is empty, too long or contains a reserved character.");
  return value;
}

function requireLayer(document: KDrawDocumentV1, layerId: string): CadLayer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new CadLayerError(`Layer ${layerId} does not exist.`);
  return layer;
}

function uniqueName(document: KDrawDocumentV1, name: string, exceptId?: string): string {
  const value = validatedName(name);
  if (document.layers.some((layer) => layer.id !== exceptId && layer.name.localeCompare(value, undefined, { sensitivity: "accent" }) === 0)) {
    throw new CadLayerError(`Layer name ${value} already exists.`);
  }
  return value;
}

function allocateLayerId(document: KDrawDocumentV1, name: string): string {
  const stem = `layer-${name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new"}`;
  let id = stem;
  let suffix = 2;
  while (document.layers.some((layer) => layer.id === id)) id = `${stem}-${suffix++}`;
  return id;
}

function plan(commandId: string, args: Record<string, unknown>, changes: CadChange[]): CadLayerPlan {
  return { commandId, args, changes };
}

export function planCreateLayer(document: KDrawDocumentV1, name: string, requestedId?: string): CadLayerPlan {
  const validName = uniqueName(document, name);
  const id = requestedId?.trim() || allocateLayerId(document, validName);
  if (id.length === 0 || document.layers.some((layer) => layer.id === id)) throw new CadLayerError(`Layer id ${id} is invalid or already exists.`);
  const layer: CadLayer = { id, name: validName, visible: true, frozen: false, locked: false, plottable: true };
  return plan("LAYER_CREATE", { layerId: id, name: validName }, [{ type: "put-layer", layer }]);
}

export function planRenameLayer(document: KDrawDocumentV1, layerId: string, name: string): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  if (layer.id === "0") throw new CadLayerError("Layer 0 cannot be renamed.");
  const validName = uniqueName(document, name, layerId);
  if (validName === layer.name) throw new CadLayerError("Layer rename makes no semantic change.");
  return plan("LAYER_RENAME", { layerId, name: validName }, [{ type: "put-layer", layer: { ...layer, name: validName } }]);
}

function layerReferenceCount(document: KDrawDocumentV1, layerId: string): number {
  let count = document.entities.filter((entity) => entity.layerId === layerId).length;
  count += document.blocks.flatMap((block) => block.entities).filter((entity) => entity.layerId === layerId).length;
  count += document.layouts.flatMap((layout) => layout.entities ?? []).filter((entity) => entity.layerId === layerId).length;
  count += document.layouts.flatMap((layout) => layout.viewports).filter((viewport) => Object.hasOwn(viewport.layerOverrides ?? {}, layerId)).length;
  return count;
}

export function planDeleteLayer(document: KDrawDocumentV1, layerId: string): CadLayerPlan {
  requireLayer(document, layerId);
  if (layerId === "0") throw new CadLayerError("Layer 0 cannot be deleted.");
  if (document.currentLayerId === layerId) throw new CadLayerError("Current layer cannot be deleted.");
  const references = layerReferenceCount(document, layerId);
  if (references > 0) throw new CadLayerError(`Referenced layer cannot be deleted (${references} references).`);
  return plan("LAYER_DELETE", { layerId }, [{ type: "delete-layer", layerId }]);
}

export function planSetCurrentLayer(document: KDrawDocumentV1, layerId: string): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  if (!layer.visible || layer.frozen) throw new CadLayerError("An off or frozen layer cannot become current.");
  if (document.currentLayerId === layerId) throw new CadLayerError("Layer is already current.");
  return plan("LAYER_CURRENT", { layerId }, [{ type: "set-current-layer", layerId }]);
}

export type CadLayerToggle = "visible" | "locked" | "frozen" | "plottable";

export function planSetLayerToggle(document: KDrawDocumentV1, layerId: string, property: CadLayerToggle, value: boolean): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  if (typeof value !== "boolean") throw new CadLayerError("Layer toggle must be boolean.");
  if (layer[property] === value) throw new CadLayerError("Layer toggle makes no semantic change.");
  if (property === "frozen" && value && document.currentLayerId === layerId) throw new CadLayerError("Current layer cannot be frozen.");
  const command = { visible: "LAYER_ON", locked: "LAYER_LOCK", frozen: "LAYER_FREEZE", plottable: "LAYER_PLOT" }[property];
  return plan(command, { layerId, [property]: value }, [{ type: "put-layer", layer: { ...layer, [property]: value } }]);
}

export interface CadLayerAppearancePatch {
  color?: string | null;
  colorMethod?: "aci" | "trueColor" | null;
  aciIndex?: number | null;
  linetypeId?: string | null;
  lineweightMm?: number | null;
  transparency?: number | null;
}

export function planSetLayerAppearance(document: KDrawDocumentV1, layerId: string, patch: CadLayerAppearancePatch): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  if (patch.color !== undefined && patch.color !== null && !/^#[0-9a-f]{6}$/i.test(patch.color)) throw new CadLayerError("Layer color must be a six-digit hex color.");
  if (patch.aciIndex !== undefined && patch.aciIndex !== null && (!Number.isInteger(patch.aciIndex) || patch.aciIndex < 1 || patch.aciIndex > 255)) throw new CadLayerError("ACI color must be 1..255.");
  if (patch.linetypeId !== undefined && patch.linetypeId !== null && !document.linetypes.some((linetype) => linetype.id === patch.linetypeId)) throw new CadLayerError(`Linetype ${patch.linetypeId} does not exist.`);
  if (patch.lineweightMm !== undefined && patch.lineweightMm !== null && (!Number.isFinite(patch.lineweightMm) || patch.lineweightMm < 0)) throw new CadLayerError("Lineweight must be finite and non-negative.");
  if (patch.transparency !== undefined && patch.transparency !== null && (!Number.isFinite(patch.transparency) || patch.transparency < 0 || patch.transparency > 90)) throw new CadLayerError("Transparency must be 0..90 percent.");
  const appearance: CadAppearance = { ...(layer.appearance ?? {}) };
  for (const [key, value] of Object.entries(patch) as Array<[keyof CadLayerAppearancePatch, CadLayerAppearancePatch[keyof CadLayerAppearancePatch]]>) {
    if (value === null) delete appearance[key as keyof CadAppearance];
    else if (value !== undefined) (appearance as Record<string, unknown>)[key] = value;
  }
  const next = { ...layer, ...(Object.keys(appearance).length > 0 ? { appearance } : {}) };
  if (Object.keys(appearance).length === 0) delete next.appearance;
  if (JSON.stringify(next) === JSON.stringify(layer)) throw new CadLayerError("Layer appearance makes no semantic change.");
  return plan("LAYER_PROPERTIES", { layerId, ...patch }, [{ type: "put-layer", layer: next }]);
}
