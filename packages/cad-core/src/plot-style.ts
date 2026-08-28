import type { CadEntity, CadLayer, CadPlotStyle } from "@kuubik/cad-schema";

export const DEFAULT_PLOT_STYLE: Readonly<CadPlotStyle> = Object.freeze({
  profile: "monochrome",
  plotLineweights: true,
  plotTransparency: true,
});

export interface ResolvedCadAppearance {
  color: string;
  colorMethod: "aci" | "trueColor";
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
): string {
  const normalized = normalizedHex(color);
  // Stock CTB tables map indexed ACI colours. AutoCAD plots TrueColor values
  // with their source RGB unless a named plot style explicitly overrides them.
  if (profile === "color" || colorMethod === "trueColor") return normalized;
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
  const hasEntityColor = entity.appearance?.color !== undefined;
  const color = normalizedHex(entity.appearance?.color ?? layer.appearance?.color ?? "#000000");
  const colorMethod = hasEntityColor
    ? entity.appearance?.colorMethod ?? "aci"
    : layer.appearance?.colorMethod ?? "aci";
  const lineweightMm = entity.appearance?.lineweightMm ?? layer.appearance?.lineweightMm ?? 0.25;
  const transparencyPercent = entity.appearance?.transparency ?? layer.appearance?.transparency ?? 0;
  if (!Number.isFinite(lineweightMm) || lineweightMm < 0) throw new TypeError("CAD lineweight must be finite and non-negative.");
  if (!Number.isFinite(transparencyPercent) || transparencyPercent < 0 || transparencyPercent > 90) {
    throw new TypeError("CAD transparency must be a percentage from 0 to 90.");
  }
  return { color, colorMethod, lineweightMm, transparencyPercent };
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
    color: plotColor(source.color, plotStyle.profile, source.colorMethod),
    colorMethod: source.colorMethod,
    lineweightMm: physicalLineweight,
    transparencyPercent: source.transparencyPercent,
    opacity: plotStyle.plotTransparency ? Number((1 - source.transparencyPercent / 100).toFixed(12)) : 1,
  };
}
