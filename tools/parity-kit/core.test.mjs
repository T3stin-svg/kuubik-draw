import { describe, expect, it } from "vitest";
import { affectedRows, canonicalJson, exactContentAddress, executableStages, inferredRowIds, semanticContentAddress, semanticValue, sourceContentAddress, sourceToRows, staleEvidenceBindings } from "./core.mjs";

describe("parity kit", () => {
  it("gives timestamp-only JSON reruns the same semantic content address", () => {
    const first = Buffer.from(JSON.stringify({ status: "PASS", observedAt: "2026-01-01T00:00:00Z", artifactSha256: "a".repeat(64), geometry: { x: 5, y: 7 } }));
    const second = Buffer.from(JSON.stringify({ geometry: { y: 7, x: 5 }, artifactSha256: "b".repeat(64), observedAt: "2027-02-03T04:05:06Z", status: "PASS" }));
    expect(semanticContentAddress(first, "evidence.json")).toBe(semanticContentAddress(second, "evidence.json"));
  });

  it("retains material semantic hashes while ignoring only known provenance hashes", () => {
    const first = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "a".repeat(64) }, sourceSha256: { app: "b".repeat(64) } }));
    const sourceOnly = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "a".repeat(64) }, sourceSha256: { app: "c".repeat(64) } }));
    const semanticChange = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "d".repeat(64) }, sourceSha256: { app: "b".repeat(64) } }));
    expect(semanticContentAddress(first, "evidence.json")).toBe(semanticContentAddress(sourceOnly, "evidence.json"));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(semanticChange, "evidence.json"));
  });

  it("retains result and geometry fields whose names merely resemble timestamps", () => {
    const first = Buffer.from(JSON.stringify({ created: ["10"], a3TitleAt: [25, 40], generatedAt: "2026-01-01T00:00:00Z" }));
    const changedResult = Buffer.from(JSON.stringify({ created: ["11"], a3TitleAt: [25, 40], generatedAt: "2027-01-01T00:00:00Z" }));
    const changedPosition = Buffer.from(JSON.stringify({ created: ["10"], a3TitleAt: [26, 40], generatedAt: "2027-01-01T00:00:00Z" }));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(changedResult, "evidence.json"));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(changedPosition, "evidence.json"));
  });

  it("gives KDRAW1 containers with timestamp-only document changes the same semantic address", () => {
    const container = (updatedAt) => Buffer.from(`KDRAW1\n${JSON.stringify({
      manifest: { entries: [{ path: "document.json", sha256: updatedAt }] },
      files: {
        "document.json": Buffer.from(JSON.stringify({ schemaVersion: 1, metadata: { updatedAt }, entities: [{ handle: "10", kind: "line" }] })).toString("base64"),
      },
    })}`);
    const first = container("2026-01-01T00:00:00.000Z");
    const second = container("2027-02-03T04:05:06.000Z");
    expect(semanticContentAddress(first, "drawing.kdraw")).toBe(semanticContentAddress(second, "drawing.kdraw"));
  });

  it("changes the semantic address when measured content changes", () => {
    const first = Buffer.from(JSON.stringify({ geometry: { x: 5, y: 7 } }));
    const second = Buffer.from(JSON.stringify({ geometry: { x: 6, y: 7 } }));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(second, "evidence.json"));
  });

  it("gives LF and CRLF source files the same content address", () => {
    expect(sourceContentAddress(Buffer.from("const value = 1;\nexport { value };\n")))
      .toBe(sourceContentAddress(Buffer.from("const value = 1;\r\nexport { value };\r\n")));
  });

  it("gives LF and CRLF exact JSON evidence the same repository address", () => {
    expect(exactContentAddress(Buffer.from('{\n  "status": "PASS"\n}\n'), "evidence.json"))
      .toBe(exactContentAddress(Buffer.from('{\r\n  "status": "PASS"\r\n}\r\n'), "evidence.json"));
    expect(exactContentAddress(Buffer.from("A\n"), "drawing.dxf"))
      .not.toBe(exactContentAddress(Buffer.from("A\r\n"), "drawing.dxf"));
  });

  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: [2, 1] })).toBe('{"a":[2,1],"b":2}');
    expect(canonicalJson({ "ä": 4, z: 3, a: 2, A: 1 })).toBe('{"A":1,"a":2,"z":3,"ä":4}');
    expect(semanticValue({ generatedAt: "now", value: 1 })).toEqual({ value: 1 });
  });

  it("maps TRIM-only sources to F-022 and shared package changes to every certified row", () => {
    expect(affectedRows(["packages/cad-core/src/trim.ts"]).rows).toEqual(["F-022"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).toEqual(["F-015", "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).not.toContain("F-114");
    expect(affectedRows(["package-lock.json"]).rows).toHaveLength(23);
    expect(sourceToRows().get("packages/cad-core/src/trim.ts")).toEqual(["F-022"]);
  });

  it("fails closed for a new unmapped runtime source", () => {
    expect(affectedRows(["apps/web/src/workflows/new-command.ts"]).unmappedRuntime).toEqual(["apps/web/src/workflows/new-command.ts"]);
  });

  it("maps row-specific E2E, checker and AutoCAD fixture sources", () => {
    expect(affectedRows(["tools/parity/run-f114-readback.mjs"]).rows).toEqual(["F-114"]);
    expect(affectedRows(["e2e/f022-trim.spec.ts"]).rows).toEqual(["F-022"]);
    expect(affectedRows(["tools/autocad/f102-page-setup.ps1"]).rows).toEqual(["F-102"]);
    expect(inferredRowIds("tools/parity/check-f020-f021-runner-evidence.mjs")).toEqual(["F-020", "F-021"]);
    expect(affectedRows(["tools/parity/new-shared-checker.mjs"]).unmappedRuntime).toEqual(["tools/parity/new-shared-checker.mjs"]);
  });

  it("refuses to rebind changed sources to unchanged browser or readback evidence", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { cross: { sha256: "cross-receipt" } };
    const previous = { schemaVersion: 3, rows: [{ rowId: "F-023", sources: { "src.ts": "old" }, evidence, receipts }] };
    const stale = { schemaVersion: 3, rows: [{ rowId: "F-023", sources: { "src.ts": "new" }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, stale)).toEqual([
      "F-023: source changed without refreshed autocad evidence.",
      "F-023: source changed without refreshed browser evidence.",
      "F-023: source changed without refreshed readback evidence.",
      "F-023: source changed without refreshed cross stage receipt.",
    ]);
    const refreshed = structuredClone(stale);
    refreshed.rows[0].evidence.autocad.artifactSha256 = "new-autocad-artifact";
    refreshed.rows[0].evidence.browser.descriptorSha256 = "new-browser-descriptor";
    refreshed.rows[0].evidence.readback.artifactSha256 = "new-readback-artifact";
    refreshed.rows[0].receipts.cross.sha256 = "new-cross-receipt";
    expect(staleEvidenceBindings(previous, refreshed)).toEqual([]);
  });

  it("orchestrates a synthetic row without requiring a copied cross checker", () => {
    const row = {
      id: "F-023",
      stages: {
        browser: "parity:f023:browser-artifact",
        readback: "parity:f023:readback",
        autocad: "parity:f023:autocad",
      },
    };
    expect(executableStages(row).map(({ stage }) => stage)).toEqual(["browser", "readback", "autocad"]);
    expect(executableStages(row, { portable: true }).map(({ stage }) => stage)).toEqual(["browser", "readback"]);
  });
});
