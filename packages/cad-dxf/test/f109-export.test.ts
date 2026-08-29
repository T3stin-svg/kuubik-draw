import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { createF109Document } from "../../../parity/fixtures/f109-document.js";
import { exportDxf, readDxfSummary } from "../src/index.js";

describe("F-109 core DXF export", () => {
  it("emits the exact 40-entity core geometry manifest with units and native tables", () => {
    const output = exportDxf(createF109Document());
    expect(output.report.skipped).toEqual([]);
    expect(output.report.emittedHandles).toHaveLength(40);
    expect(readDxfSummary(output.text)).toMatchObject({
      acadVersion: "AC1018",
      entityTypes: { LINE: 12, LWPOLYLINE: 9, TEXT: 10, HATCH: 7, CIRCLE: 1, DIMENSION: 1 },
    });
    expect(output.text).toContain("\r\n$INSUNITS\r\n 70\r\n4\r\n");
    for (const name of ["JOONED", "TELJED", "SEINAD", "VIIRUTUS", "DASHED", "DASHDOT", "NORMAL", "Standard"]) {
      expect(output.text).toContain(`\r\n${name}\r\n`);
    }
  });

  it("writes DIMENSION subclass markers before points and preserves two bulged polylines", () => {
    const text = exportDxf(createF109Document()).text;
    const dimension = text.slice(text.indexOf("\r\nDIMENSION\r\n"));
    const subclass = dimension.indexOf("\r\nAcDbAlignedDimension\r\n");
    expect(subclass).toBeGreaterThan(0);
    expect(dimension.indexOf("\r\n 13\r\n")).toBeGreaterThan(subclass);
    expect(dimension).not.toContain("\r\n 50\r\n");
    const parsed = new DxfParser().parseSync(text)!;
    expect(parsed.entities.filter((entity) => entity.type === "LWPOLYLINE" && Array.isArray((entity as { vertices?: unknown[] }).vertices) && (entity as { vertices: Array<{ bulge?: number }> }).vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-9))).toHaveLength(2);
  });

  it("emits ByLayer plus explicit entity overrides without mutating the source document", () => {
    const document = createF109Document();
    document.entities[0]!.appearance = { color: "#ff0000", colorMethod: "aci", lineweightMm: 0.7, linetypeId: "dashed" };
    const snapshot = structuredClone(document);
    const text = exportDxf(document).text;
    const record = text.slice(text.indexOf("\r\nLINE\r\n"), text.indexOf("\r\nLINE\r\n") + 300);
    expect(record).toContain("\r\n 62\r\n1\r\n");
    expect(record).toContain("\r\n370\r\n70\r\n");
    expect(record).toContain("\r\n  6\r\nDASHED\r\n");
    expect(document).toEqual(snapshot);
  });

  it("preserves exact equal-RGB ACI indices and a TrueColor fallback index", () => {
    const first = createF109Document();
    first.entities[0]!.appearance = { color: "#ff0000", colorMethod: "aci", aciIndex: 1 };
    const second = createF109Document();
    second.entities[0]!.appearance = { color: "#ff0000", colorMethod: "aci", aciIndex: 10 };
    const firstRecord = entityRecord(exportDxf(first).text, "1000");
    const secondRecord = entityRecord(exportDxf(second).text, "1000");
    expect(firstRecord).toContain("\r\n 62\r\n1\r\n");
    expect(secondRecord).toContain("\r\n 62\r\n10\r\n");
    expect(entityRecord(exportDxf(createF109Document()).text, "1001")).toContain("\r\n 62\r\n152\r\n420\r\n681180\r\n");
    const invalid = createF109Document();
    invalid.entities[0]!.appearance = { aciIndex: 10 };
    expect(() => exportDxf(invalid)).toThrow(/requires an RGB color/u);
  });

  it("keeps ACI authoritative over a mismatched RGB fallback", () => {
    const document = createF109Document();
    document.entities[0]!.appearance = { color: "#00ff00", colorMethod: "aci", aciIndex: 1 };
    const record = entityRecord(exportDxf(document).text, "1000");
    expect(record).toContain("\r\n 62\r\n1\r\n");
    expect(record).not.toContain("\r\n420\r\n");
  });

  it("rejects the entire HATCH when any boundary loop is invalid", () => {
    const document = createF109Document();
    const hatch = document.entities.find((entity) => entity.kind === "hatch");
    if (!hatch || hatch.kind !== "hatch") throw new Error("F-109 hatch fixture is missing.");
    hatch.loops.push({ isHole: true, vertices: [{ x: 5220, y: 3020 }, { x: 5240, y: 3020 }] });
    expect(() => exportDxf(document)).toThrow(/requires every boundary loop to contain at least three vertices/u);
  });

  it("allocates globally unique 64-bit handles across large tables and dimension blocks", () => {
    const document = createF109Document();
    document.linetypes.push(...Array.from({ length: 254 }, (_, index) => ({ id: `stress-lt-${index}`, name: `STRESS_LT_${index}`, pattern: [10, -5] })));
    document.layers.push(...Array.from({ length: 257 }, (_, index) => ({ id: `stress-layer-${index}`, name: `STRESS_LAYER_${index}`, visible: true, frozen: false, locked: false, plottable: true })));
    document.textStyles.push(...Array.from({ length: 257 }, (_, index) => ({ id: `stress-style-${index}`, name: `STRESS_STYLE_${index}`, fontFamily: "txt", widthFactor: 1, obliqueAngleRad: 0 })));
    document.dimensionStyles.push(...Array.from({ length: 257 }, (_, index) => ({ id: `stress-dim-${index}`, name: `STRESS_DIM_${index}`, textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 })));
    document.entities[0]!.handle = "ABCDEF0123456789";
    document.entities.push(...Array.from({ length: 140 }, (_, index) => ({
      kind: "dimension" as const, handle: `stress-dimension-${index}`, layerId: "lines", dimensionKind: "aligned" as const,
      definitionPoints: [{ x: 0, y: index * 10 }, { x: 100, y: index * 10 }, { x: 50, y: index * 10 + 10 }, { x: 50, y: index * 10 + 20 }], styleId: "dim-standard",
    })));
    const output = exportDxf(document);
    const handles = objectHandles(output.text);
    expect(new Set(handles).size).toBe(handles.length);
    expect(output.report.handleMap.ABCDEF0123456789).toBe("ABCDEF0123456789");
    const handseed = headerValue(output.text, "$HANDSEED");
    const maximum = handles.reduce((value, handle) => BigInt(`0x${handle}`) > value ? BigInt(`0x${handle}`) : value, 0n);
    expect(BigInt(`0x${handseed}`)).toBe(maximum + 1n);
  });

  it("allocates safe handles for prototype-shaped stable IDs", () => {
    const document = createF109Document();
    const sourceHandles = ["__proto__", "constructor", "toString"];
    sourceHandles.forEach((handle, index) => { document.entities[index]!.handle = handle; });
    const output = exportDxf(document);
    expect(output.text).not.toContain("[object Object]");
    for (const sourceHandle of sourceHandles) {
      expect(Object.hasOwn(output.report.handleMap, sourceHandle)).toBe(true);
      expect(output.report.handleMap[sourceHandle]).toMatch(/^[1-9A-F][0-9A-F]{0,15}$/u);
    }
    expect(new Set(Object.values(output.report.handleMap)).size).toBe(document.entities.length);
  });

  it("exports and summarizes 50,000 simple entities without spread or handle-range failure", () => {
    const document = createF109Document();
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const,
      handle: (0x1000 + index).toString(16).toUpperCase(),
      layerId: "lines",
      start: { x: index, y: index % 1_000 },
      end: { x: index + 1, y: index % 1_000 },
    }));
    const output = exportDxf(document);
    const summary = readDxfSummary(output.text);
    expect(output.report.skipped).toEqual([]);
    expect(output.report.emittedHandles).toHaveLength(50_000);
    expect(summary.entityTypes).toEqual({ LINE: 50_000 });
    expect(summary.extents).toEqual({ minX: 0, minY: 0, maxX: 50_000, maxY: 999 });
  });

  it("owns canonical ANSI_1252 bytes and preserves the Estonian text, TrueColor, transparency and DIMTXSTY references", () => {
    const output = exportDxf(createF109Document());
    expect(output.bytes).toEqual(encodeWindows1252ForTest(output.text));
    expect(output.text).toContain("M\\U+00D5\\U+00D5T \\U+0160\\U+017D\\U+20AC 10");
    expect(Math.max(...output.bytes)).toBeLessThan(0x80);
    expect(output.text).toContain("420\r\n681180\r\n");
    expect(output.text).toContain("1001\r\nAcCmTransparency\r\n1071\r\n33554636\r\n");
    expect(output.text).toContain("440\r\n33554585\r\n");
    expect(output.text).toContain("340\r\n401\r\n");
    expect(output.text).not.toContain("\r\n$EXTMIN\r\n");
    expect(output.text).not.toContain("\r\n$EXTMAX\r\n");
    const unicode = createF109Document();
    const text = unicode.entities.find((entity) => entity.kind === "text");
    if (!text || text.kind !== "text") throw new Error("F-109 text fixture is missing.");
    text.text = "😀";
    expect(exportDxf(unicode).text).toContain("\\U+D83D\\U+DE00");
  });
});

function entityRecord(text: string, handle: string): string {
  const marker = `\r\n  5\r\n${handle}\r\n`;
  const handleIndex = text.indexOf(marker);
  const start = text.lastIndexOf("\r\n  0\r\n", handleIndex);
  const end = text.indexOf("\r\n  0\r\n", handleIndex + marker.length);
  return text.slice(start, end < 0 ? undefined : end);
}

function dxfPairs(text: string): Array<[number, string]> {
  const lines = text.replaceAll("\r", "").split("\n");
  const pairs: Array<[number, string]> = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index]!.trim(), 10);
    if (Number.isInteger(code)) pairs.push([code, lines[index + 1]!]);
  }
  return pairs;
}

function objectHandles(text: string): string[] {
  const result: string[] = [];
  let insideRecord = false;
  for (const [code, value] of dxfPairs(text)) {
    if (code === 0) insideRecord = !["SECTION", "ENDSEC", "TABLE", "ENDTAB", "EOF"].includes(value);
    else if (insideRecord && (code === 5 || code === 105)) { result.push(value); insideRecord = false; }
  }
  return result;
}

function headerValue(text: string, name: string): string {
  const pairs = dxfPairs(text);
  const index = pairs.findIndex(([code, value]) => code === 9 && value === name);
  if (index < 0 || pairs[index + 1]?.[0] !== 5) throw new Error(`Missing ${name}.`);
  return pairs[index + 1]![1];
}

function encodeWindows1252ForTest(value: string): Uint8Array {
  const special = new Map([[0x20ac, 0x80], [0x0160, 0x8a], [0x017d, 0x8e]]);
  return Uint8Array.from([...value].map((character) => {
    const code = character.codePointAt(0)!;
    return special.get(code) ?? code;
  }));
}
