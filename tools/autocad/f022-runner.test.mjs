import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-022 native Standard TRIM read-back ratchet", () => {
  it("requires stable exact geometry and properties before and after TRIM", async () => {
    const matrix = await source("f022-standard-matrix.ps1");
    expect(matrix).toContain("function Get-StableExactLineSet");
    expect(matrix).toMatch(/Get-StableExactLineSet[\s\S]*\$Document\.Regen\(1\)[\s\S]*geometryExact[\s\S]*propertiesExact[\s\S]*consecutiveExactReads[\s\S]*-ge 2/gu);
    expect(matrix).toContain("standardBeforeReadback = Get-StableExactLineSet");
    expect(matrix).toContain("standardBeforeReadback.stable -and $standardReadback.stable");
    expect(matrix).toContain("standardBeforeReadback=$standardBeforeReadback");
    expect(matrix).toContain("standardReadback=$standardReadback");
  });

  it("surfaces both native snapshots and bounded pass history on failure", async () => {
    const runner = await source("run-f022.mjs");
    expect(runner).toContain("standardBefore: diagnostic.observations?.standardBefore");
    expect(runner).toContain("standardBeforeReadback: diagnostic.observations?.standardBeforeReadback");
    expect(runner).toContain("standardReadback: diagnostic.observations?.standardReadback");
  });

  it("retries an empty COM version instead of accepting a stale blank identity", async () => {
    const matrix = await source("f022-standard-matrix.ps1");
    expect(matrix).toContain("function Get-ComRequiredString");
    expect(matrix).toContain("if ([string]::IsNullOrWhiteSpace($value)) { throw \"AutoCAD returned an empty $Name.\" }");
    expect(matrix).toContain("engineVersion=Get-ComRequiredString { $acad.Version } 'Version'");
  });
});
