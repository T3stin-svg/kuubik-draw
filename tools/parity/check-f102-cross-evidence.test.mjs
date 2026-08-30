import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-102 cross-evidence dependency boundary", () => {
  it("binds current browser and native artifacts in the cross receipt without forcing a native rerun for a browser-only SHA change", async () => {
    const source = await readFile(new URL("check-f102-cross-evidence.mjs", import.meta.url), "utf8");
    expect(source).not.toContain("autocad.browserEvidenceSha256 ===");
    expect(source).toContain("sourceSha256: Object.fromEntries(Object.entries(sourceBytes)");
    expect(source).toContain("autocad.scriptSha256 === implementationSha256.autocadMarker");
    expect(source).toContain("browser.sourceSha256?.app === implementationSha256.app");
    expect(source).toContain("readback.sourceSha256?.browserEvidence === sha256(sourceBytes.browser)");
  });
});
