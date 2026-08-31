import { describe, expect, it } from "vitest";
import { PrecisionCommandState, PrecisionVisualShellAdapter } from "./command-adapter.js";

describe("precision keyboard and command-line state", () => {
  it("maps the standard function keys and never consumes editable/repeat events", () => {
    const state = new PrecisionCommandState();
    expect(state.handleKey("F8")).toMatchObject({ handled: true, changed: true, state: { ortho: true } });
    expect(state.handleKey("f10")).toMatchObject({ handled: true, state: { polar: true } });
    expect(state.handleKey("F3", { editableTarget: true })).toMatchObject({ handled: false, state: { osnap: false } });
    expect(state.handleKey("F11", { repeat: true })).toMatchObject({ handled: false, state: { otrack: false } });
    expect(state.handleKey("A")).toMatchObject({ handled: false, changed: false });
  });

  it("parses deterministic ON/OFF/TOGGLE commands and fails closed on invalid input", () => {
    const state = new PrecisionCommandState();
    expect(state.executeCommandLine("snap on")).toMatchObject({ handled: true, changed: true, state: { snap: true } });
    expect(state.executeCommandLine("grid 0")).toMatchObject({ state: { grid: false } });
    expect(state.executeCommandLine("otrack toggle")).toMatchObject({ state: { otrack: true } });
    expect(state.executeCommandLine("dynmode maybe")).toMatchObject({ handled: true, changed: false, state: { dynamicInput: false } });
    expect(state.executeCommandLine("line")).toMatchObject({ handled: false, changed: false });
  });

  it("validates OSNAP mode lists atomically", () => {
    const state = new PrecisionCommandState({ osnapModes: ["endpoint"] });
    expect(state.executeCommandLine("OSNAP END,MID,TAN")).toMatchObject({ changed: true, state: { osnap: true, osnapModes: ["endpoint", "midpoint", "tangent"] } });
    const before = state.state;
    expect(state.executeCommandLine("OSNAP END,BOGUS")).toMatchObject({ handled: true, changed: false });
    expect(state.state).toEqual(before);
  });

  it("uses SNAP for model-grid quantization and OSNAP/OTRACK only when enabled", () => {
    const state = new PrecisionCommandState({ ortho: true, grid: true, snap: false, osnap: false, otrack: true });
    const request = state.prepareRequest({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 1 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 8, y: 0 } }],
      trackingCandidates: [{ kind: "otrack", priority: 90, point: { x: 9, y: 0 } }],
    }, { polarIncrementRad: Math.PI / 4, gridSpacingX: 2, gridSpacingY: 2, aperture: 2 });
    expect(request.modes).toEqual({ ortho: true, aperture: 2 });
    expect(request.objectSnapCandidates).toEqual([]);
    expect(request.trackingCandidates).toHaveLength(1);
  });
});

describe("typed VisualShellCommandAdapter precision boundary", () => {
  it("exposes row state without importing or changing shell code", () => {
    const precision = new PrecisionCommandState();
    const delegated: string[] = [];
    const adapter = new PrecisionVisualShellAdapter(precision, {
      canExecute: (rowId) => rowId === "F-001",
      execute: (rowId) => delegated.push(rowId),
    });
    expect(adapter.canExecute("F-045", "model")).toBe(true);
    adapter.execute("F-045");
    expect(adapter.precisionMode("F-045")).toBe(true);
    adapter.setPrecisionMode("F-052", true);
    expect(adapter.precisionMode("F-052")).toBe(true);
    adapter.execute("F-001");
    expect(delegated).toEqual(["F-001"]);
  });
});
