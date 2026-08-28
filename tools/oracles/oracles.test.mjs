import { describe, expect, it } from "vitest";
import { probeOracles } from "./probe-tools.mjs";

describe("oracle availability is never fabricated", () => {
  it("returns NOT_RUN for explicitly missing executables", async () => {
    const report = await probeOracles({
      ...process.env,
      LIBRECAD_CMD: "Z:\\missing\\LibreCAD.exe",
      FREECAD_CMD: "Z:\\missing\\FreeCADCmd.exe",
    });
    expect(report).toEqual([
      expect.objectContaining({ oracle: "librecad", status: "NOT_RUN", certificationAuthority: false }),
      expect.objectContaining({ oracle: "freecad", status: "NOT_RUN", certificationAuthority: false }),
    ]);
  });
});
