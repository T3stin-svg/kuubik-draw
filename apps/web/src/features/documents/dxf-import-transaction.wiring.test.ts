import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./dxf-import-transaction.ts", import.meta.url), "utf8");

describe("F-110 DXFIN production wiring", () => {
  it("parses and rejects unsupported records before the durable commit", () => {
    expect(source.indexOf("const imported = importDxf(input.bytes")).toBeGreaterThan(0);
    expect(source.indexOf("imported.report.skipped.length > 0")).toBeGreaterThan(source.indexOf("const imported = importDxf(input.bytes"));
    expect(source.indexOf("const document = await live.commit")).toBeGreaterThan(source.indexOf("imported.report.skipped.length > 0"));
  });

  it("uses layout-preserving atomic replacement and parser read-back after persistence", () => {
    expect(source).toContain("replaceDrawingContentPreservingLayouts(before, imported.document)");
    expect(source.indexOf("const exported = exportDxf(document)")).toBeGreaterThan(source.indexOf("const document = await live.commit"));
    expect(source.indexOf("const roundTrip = importDxf(exported.bytes")).toBeGreaterThan(source.indexOf("const exported = exportDxf(document)"));
    expect(source.indexOf("const persisted = live.document(input.documentId)")).toBeGreaterThan(source.indexOf("const roundTrip = importDxf(exported.bytes"));
  });
});
