import { describe, expect, it } from "vitest";
import { CadObjectTrack } from "../../../../../packages/cad-renderer/src/tracking.js";
import { PrecisionCommandState } from "./command-adapter.js";
import { PrecisionFeatureModel } from "./model.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("precision command property and wiring coverage", () => {
  it("keeps 2,000 seeded command transitions boolean and replay-deterministic", () => {
    const random = seeded(0x50454349);
    const commands = ["ORTHO", "POLAR", "GRID", "SNAP", "OSNAP", "OTRACK", "DYNMODE"];
    const arguments_ = ["ON", "OFF", "TOGGLE", "1", "0"];
    const stream = Array.from({ length: 2_000 }, () => `${commands[Math.floor(random() * commands.length)]} ${arguments_[Math.floor(random() * arguments_.length)]}`);
    const first = new PrecisionCommandState();
    const second = new PrecisionCommandState();
    stream.forEach((command) => {
      expect(first.executeCommandLine(command).handled).toBe(true);
      second.executeCommandLine(command);
      Object.values(first.state).slice(0, 7).forEach((value) => expect(typeof value).toBe("boolean"));
    });
    expect(first.state).toEqual(second.state);
  });

  it("feeds OTRACK acquisition, command state, preview, commit and Dynamic Input through one point result", () => {
    const track = new CadObjectTrack();
    track.acquire("endpoint:A", { x: 10, y: 10 }, 1);
    const state = new PrecisionCommandState({ otrack: true, dynamicInput: true });
    const request = state.prepareRequest({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 10.1, y: 4 },
      trackingCandidates: track.candidates({ x: 10.1, y: 4 }, 0.2),
    }, { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.2 });
    const model = new PrecisionFeatureModel();
    const preview = model.preview(request);
    const commit = model.commit(request);
    const dynamic = model.dynamicInput(request, { linear: "mm", displayPrecision: 4, angularPrecision: 3 });
    expect(preview).toEqual(commit);
    expect(dynamic.point).toEqual(commit.point);
    expect(commit).toMatchObject({ source: "otrack", point: { x: 10, y: 4 } });
  });
});
