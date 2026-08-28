import { describe, expect, it } from "vitest";
import type { CadEntity, CadLayer } from "@kuubik/cad-schema";
import { plotColor, resolveCadAppearance, resolveEntityPlotAppearance, resolvePlotStyle } from "../src/index.js";

const layers: CadLayer[] = [{
  id: "INK",
  name: "Ink",
  visible: true,
  frozen: false,
  locked: false,
  plottable: true,
  appearance: { color: "#0f0", lineweightMm: 0.7, transparency: 40 },
}];
const byLayer: CadEntity = { kind: "line", handle: "10", layerId: "INK", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };

describe("F-103 plot style resolver", () => {
  it("resolves ByLayer before applying color, monochrome and grayscale profiles", () => {
    expect(resolveCadAppearance(byLayer, layers)).toEqual({ color: "#00ff00", colorMethod: "aci", lineweightMm: 0.7, transparencyPercent: 40 });
    expect(resolveEntityPlotAppearance(byLayer, layers, { profile: "color", plotLineweights: true, plotTransparency: true })).toMatchObject({ color: "#00ff00", lineweightMm: 0.7, opacity: 0.6 });
    expect(resolveEntityPlotAppearance(byLayer, layers, { profile: "monochrome", plotLineweights: true, plotTransparency: false })).toMatchObject({ color: "#000000", lineweightMm: 0.7, opacity: 1 });
    expect(plotColor("#f00", "grayscale")).toBe("#4c4c4c");
  });

  it("honours entity overrides and uses AutoCAD PDF width zero when lineweights are disabled", () => {
    const explicit = { ...byLayer, appearance: { color: "#ff0000", lineweightMm: 0.35, transparency: 10 } };
    expect(resolveEntityPlotAppearance(explicit, layers, { profile: "color", plotLineweights: false, plotTransparency: true })).toEqual({
      sourceColor: "#ff0000",
      color: "#ff0000",
      colorMethod: "aci",
      lineweightMm: 0,
      transparencyPercent: 10,
      opacity: 0.9,
    });
  });

  it("preserves TrueColor through stock CTB profiles while ACI colours are remapped", () => {
    const trueColor = { ...byLayer, appearance: { color: "#0a64dc", colorMethod: "trueColor" as const } };
    expect(resolveEntityPlotAppearance(trueColor, layers, {
      profile: "monochrome", plotLineweights: true, plotTransparency: true,
    }).color).toBe("#0a64dc");
    expect(plotColor("#0a64dc", "grayscale", "trueColor")).toBe("#0a64dc");
    expect(plotColor("#0a64dc", "monochrome", "aci")).toBe("#000000");
  });

  it("preserves an explicit 0.00 mm lineweight when plotted lineweights are enabled", () => {
    const explicit = { ...byLayer, appearance: { lineweightMm: 0 } };
    expect(resolveEntityPlotAppearance(explicit, layers, { profile: "color", plotLineweights: true, plotTransparency: true }).lineweightMm).toBe(0);
  });

  it("defaults old v1 page setups to monochrome with plotted weights and transparency", () => {
    expect(resolvePlotStyle()).toEqual({ profile: "monochrome", plotLineweights: true, plotTransparency: true });
  });
});
