import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertLicensedNativeCapability, createBlockedNativeCadAdapter, NativeSdkUnavailableError } from "./contracts.js";

describe("licensed native CAD adapter boundary", () => {
  it("keeps every native operation blocked without licensed SDK evidence", async () => {
    const adapter = createBlockedNativeCadAdapter("No licensed ODA Drawings SDK or Autodesk RealDWG runtime and license evidence were found.");
    expect(adapter.capabilities).toEqual(expect.objectContaining({ available: false, sdk: null, supportedRows: [] }));
    await expect(adapter.importDwg({ fileName: "fixture.dwg", bytes: new Uint8Array(), sourceSha256: "0".repeat(64) }, "doc"))
      .rejects.toEqual(expect.objectContaining({ name: "NativeSdkUnavailableError", code: "NATIVE_SDK_UNAVAILABLE" }));
    expect(() => assertLicensedNativeCapability(adapter.capabilities)).toThrow(NativeSdkUnavailableError);
  });

  it("requires license evidence, runtime SHA and offline execution before capability unlock", () => {
    expect(() => assertLicensedNativeCapability({
      available: true,
      sdk: { provider: "autodesk-realdwg", product: "RealDWG", version: "2026", licenseEvidenceId: "", runtimeSha256: "0".repeat(64) },
      supportedRows: ["F-112"], unknownObjectRoundtrip: true, processIsolated: true, networkRequired: false, blocker: null,
    })).toThrow(/license evidence/u);
    expect(() => assertLicensedNativeCapability({
      available: true,
      sdk: { provider: "oda-drawings-sdk", product: "ODA Drawings SDK", version: "2026", licenseEvidenceId: "license-1", runtimeSha256: "0".repeat(64) },
      supportedRows: ["F-112"], unknownObjectRoundtrip: true, processIsolated: true, networkRequired: true, blocker: null,
    })).toThrow(/must not require runtime network/u);
  });

  it("keeps all four native fixtures semantic-only until licensed generation", () => {
    const path = fileURLToPath(new URL("./fixtures/native-gate-v1.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    expect(manifest.authorityRequired).toEqual(["oda-drawings-sdk", "autodesk-realdwg"]);
    expect(manifest.sourceFilesCheckedIn).toBe(false);
    expect(manifest.fixtures.map((fixture: { rowId: string }) => fixture.rowId).sort()).toEqual(["F-112", "F-113", "F-117", "F-121"]);
    expect(manifest.fixtures.every((fixture: { sourceSha256: null }) => fixture.sourceSha256 === null)).toBe(true);
  });
});
