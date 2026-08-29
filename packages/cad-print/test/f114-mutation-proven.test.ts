import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createF114Document, F114_LAYOUT_IDS } from "../../../parity/fixtures/f114-document.js";
import { evaluateF114KuubikPdf } from "../../../tools/parity/f114-evidence-contract.mjs";
import { injectReferencedImageXObject } from "../../../tools/parity/f114-pdf-mutants.mjs";
import { exportLayoutsVectorPdf } from "../src/index.js";

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

it("F-114 independent contract rejects valid raster, page-order, geometry and alpha mutants", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const source = createF114Document();
  const baseline = exportLayoutsVectorPdf(source, F114_LAYOUT_IDS).bytes;
  const reversed = exportLayoutsVectorPdf(source, [...F114_LAYOUT_IDS].reverse()).bytes;
  const geometry = structuredClone(source);
  const line = geometry.entities.find((entity) => entity.handle === "10");
  if (!line || line.kind !== "line") throw new Error("F-114 line fixture is missing.");
  line.end.x += 500;
  const changedGeometry = exportLayoutsVectorPdf(geometry, F114_LAYOUT_IDS).bytes;
  const alpha = structuredClone(source);
  const alphaLine = alpha.entities.find((entity) => entity.handle === "10");
  if (!alphaLine || alphaLine.kind !== "line") throw new Error("F-114 alpha fixture is missing.");
  alphaLine.appearance = { ...alphaLine.appearance, transparency: 75 };
  const changedAlpha = exportLayoutsVectorPdf(alpha, F114_LAYOUT_IDS).bytes;
  const rasterMutation = injectReferencedImageXObject(baseline);
  const mutants = { order: reversed, geometry: changedGeometry, alpha: changedAlpha, raster: rasterMutation };
  const directory = mkdtempSync(join(tmpdir(), "kuubik-f114-mutation-test-"));
  try {
    const argumentsList: string[] = [];
    const baselinePath = join(directory, "baseline.pdf");
    writeFileSync(baselinePath, baseline);
    argumentsList.push(`baseline=${baselinePath}`);
    for (const [key, bytes] of Object.entries(mutants)) {
      const path = join(directory, `${key}.pdf`);
      writeFileSync(path, bytes);
      argumentsList.push(`${key}=${path}`);
    }
    const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
    const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
    const readback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f114-pdf.py"), ...argumentsList], { encoding: "utf8", windowsHide: true }));
    const expected = JSON.parse(readFileSync(resolve(root, "parity/expected/F-114.json"), "utf8"));
    expect(evaluateF114KuubikPdf(readback.documents.baseline, null, expected)).toEqual({ pass: true, reasons: [] });
    const evaluations = Object.fromEntries(Object.keys(mutants).map((key) => [key, evaluateF114KuubikPdf(readback.documents[key], null, expected)]));
    expect(Object.values(evaluations).every((result) => result.pass === false)).toBe(true);
    expect(evaluations.order.reasons).toContain("page-1-size");
    expect(evaluations.geometry.reasons).toContain("model-line-geometry-alpha");
    expect(evaluations.alpha.reasons).toContain("extgstate-alpha");
    expect(evaluations.raster.reasons).toContain("page-1-raster");
    expect(readback.documents.raster.strictParsed).toBe(true);
    expect(readback.documents.raster.pageDetails[0].imageXObjects).toBe(1);
    for (const bytes of Object.values(mutants)) expect(sha256(bytes)).not.toBe(sha256(baseline));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
