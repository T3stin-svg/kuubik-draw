import type { CadAppearance, CadEntity, CadLayer, CadPlotStyle } from "@kuubik/cad-schema";
import { AUTOCAD_2024_ACI_PALETTE } from "./aci-palette.js";

export const DEFAULT_PLOT_STYLE: Readonly<CadPlotStyle> = Object.freeze({
  profile: "monochrome",
  plotLineweights: true,
  plotTransparency: true,
});

export interface ResolvedCadAppearance {
  color: string;
  colorMethod: "aci" | "trueColor";
  aciIndex?: number;
  lineweightMm: number;
  transparencyPercent: number;
}

export interface ResolvedPlotAppearance extends ResolvedCadAppearance {
  sourceColor: string;
  opacity: number;
}

function normalizedHex(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/iu.test(color)) return color.toLowerCase();
  throw new TypeError(`Unsupported CAD colour: ${color}`);
}

export function aciColor(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 255) throw new TypeError("ACI index must be an integer from 1 to 255.");
  return AUTOCAD_2024_ACI_PALETTE[index - 1]!;
}

export function nearestAciIndex(color: string): number {
  const normalized = normalizedHex(color);
  // AutoCAD ACI 7 is the adaptive foreground colour: white on the dark model
  // canvas and black on white paper. It is therefore the indexed equivalent
  // for both explicit black and explicit white, not one of the fixed greys.
  if (normalized === "#000000" || normalized === "#ffffff") return 7;
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  let best = 7;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index <= AUTOCAD_2024_ACI_PALETTE.length; index += 1) {
    const candidate = [1, 3, 5].map((offset) => Number.parseInt(AUTOCAD_2024_ACI_PALETTE[index - 1]!.slice(offset, offset + 2), 16));
    const current = rgb.reduce((sum, channel, position) => sum + (channel - candidate[position]!) ** 2, 0);
    if (current < distance) { distance = current; best = index; }
  }
  return best;
}

export function assertCadAppearance(appearance: CadAppearance | undefined, label = "CAD appearance"): void {
  if (!appearance) return;
  if (appearance.color !== undefined) normalizedHex(appearance.color);
  if (appearance.colorMethod !== undefined && appearance.colorMethod !== "aci" && appearance.colorMethod !== "trueColor") {
    throw new TypeError(`${label} has an unsupported color method.`);
  }
  if (appearance.aciIndex !== undefined && (!Number.isInteger(appearance.aciIndex) || appearance.aciIndex < 1 || appearance.aciIndex > 255)) {
    throw new TypeError(`${label} ACI index must be an integer from 1 to 255.`);
  }
  if ((appearance.aciIndex !== undefined || appearance.colorMethod !== undefined) && appearance.color === undefined) {
    throw new TypeError(`${label} ACI/color-method metadata requires an RGB render color.`);
  }
  if (appearance.linetypeId !== undefined && (typeof appearance.linetypeId !== "string" || appearance.linetypeId.length === 0)) {
    throw new TypeError(`${label} linetype ID must be a non-empty string.`);
  }
  if (appearance.linetypeScale !== undefined && (!Number.isFinite(appearance.linetypeScale) || appearance.linetypeScale <= 0)) {
    throw new TypeError(`${label} linetype scale must be finite and greater than zero.`);
  }
  if (appearance.lineweightMm !== undefined && (!Number.isFinite(appearance.lineweightMm) || appearance.lineweightMm < 0)) {
    throw new TypeError(`${label} lineweight must be finite and non-negative.`);
  }
  if (appearance.transparency !== undefined && (!Number.isFinite(appearance.transparency) || appearance.transparency < 0 || appearance.transparency > 90)) {
    throw new TypeError(`${label} transparency must be a percentage from 0 to 90.`);
  }
  if (appearance.thickness !== undefined && !Number.isFinite(appearance.thickness)) {
    throw new TypeError(`${label} thickness must be finite.`);
  }
  for (const [name, value] of [["plot style", appearance.plotStyleId], ["material", appearance.materialId]] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      throw new TypeError(`${label} ${name} ID must be a non-empty string.`);
    }
  }
}

export function resolvePlotStyle(style?: CadPlotStyle): CadPlotStyle {
  const resolved = structuredClone(style ?? DEFAULT_PLOT_STYLE);
  if (!["color", "monochrome", "grayscale"].includes(resolved.profile)) {
    throw new TypeError(`Unsupported plot profile: ${String(resolved.profile)}`);
  }
  if (typeof resolved.plotLineweights !== "boolean" || typeof resolved.plotTransparency !== "boolean") {
    throw new TypeError("Plot lineweight and transparency flags must be boolean.");
  }
  return resolved;
}

export function plotColor(
  color: string,
  profile: CadPlotStyle["profile"],
  colorMethod: ResolvedCadAppearance["colorMethod"] = "aci",
  aciIndex?: number,
): string {
  const normalized = normalizedHex(color);
  // Stock CTB tables map indexed ACI colours. AutoCAD plots TrueColor values
  // with their source RGB unless a named plot style explicitly overrides them.
  if (profile === "color" || colorMethod === "trueColor") {
    return colorMethod === "aci" && aciIndex === 7 ? "#000000" : normalized;
  }
  if (profile === "monochrome") return "#000000";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  // AutoCAD's stock Grayscale.ctb follows the classic 29.9/58.7/11.4 luma mapping.
  const gray = Math.floor(red * 0.299 + green * 0.587 + blue * 0.114);
  const channel = gray.toString(16).padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}

export function resolveCadAppearance(
  entity: Pick<CadEntity, "layerId" | "appearance">,
  layers: readonly CadLayer[],
): ResolvedCadAppearance {
  const layer = layers.find((candidate) => candidate.id === entity.layerId);
  if (!layer) throw new RangeError(`Layer not found for plot style: ${entity.layerId}`);
  assertCadAppearance(entity.appearance, "Entity appearance");
  assertCadAppearance(layer.appearance, "Layer appearance");
  const hasEntityColor = entity.appearance?.color !== undefined;
  const declaredColor = normalizedHex(entity.appearance?.color ?? layer.appearance?.color ?? "#000000");
  const colorMethod = hasEntityColor
    ? entity.appearance?.colorMethod ?? "aci"
    : layer.appearance?.colorMethod ?? "aci";
  const declaredAciIndex = hasEntityColor
    ? entity.appearance?.aciIndex
    : layer.appearance?.aciIndex;
  const aciIndex = colorMethod === "aci" ? declaredAciIndex ?? nearestAciIndex(declaredColor) : declaredAciIndex;
  const color = colorMethod === "aci" ? aciColor(aciIndex!) : declaredColor;
  const lineweightMm = entity.appearance?.lineweightMm ?? layer.appearance?.lineweightMm ?? 0.25;
  const transparencyPercent = entity.appearance?.transparency ?? layer.appearance?.transparency ?? 0;
  if (!Number.isFinite(lineweightMm) || lineweightMm < 0) throw new TypeError("CAD lineweight must be finite and non-negative.");
  if (!Number.isFinite(transparencyPercent) || transparencyPercent < 0 || transparencyPercent > 90) {
    throw new TypeError("CAD transparency must be a percentage from 0 to 90.");
  }
  return { color, colorMethod, ...(aciIndex === undefined ? {} : { aciIndex }), lineweightMm, transparencyPercent };
}

export function resolveEntityPlotAppearance(
  entity: Pick<CadEntity, "layerId" | "appearance">,
  layers: readonly CadLayer[],
  style?: CadPlotStyle,
): ResolvedPlotAppearance {
  const source = resolveCadAppearance(entity, layers);
  const plotStyle = resolvePlotStyle(style);
  // PDF line width 0 is AutoCAD's device-space hairline when plotted
  // lineweights are disabled; preserve an explicit 0.00 mm value as well.
  const physicalLineweight = plotStyle.plotLineweights ? source.lineweightMm : 0;
  return {
    sourceColor: source.color,
    color: plotColor(source.color, plotStyle.profile, source.colorMethod, source.aciIndex),
    colorMethod: source.colorMethod,
    ...(source.aciIndex === undefined ? {} : { aciIndex: source.aciIndex }),
    lineweightMm: physicalLineweight,
    transparencyPercent: source.transparencyPercent,
    opacity: plotStyle.plotTransparency ? Number((1 - source.transparencyPercent / 100).toFixed(12)) : 1,
  };
}
