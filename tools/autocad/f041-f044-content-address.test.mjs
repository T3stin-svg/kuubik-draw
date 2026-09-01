import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

describe("F-041/F-042/F-044 AutoCAD evidence content addresses", () => {
  it("pins every runner, process helper, test and fixture used by live evidence", async () => {
    const evidence = JSON.parse(await readFile(resolve(root, "evidence/autocad/F-041-F-042-F-044.json"), "utf8"));
    const entries = Object.entries(evidence.implementationSha256 ?? {});
    expect(entries.map(([path]) => path).toSorted()).toEqual([
      "packages/cad-core/test/f041-f044-autocad-reference.test.ts",
      "packages/cad-core/test/fixtures/autocad-2024-coordinate-reference.json",
      "packages/cad-dxf/test/fixtures/synthetic/F-041-F-042-coordinate-entry.dxf",
      "tools/autocad/f041-f042-f044-coordinate-matrix.ps1",
      "tools/autocad/f041-f044-content-address.test.mjs",
      "tools/autocad/f041-f044-dxf-readback.mjs",
      "tools/autocad/f041-f044-dxf-readback.test.mjs",
      "tools/autocad/f041-f044-runner.test.mjs",
      "tools/autocad/owned-desktop-matrix.mjs",
      "tools/autocad/process-ownership.mjs",
      "tools/autocad/run-f041-f042-f044.mjs",
    ]);
    for (const [path, digest] of entries) {
      const bytes = await readFile(resolve(root, path));
      expect(digest, path).toBe(sha256(bytes));
      expect(sha256(Buffer.concat([bytes, Buffer.from([0])])), `${path} mutation`).not.toBe(digest);
    }
    expect(evidence.status).toBe("BLOCKED");
    expect(evidence.certificationAuthority).toBe(false);
    expect(evidence.rowResults).toEqual({ "F-041": "NOT_RUN", "F-042": "NOT_RUN", "F-044": "NOT_RUN" });
    expect(evidence.dxfReadback).toEqual({ status: "NOT_RUN", reason: "No complete live matrix produced a retained scratch DXF." });
    expect(evidence.processSafety).toMatchObject({ authenticatedOwnedProcessesTerminated: true, unauthenticatedProcessesTouched: false, exactProcessSetRestored: false });
  });
});
