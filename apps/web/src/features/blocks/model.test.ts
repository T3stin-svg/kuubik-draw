import { describe, expect, it } from "vitest";
import { BLOCK_TOOLS, createBlockAction } from "./model.js";

describe("block feature contract", () => {
  it("maps one visible command to every owned F-row", () => {
    expect(BLOCK_TOOLS.map((tool) => tool.rowId)).toEqual(["F-087", "F-088", "F-089", "F-090", "F-091"]);
  });

  it("enforces BLOCK/INSERT/single-INSERT selection semantics", () => {
    expect(createBlockAction("BLOCK", ["10", "10", "20"])).toEqual({ commandId: "BLOCK", selectedHandles: ["10", "20"] });
    expect(createBlockAction("EXPLODE", ["30"])).toEqual({ commandId: "EXPLODE", selectedHandles: ["30"] });
    expect(() => createBlockAction("INSERT", ["30"])).toThrow(/does not accept/u);
    expect(() => createBlockAction("BEDIT", ["30", "31"])).toThrow(/exactly one/u);
  });
});
