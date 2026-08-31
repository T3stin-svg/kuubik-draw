import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

describe("F-053 AutoCAD evidence content addresses", () => {
  it("pins every runner, safety helper, test and synthetic fixture used by live evidence", async () => {
    const evidence = JSON.parse(await readFile(resolve(root, "evidence/autocad/F-053.json"), "utf8"));
    const entries = Object.entries(evidence.implementationSha256 ?? {});
    expect(entries.map(([path]) => path).toSorted()).toEqual([
      "packages/cad-dxf/test/fixtures/synthetic/F-053-units-header.dxf",
      "tools/autocad/f053-content-address.test.mjs",
      "tools/autocad/f053-dxf-readback.mjs",
      "tools/autocad/f053-dxf-readback.test.mjs",
      "tools/autocad/f053-runner.test.mjs",
      "tools/autocad/f053-units-matrix.ps1",
      "tools/autocad/owned-desktop-matrix.mjs",
      "tools/autocad/process-ownership.mjs",
      "tools/autocad/run-f053.mjs",
    ]);
    for (const [path, digest] of entries) {
      const bytes = await readFile(resolve(root, path));
      expect(digest, path).toBe(sha256(bytes));
      expect(sha256(Buffer.concat([bytes, Buffer.from([0])])), `${path} mutation`).not.toBe(digest);
    }
    expect(evidence.dxfReadback.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.automationProcessIdentity.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
