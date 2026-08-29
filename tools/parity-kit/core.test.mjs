import { describe, expect, it } from "vitest";
import { affectedRows, canonicalJson, exactContentAddress, executableStages, inferredRowIds, packageContractForRow, semanticContentAddress, semanticValue, sourceContentAddress, sourceToRows, staleEvidenceBindings } from "./core.mjs";

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

  it("maps shared trim/extend sources to F-022/F-023 and package locks to every certified row", () => {
    expect(affectedRows(["packages/cad-core/src/trim.ts"]).rows).toEqual(["F-022", "F-023"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).toEqual(["F-015", "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022", "F-023"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).not.toContain("F-114");
    expect(affectedRows(["package-lock.json"]).rows).toHaveLength(24);
    expect(affectedRows(["apps/web/package.json"]).rows).toHaveLength(24);
    expect(affectedRows(["packages/cad-core/package.json"]).rows).toHaveLength(24);
    expect(sourceToRows().get("packages/cad-core/src/trim.ts")).toEqual(["F-022", "F-023"]);
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

  it("refreshes only authorities that can be affected by a runtime source", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { cross: { sha256: "cross-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "apps/web/src/App.tsx": "old" }, evidence, receipts }] };
    const stale = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "apps/web/src/App.tsx": "new" }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, stale)).toEqual([
      "F-023: source changed without refreshed browser evidence.",
      "F-023: source changed without refreshed readback evidence.",
      "F-023: source changed without refreshed cross stage receipt.",
    ]);
    const refreshed = structuredClone(stale);
    refreshed.rows[0].evidence.browser.descriptorSha256 = "new-browser-descriptor";
    refreshed.rows[0].evidence.readback.artifactSha256 = "new-readback-artifact";
    refreshed.rows[0].receipts.cross.sha256 = "new-cross-receipt";
    expect(staleEvidenceBindings(previous, refreshed)).toEqual([]);
  });

  it("keeps AutoCAD-only source changes scoped to native evidence plus cross-check", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { cross: { sha256: "cross-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "tools/autocad/run-f023.mjs": "old" }, evidence, receipts }] };
    const stale = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "tools/autocad/run-f023.mjs": "new" }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, stale)).toEqual([
      "F-023: source changed without refreshed autocad evidence.",
      "F-023: source changed without refreshed cross stage receipt.",
    ]);
  });

  it("treats a row scope document as cross-contract provenance, not executable geometry", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "parity/F-023-scope.md": "old" }, evidence, receipts: { cross: { sha256: "old-cross" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "parity/F-023-scope.md": "new" }, evidence, receipts: { cross: { sha256: "old-cross" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual(["F-023: source changed without refreshed cross stage receipt."]);
  });

  it("fails closed across every authority when the package dependency surface changes", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { global: { sha256: "global-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "old", stages: {} } }, evidence, receipts }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "new", stages: {} } }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("scopes a package stage-command change to its authority, cross-check and global receipt", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{
      rowId: "F-003",
      sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "same", stages: { autocad: { rootScript: "parity:f003:autocad", closureSha256: "old" } } } },
      evidence,
      receipts: { cross: { sha256: "old-cross" }, global: { sha256: "old-global" } },
    }] };
    const current = structuredClone(previous);
    current.rows[0].sources["package.json"].stages.autocad.closureSha256 = "new";
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed cross stage receipt.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("keeps unrelated package scripts out of a row package contract", () => {
    const row = { stages: { autocad: "parity:f003:autocad" } };
    const before = {
      name: "kuubik-draw",
      scripts: { "parity:f003:autocad": "node tools/autocad/run-f003.mjs", "test:mutation": "vitest run old.test.ts" },
    };
    const after = structuredClone(before);
    after.scripts["test:mutation"] = "vitest run old.test.ts new-f023.test.ts";
    after.scripts["parity:f023:autocad"] = "node tools/autocad/run-f023.mjs";
    expect(packageContractForRow(before, row)).toEqual(packageContractForRow(after, row));
  });

  it("includes transitively invoked npm scripts in a row package contract", () => {
    const row = { stages: { readback: "parity:f003:readback" } };
    const before = {
      name: "kuubik-draw",
      scripts: { "parity:f003:readback": "npm run build && node readback.mjs", build: "tsc -b" },
    };
    const after = structuredClone(before);
    after.scripts.build = "tsc -b --force";
    expect(packageContractForRow(before, row)).not.toEqual(packageContractForRow(after, row));
  });

  it("fails closed across every authority when a workspace package manifest changes", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "packages/cad-core/package.json": "old" }, evidence, receipts: { global: { sha256: "global" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "packages/cad-core/package.json": "new" }, evidence, receipts: { global: { sha256: "global" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("checks non-package source bindings during the v3 to v4 migration", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 3, rows: [{ rowId: "F-003", sources: { "apps/web/src/App.tsx": "old", "package.json": "old-package" }, evidence, receipts: {} }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "apps/web/src/App.tsx": "new", "package.json": { schemaVersion: 1, packageSurfaceSha256: "same", stages: {} } }, evidence: structuredClone(evidence), receipts: {} }] };
    expect(staleEvidenceBindings(previous, current, { allowV3ToV4: true, ignoredSourcePaths: ["package.json"] })).toEqual([
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
    ]);
    current.rows[0].evidence.browser.descriptorSha256 = "new-browser";
    current.rows[0].evidence.readback.artifactSha256 = "new-readback";
    expect(staleEvidenceBindings(previous, current, { allowV3ToV4: true, ignoredSourcePaths: ["package.json"] })).toEqual([]);
  });

  it("requires a refreshed global receipt when CI or parity topology changes on a row without cross evidence", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "parity/rows.mjs": "old", ".github/workflows/ci.yml": "old" }, evidence, receipts: { global: { sha256: "old-global" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "parity/rows.mjs": "new", ".github/workflows/ci.yml": "new" }, evidence, receipts: { global: { sha256: "old-global" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed global stage receipt.",
    ]);
    current.rows[0].receipts.global.sha256 = "new-global";
    expect(staleEvidenceBindings(previous, current)).toEqual([]);
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
