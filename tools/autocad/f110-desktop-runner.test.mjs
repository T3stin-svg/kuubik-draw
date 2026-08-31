import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("F-110 licensed AutoCAD Desktop runner", () => {
  it("uses a distinct ActiveX SaveAs output and preserves a pre-save semantic manifest", async () => {
    const script = (await read("tools/autocad/f110-desktop-phase1.scr")).toString("utf8");
    expect(script).toContain("F-110-desktop-pre.txt");
    expect(script).toContain("F-110-desktop-saved.dxf");
    expect(script).toContain("(vla-SaveAs f110-document f110-output 65)");
    expect(script).toContain("SAVEAS_DONE=1");
    expect(script).not.toContain("_.QSAVE");
  });

  it("reopens read-only semantics and runs AUDIT without repairs", async () => {
    const script = (await read("tools/autocad/f110-desktop-phase2.scr")).toString("utf8");
    expect(script).toContain("_.AUDIT\n_N");
    expect(script).toContain("AUDIT_DONE=1");
    expect(script).toContain("LOGFILENAME");
    expect(script).toContain("F-110-desktop-post.txt");
  });

  it("pins the source, Desktop SaveAs and production Chromium DXF bytes", async () => {
    const fixtures = {
      "packages/cad-dxf/test/fixtures/synthetic/F-110-desktop-source.dxf": "99e40e4537e1788a6ebd2d9d6092b4501f3e7fc96fb7fe1769dbeaae549bb0d3",
      "packages/cad-dxf/test/fixtures/synthetic/F-110-desktop-saved.dxf": "8540f77da4b011c39f38fee5cdeb285ca854e918398fa1fd8944eab31cd4cb4f",
      "packages/cad-dxf/test/fixtures/synthetic/F-110-browser-roundtrip.dxf": "90f0ce92ff2c263cec219ed625b2f0d4bc7fec03fd194764b767e0ff177fb6e0",
    };
    for (const [path, digest] of Object.entries(fixtures)) expect(sha256(await read(path)), path).toBe(digest);
  });

  it("content-addresses all three F-110 authority receipts", async () => {
    for (const kind of ["autocad", "browser", "readback"]) {
      const receipt = JSON.parse((await read(`evidence/${kind}/F-110.json`)).toString("utf8"));
      expect(receipt).toMatchObject({ rowId: "F-110", kind, status: "PASS" });
      expect(sha256(await read(receipt.artifact))).toBe(receipt.artifactSha256);
    }
  });
});
