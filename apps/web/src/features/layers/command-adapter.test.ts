import { describe, expect, it } from "vitest";
import { PrecisionCommandState, PrecisionVisualShellAdapter } from "../precision/command-adapter.js";
import { LayerVisualShellCommandAdapter } from "./command-adapter.js";

describe("typed VisualShellCommandAdapter layer boundary", () => {
  it("routes layer intents and delegates precision state", () => {
    const precision = new PrecisionCommandState();
    const actions: string[] = [];
    const adapter = new LayerVisualShellCommandAdapter(new PrecisionVisualShellAdapter(precision), (action, rowId) => actions.push(`${rowId}:${action}`));
    expect(adapter.canExecute("F-072", "paper")).toBe(true);
    expect(adapter.canExecute("F-086", "paper")).toBe(false);
    expect(adapter.canExecute("F-086", "model")).toBe(false);
    adapter.execute("F-072");
    adapter.execute("F-086");
    adapter.setPrecisionMode("F-045", true);
    expect(adapter.precisionMode("F-045")).toBe(true);
    expect(actions).toEqual(["F-072:create"]);
  });
});
