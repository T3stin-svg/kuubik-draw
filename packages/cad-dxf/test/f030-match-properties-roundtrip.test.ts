import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/index.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-030 MATCHPROP DXF appearance roundtrip", () => {
  it("preserves native group 48 linetype scale and signed group 39 thickness", () => {
    const document = createEmptyDocument({ documentId: "f030-dxf" });
    document.linetypes = [{ id: "hidden", name: "HIDDEN", description: "F-030", pattern: [5, -2] }];
    document.entities = [{
      kind: "line",
      handle: "30",
      layerId: "0",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      appearance: { linetypeId: "hidden", linetypeScale: 2.5, thickness: -3.25, lineweightMm: 0.5, transparency: 40 },
    }];
    const exported = exportDxf(document);
    expect(exported.text).toMatch(/\r?\n 48\r?\n2\.5\r?\n/u);
    expect(exported.text).toMatch(/\r?\n 39\r?\n-3\.25\r?\n/u);
    const imported = importDxf(exported.bytes, { documentId: "f030-readback" });
    expect(imported.document.entities).toHaveLength(1);
    expect(imported.document.entities[0]).toMatchObject({
      kind: "line", handle: "30", start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
      appearance: { linetypeScale: 2.5, thickness: -3.25, lineweightMm: 0.5, transparency: 40 },
    });
    const importedLinetypeId = imported.document.entities[0]!.appearance?.linetypeId;
    expect(imported.document.linetypes.find(({ id }) => id === importedLinetypeId)?.name).toBe("HIDDEN");
  });

  it("rejects invalid non-positive linetype scale instead of normalizing it", () => {
    const document = createEmptyDocument({ documentId: "f030-invalid" });
    document.entities = [{ kind: "line", handle: "30", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, appearance: { linetypeScale: 1 } }];
    const invalid = exportDxf(document).text.replace(/(\r?\n 48\r?\n)1(\r?\n)/u, (_match, before: string, after: string) => `${before}0${after}`);
    expect(() => importDxf(invalid, { documentId: "f030-reject" })).toThrow(/linetype scale must be greater than zero/u);
  });
});
