import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CadEntity, CadLayer } from "@kuubik/cad-schema";
import { AUTOCAD_2024_ACI_PALETTE, aciColor, plotColor, resolveCadAppearance, resolveEntityPlotAppearance, resolvePlotStyle } from "../src/index.js";

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
    expect(resolveCadAppearance(byLayer, layers)).toEqual({ color: "#00ff00", colorMethod: "aci", aciIndex: 3, lineweightMm: 0.7, transparencyPercent: 40 });
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
      aciIndex: 1,
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

  it("keeps renderer/plot RGB and exact entity ACI precedence aligned", () => {
    const indexedLayers: CadLayer[] = [{
      ...layers[0]!,
      appearance: { color: "#00ffff", colorMethod: "aci", aciIndex: 4, lineweightMm: 0.7, transparency: 40 },
    }];
    for (const aciIndex of [1, 10]) {
      const entity = { ...byLayer, appearance: { color: "#ff0000", colorMethod: "aci" as const, aciIndex } };
      expect(resolveCadAppearance(entity, indexedLayers)).toMatchObject({ color: "#ff0000", colorMethod: "aci", aciIndex });
      expect(resolveEntityPlotAppearance(entity, indexedLayers, {
        profile: "color", plotLineweights: true, plotTransparency: true,
      })).toMatchObject({ sourceColor: "#ff0000", color: "#ff0000", colorMethod: "aci", aciIndex });
    }
    const trueColor = { ...byLayer, appearance: { color: "#0a64dc", colorMethod: "trueColor" as const, aciIndex: 152 } };
    expect(resolveEntityPlotAppearance(trueColor, indexedLayers, {
      profile: "monochrome", plotLineweights: true, plotTransparency: true,
    })).toMatchObject({ sourceColor: "#0a64dc", color: "#0a64dc", colorMethod: "trueColor", aciIndex: 152 });
    expect(() => resolveCadAppearance({ ...byLayer, appearance: { aciIndex: 10 } }, indexedLayers)).toThrow(/requires an RGB render color/u);
  });

  it("uses the AutoCAD 2024 ACI palette as authority for mismatched entity and layer RGB fallbacks", () => {
    expect(aciColor(1)).toBe("#ff0000");
    expect(aciColor(12)).toBe("#cc0000");
    expect(aciColor(251)).toBe("#5b5b5b");
    expect(aciColor(22)).toBe("#cc3300");
    expect(aciColor(62)).toBe("#99cc00");
    expect(AUTOCAD_2024_ACI_PALETTE).toHaveLength(255);
    expect(createHash("sha256").update(JSON.stringify(AUTOCAD_2024_ACI_PALETTE)).digest("hex")).toBe("5ff10c83691cd9934aecef90345b7435d4bbbc9e435a2853e9863cead6092d88");
    const mismatchedEntity = { ...byLayer, appearance: { color: "#00ff00", colorMethod: "aci" as const, aciIndex: 1 } };
    expect(resolveCadAppearance(mismatchedEntity, layers)).toMatchObject({ color: "#ff0000", colorMethod: "aci", aciIndex: 1 });
    const mismatchedLayer: CadLayer[] = [{ ...layers[0]!, appearance: { color: "#00ff00", colorMethod: "aci", aciIndex: 1 } }];
    expect(resolveEntityPlotAppearance(byLayer, mismatchedLayer, {
      profile: "color", plotLineweights: true, plotTransparency: true,
    })).toMatchObject({ sourceColor: "#ff0000", color: "#ff0000", colorMethod: "aci", aciIndex: 1 });
  });

  it("renders adaptive ACI 7 white on the dark canvas but black on paper", () => {
    const foreground = { ...byLayer, appearance: { color: "#000000", colorMethod: "aci" as const, aciIndex: 7 } };
    expect(resolveCadAppearance(foreground, layers)).toMatchObject({ color: "#ffffff", aciIndex: 7 });
    expect(resolveEntityPlotAppearance(foreground, layers, {
      profile: "color", plotLineweights: true, plotTransparency: true,
    })).toMatchObject({ sourceColor: "#ffffff", color: "#000000", aciIndex: 7 });
  });

  it("preserves an explicit 0.00 mm lineweight when plotted lineweights are enabled", () => {
    const explicit = { ...byLayer, appearance: { lineweightMm: 0 } };
    expect(resolveEntityPlotAppearance(explicit, layers, { profile: "color", plotLineweights: true, plotTransparency: true }).lineweightMm).toBe(0);
  });

  it("defaults old v1 page setups to monochrome with plotted weights and transparency", () => {
    expect(resolvePlotStyle()).toEqual({ profile: "monochrome", plotLineweights: true, plotTransparency: true });
  });
});
