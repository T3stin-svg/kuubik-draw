import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("F-061 native runner evidence ratchet", () => {
  it("keeps AutoCAD and session-4 DXF evidence explicitly NOT_RUN without certification authority", async () => {
    const source = await readFile(new URL("../../../../../evidence/workstreams/annotation-blocks/f061-autocad-live-fixture.json", import.meta.url), "utf8");
    const evidence = JSON.parse(source) as Record<string, unknown>;
    expect(evidence).toMatchObject({ schemaVersion: 1, rowId: "F-061", status: "NOT_RUN", certificationAuthority: false, runner: "NOT_PREPARED_OUTSIDE_OWNED_PATHS" });
    expect(evidence).toHaveProperty("remainingCertificationRequirements", expect.arrayContaining([
      "owned AutoCAD 2024.1.2 scratch-process run",
      "session 4 implementation of the documented DXF contract",
      "same live workflow comparison in AutoCAD and Kuubik",
      "independent saved-file read-back",
    ]));
  });
});
