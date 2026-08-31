import type { CadAppearance, CadLayer, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "./layer-policy.js";
import { assertCadAppearance, validateCadTransparency } from "./plot-style.js";
import type { CadChange } from "./transaction.js";

export const CAD_ZERO_LAYER_NAME = "0";
export const CAD_DEFPOINTS_LAYER_NAME = "Defpoints";

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

function normalizedLayerName(name: string): string {
  return name.normalize("NFC").toUpperCase();
}

function isNamedLayer(layer: Pick<CadLayer, "name">, name: string): boolean {
  return normalizedLayerName(layer.name) === normalizedLayerName(name);
}

function validatedName(name: string): string {
  const value = name.trim().normalize("NFC");
  if (value.length === 0 || value.length > 255 || /[\u0000-\u001f<>\/\\":;?*|=,]/u.test(value)) {
    throw new CadLayerError("Layer name is empty, too long or contains a reserved character.");
  }
  return value;
}

function requireLayer(document: KDrawDocumentV1, layerId: string): CadLayer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new CadLayerError(`Layer ${layerId} does not exist.`);
  return layer;
}

function uniqueName(document: KDrawDocumentV1, name: string, exceptId?: string): string {
  const value = validatedName(name);
  const normalized = normalizedLayerName(value);
  if (document.layers.some((layer) => layer.id !== exceptId && normalizedLayerName(layer.name) === normalized)) {
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
  const requestedName = uniqueName(document, name);
  const defpoints = normalizedLayerName(requestedName) === normalizedLayerName(CAD_DEFPOINTS_LAYER_NAME);
  const validName = defpoints ? CAD_DEFPOINTS_LAYER_NAME : requestedName;
  const id = requestedId?.trim() || (defpoints ? CAD_DEFPOINTS_LAYER_NAME : allocateLayerId(document, validName));
  if (id.length === 0 || document.layers.some((layer) => layer.id === id)) throw new CadLayerError(`Layer id ${id} is invalid or already exists.`);
  if (defpoints && id !== CAD_DEFPOINTS_LAYER_NAME) throw new CadLayerError("Defpoints must use its canonical layer id.");
  const layer: CadLayer = { id, name: validName, visible: true, frozen: false, locked: false, plottable: !defpoints };
  return plan("LAYER_CREATE", { layerId: id, name: validName }, [{ type: "put-layer", layer }]);
}

export function planRenameLayer(document: KDrawDocumentV1, layerId: string, name: string): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  if (isNamedLayer(layer, CAD_ZERO_LAYER_NAME)) throw new CadLayerError("Layer 0 cannot be renamed.");
  if (isNamedLayer(layer, CAD_DEFPOINTS_LAYER_NAME)) throw new CadLayerError("Defpoints cannot be renamed.");
  const validName = uniqueName(document, name, layerId);
  if (normalizedLayerName(validName) === normalizedLayerName(CAD_DEFPOINTS_LAYER_NAME)) {
    throw new CadLayerError("Defpoints can only be created as the canonical system layer.");
  }
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
  const layer = requireLayer(document, layerId);
  if (isNamedLayer(layer, CAD_ZERO_LAYER_NAME)) throw new CadLayerError("Layer 0 cannot be deleted.");
  if (isNamedLayer(layer, CAD_DEFPOINTS_LAYER_NAME)) throw new CadLayerError("Defpoints cannot be deleted.");
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
  if (property === "plottable" && value && isNamedLayer(layer, CAD_DEFPOINTS_LAYER_NAME)) {
    throw new CadLayerError("Defpoints is always non-plottable.");
  }
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

export interface CadEntityLayerPropertiesPatch extends CadLayerAppearancePatch {
  layerId?: string;
  clearOverrides?: boolean;
}

export interface CadEntityLayerPlan extends CadLayerPlan {
  targetHandles: string[];
  resultHandles: string[];
}

function validateAppearancePatch(document: KDrawDocumentV1, patch: CadLayerAppearancePatch): void {
  if (patch.color !== undefined && patch.color !== null && !/^#[0-9a-f]{6}$/i.test(patch.color)) throw new CadLayerError("Layer color must be a six-digit hex color.");
  if (patch.aciIndex !== undefined && patch.aciIndex !== null && (!Number.isInteger(patch.aciIndex) || patch.aciIndex < 1 || patch.aciIndex > 255)) throw new CadLayerError("ACI color must be 1..255.");
  if (patch.linetypeId !== undefined && patch.linetypeId !== null && !document.linetypes.some((linetype) => linetype.id === patch.linetypeId)) throw new CadLayerError(`Linetype ${patch.linetypeId} does not exist.`);
  if (patch.lineweightMm !== undefined && patch.lineweightMm !== null && (!Number.isFinite(patch.lineweightMm) || patch.lineweightMm < 0)) throw new CadLayerError("Lineweight must be finite and non-negative.");
  if (patch.transparency !== undefined && patch.transparency !== null) {
    try { validateCadTransparency(patch.transparency, "Transparency"); }
    catch { throw new CadLayerError("Transparency must be 0..90 percent."); }
  }
}

function patchedAppearance(current: CadAppearance | undefined, patch: CadLayerAppearancePatch, clearOverrides = false): CadAppearance | undefined {
  const appearance: CadAppearance = clearOverrides ? {} : { ...(current ?? {}) };
  if (patch.color === null) {
    delete appearance.color;
    delete appearance.colorMethod;
    delete appearance.aciIndex;
  }
  for (const [key, value] of Object.entries(patch) as Array<[keyof CadLayerAppearancePatch, CadLayerAppearancePatch[keyof CadLayerAppearancePatch]]>) {
    if (key === "color" && value === null) continue;
    if (value === null) delete appearance[key as keyof CadAppearance];
    else if (value !== undefined) (appearance as Record<string, unknown>)[key] = value;
  }
  assertCadAppearance(Object.keys(appearance).length === 0 ? undefined : appearance);
  return Object.keys(appearance).length === 0 ? undefined : appearance;
}

export function planSetLayerAppearance(document: KDrawDocumentV1, layerId: string, patch: CadLayerAppearancePatch): CadLayerPlan {
  const layer = requireLayer(document, layerId);
  validateAppearancePatch(document, patch);
  const appearance = patchedAppearance(layer.appearance, patch);
  const next = { ...layer, ...(appearance ? { appearance } : {}) };
  if (!appearance) delete next.appearance;
  if (JSON.stringify(next) === JSON.stringify(layer)) throw new CadLayerError("Layer appearance makes no semantic change.");
  return plan("LAYER_PROPERTIES", { layerId, ...patch }, [{ type: "put-layer", layer: next }]);
}

/** Plans one all-or-nothing model-space layer/property edit for every selected entity. */
export function planSetEntityLayerProperties(
  document: KDrawDocumentV1,
  handles: readonly string[],
  patch: CadEntityLayerPropertiesPatch,
): CadEntityLayerPlan {
  const targetHandles = [...new Set(handles)];
  if (targetHandles.length === 0) throw new CadLayerError("Entity property update requires at least one handle.");
  if (patch.layerId === undefined && patch.clearOverrides !== true
    && Object.entries(patch).every(([key, value]) => key === "clearOverrides" || value === undefined)) {
    throw new CadLayerError("Entity property update requires a semantic patch.");
  }
  const { layerId, clearOverrides, ...appearancePatch } = patch;
  validateAppearancePatch(document, appearancePatch);
  const destination = layerId === undefined ? undefined : requireLayer(document, layerId);
  if (destination?.locked) throw new CadLayerError(`Target layer ${destination.id} is locked.`);

  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const changes: CadChange[] = [];
  const resultHandles: string[] = [];
  for (const handle of targetHandles) {
    const entity = entities.get(handle);
    if (!entity) throw new CadLayerError(`Entity ${handle} does not exist in model space.`);
    const sourceLayer = requireLayer(document, entity.layerId);
    if (sourceLayer.locked) throw new CadLayerError(`Entity ${handle} is on locked layer ${sourceLayer.id}.`);
    const appearance = patchedAppearance(entity.appearance, appearancePatch, clearOverrides === true);
    const next = { ...structuredClone(entity), ...(layerId === undefined ? {} : { layerId }), ...(appearance ? { appearance } : {}) };
    if (!appearance) delete next.appearance;
    if (JSON.stringify(next) === JSON.stringify(entity)) continue;
    changes.push({ type: "put", entity: next });
    resultHandles.push(handle);
  }
  if (changes.length === 0) throw new CadLayerError("Entity property update makes no semantic change.");
  return {
    commandId: "ENTITY_LAYER_PROPERTIES",
    args: { handles: targetHandles, patch: structuredClone(patch) },
    changes,
    targetHandles,
    resultHandles,
  };
}

function documentEntities(document: KDrawDocumentV1) {
  return [
    ...document.entities,
    ...document.blocks.flatMap((block) => block.entities),
    ...document.layouts.flatMap((layout) => layout.entities ?? []),
  ];
}

/** Validates and clones the persisted layer portion before Layer Manager accepts it. */
export function readCadLayerContract(document: KDrawDocumentV1): Pick<KDrawDocumentV1, "currentLayerId" | "layers" | "linetypes" | "entities"> {
  const names = new Set<string>();
  for (const layer of document.layers) {
    const name = validatedName(layer.name);
    const normalized = normalizedLayerName(name);
    if (names.has(normalized)) throw new CadLayerError(`Layer name ${name} already exists.`);
    names.add(normalized);
    if (normalized === normalizedLayerName(CAD_DEFPOINTS_LAYER_NAME) && layer.plottable) {
      throw new CadLayerError("Defpoints is always non-plottable.");
    }
  }
  if (!document.layers.some((layer) => layer.id === document.currentLayerId)) throw new CadLayerError(`Current layer ${document.currentLayerId} does not exist.`);
  const index = createCadLayerPropertyIndex(document.layers, document.linetypes);
  for (const entity of documentEntities(document)) resolveCadEntityLayerProperties(entity, index);
  for (const layer of document.layers) {
    if (layer.appearance?.linetypeId && !index.linetypes.has(layer.appearance.linetypeId)) {
      throw new CadLayerError(`Linetype ${layer.appearance.linetypeId} does not exist.`);
    }
  }
  return {
    currentLayerId: document.currentLayerId,
    layers: structuredClone(document.layers),
    linetypes: structuredClone(document.linetypes),
    entities: structuredClone(document.entities),
  };
}
