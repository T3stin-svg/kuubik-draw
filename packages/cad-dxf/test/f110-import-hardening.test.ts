import { describe, expect, it } from "vitest";
import { createF110Document } from "./f110-fixture.js";
import { exportDxf, importDxf } from "../src/index.js";

function mutateRecord(source: string, handle: string, from: string, to: string): string {
  const handleIndex = source.indexOf(`\r\n  5\r\n${handle}\r\n`);
  if (handleIndex < 0) throw new Error(`Missing DXF handle ${handle}.`);
  const start = source.lastIndexOf("\r\n  0\r\n", handleIndex);
  const end = source.indexOf("\r\n  0\r\n", handleIndex + 1);
  const record = source.slice(start, end);
  const mutated = record.replace(from, to);
  if (mutated === record) throw new Error(`Missing mutation token in ${handle}.`);
  return source.slice(0, start) + mutated + source.slice(end);
}

describe("F-110 DXF import mutation and fuzz hardening", () => {
  it("kills malformed entity, table, block and unit mutants without returning a document", () => {
    const source = exportDxf(createF110Document()).text;
    const mutants: Array<[string, string, RegExp]> = [
      ["unit", source.replace("$INSUNITS\r\n 70\r\n4", "$INSUNITS\r\n 70\r\n99"), /INSUNITS 99/u],
      ["block-end", source.replace("  0\r\nENDBLK\r\n", "  0\r\nNOTENDBLK\r\n"), /missing ENDBLK/u],
      ["duplicate-block", source.replace("  2\r\nSYMBOL\r\n 70\r\n0", "  2\r\n*Model_Space\r\n 70\r\n0"), /duplicate block name/u],
      ["ellipse-ratio", source.replace(" 40\r\n0.4\r\n 41\r\n0", " 40\r\n0\r\n 41\r\n0"), /ratio/u],
      ["mtext-attachment", source.replace(" 71\r\n5\r\n  1\r\nRida", " 71\r\n10\r\n  1\r\nRida"), /attachment/u],
      ["insert-array", source.replace(" 41\r\n2\r\n 42\r\n0.5", " 70\r\n2\r\n 41\r\n2\r\n 42\r\n0.5"), /MINSERT arrays/u],
      ["duplicate-handle", source.replace("  5\r\nB0\r\n", "  5\r\nA0\r\n"), /duplicate global handle A0/u],
      ["nul", source.replace("GEOMETRY", "GEO\0METRY"), /NUL byte/u],
      ["unpaired", `${source}999\r\n`, /unpaired group-code line/u],
      ["bad-code", source.replace("  0\r\nSECTION", "BAD\r\nSECTION"), /Invalid DXF group code/u],
    ];
    for (const [name, mutant, expected] of mutants) {
      expect(() => importDxf(mutant, { documentId: `mutant-${name}` }), name).toThrow(expected);
    }
  });

  it("rejects a deterministic numeric-token fuzz corpus fail-closed", () => {
    const source = exportDxf(createF110Document()).text;
    const replacements: Array<[string, string, string]> = [
      ["10", " 10\r\n0\r\n 20\r\n0", " 10\r\nNaN\r\n 20\r\n0"],
      ["60", " 71\r\n2\r\n 72\r\n6", " 71\r\n17\r\n 72\r\n6"],
      ["60", " 72\r\n6\r\n 73\r\n3", " 72\r\n999\r\n 73\r\n3"],
      ["20", " 90\r\n3\r\n 70\r\n1", " 90\r\n50001\r\n 70\r\n1"],
      ["80", " 41\r\n60\r\n 71\r\n5", " 41\r\n-1\r\n 71\r\n5"],
    ];
    for (const [index, [handle, from, to]] of replacements.entries()) {
      const mutant = mutateRecord(source, handle, from, to);
      expect(() => importDxf(mutant, { documentId: `fuzz-${index}` }), `fuzz token ${index} must fail closed`).toThrow();
    }
  });

  it("imports 50,000 editable LINE entities inside the explicit performance budget", { timeout: 20_000 }, () => {
    const document = createF110Document("F-110-50k");
    document.blocks = [];
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const,
      handle: (0x1000 + index).toString(16).toUpperCase(),
      layerId: "geometry",
      start: { x: index, y: index % 1_000 },
      end: { x: index + 1, y: index % 1_000 },
    }));
    const bytes = exportDxf(document).bytes;
    const started = performance.now();
    const imported = importDxf(bytes, { documentId: "F-110-50k-readback" });
    const elapsedMs = performance.now() - started;
    expect(imported.document.entities).toHaveLength(50_000);
    expect(imported.report.importedHandles).toHaveLength(50_000);
    expect(imported.report.skipped).toEqual([]);
    expect(elapsedMs).toBeLessThan(8_000);
  });
});
