import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DxfParser from "dxf-parser";
import { describe, expect, it } from "vitest";
import { createF110Document } from "./f110-fixture.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-110 physical file read-back", () => {
  it("writes, independently reopens and parses the exact production DXF bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "kuubik-f110-"));
    const path = join(root, "f110-core.dxf");
    try {
      const exported = exportDxf(createF110Document());
      writeFileSync(path, exported.bytes);
      const reopened = Uint8Array.from(readFileSync(path));
      expect(reopened).toEqual(exported.bytes);
      const digest = createHash("sha256").update(reopened).digest("hex");
      expect(digest).toMatch(/^[0-9a-f]{64}$/u);

      const independent = new DxfParser().parseSync(new TextDecoder("windows-1252").decode(reopened))!;
      expect(independent.header?.$INSUNITS).toBe(4);
      expect(independent.entities.some((entity) => entity.type === "INSERT")).toBe(true);
      expect(Object.keys(independent.blocks ?? {})).toContain("SYMBOL");

      const strict = importDxf(reopened, { documentId: "f110-file-readback" });
      expect(strict.report.skipped).toEqual([]);
      expect(strict.report.importedHandles).toEqual(["C0", "C1", "10", "20", "30", "40", "50", "60", "70", "80", "90", "A0", "B0"]);
      expect(exportDxf(strict.document).bytes).toEqual(reopened);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
