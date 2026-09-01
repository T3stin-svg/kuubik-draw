import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { VisualShellLivePrompt } from "./runtime-adapter.js";

function hatchPrompt(selectedHandles: readonly string[] = []): VisualShellLivePrompt {
  return new VisualShellLivePrompt(
    new CadSession(createEmptyDocument({ documentId: "hatch-prompt-routing" })),
    { commandId: "HATCH", context: { selectedHandles } },
  );
}

describe("VisualShellLivePrompt HATCH routing", () => {
  it("routes create through only required creation fields and optional pattern controls", () => {
    const prompt = hatchPrompt();
    expect(prompt.field).toMatchObject({ id: "mode", required: false });

    prompt.answer("create");
    for (const [id, value, required] of [
      ["boundaryHandles", "P1", true],
      ["pattern", "ANSI31", true],
      ["angleRad", "0.7853981633974483", true],
      ["scale", "1", true],
      ["associative", "jah", true],
      ["islandDetection", "normal", false],
      ["origin", "0,0", false],
    ] as const) {
      expect(prompt.field).toMatchObject({ id, required });
      prompt.answer(value);
    }

    expect(prompt.snapshot).toMatchObject({ status: "ready", values: { mode: "create", boundaryHandles: ["P1"], islandDetection: "normal", origin: { x: 0, y: 0 } } });
    expect(prompt.snapshot.values).not.toHaveProperty("targetHandle");
    expect(prompt.snapshot.values).not.toHaveProperty("patch");
  });

  it("defaults a skipped mode to the create branch", () => {
    const prompt = hatchPrompt();
    prompt.answer("");
    expect(prompt.field).toMatchObject({ id: "boundaryHandles", required: true });
  });

  it("routes edit through patch and requires a target only without one selected", () => {
    const selected = hatchPrompt(["H1"]);
    selected.answer("edit");
    expect(selected.field).toMatchObject({ id: "patch", required: true });
    selected.answer(JSON.stringify({ pattern: "SOLID" }));
    expect(selected.snapshot).toMatchObject({ status: "ready", values: { mode: "edit", patch: { pattern: "SOLID" } } });
    expect(selected.snapshot.values).not.toHaveProperty("targetHandle");
    expect(selected.snapshot.values).not.toHaveProperty("boundaryHandles");

    const unselected = hatchPrompt();
    unselected.answer("edit");
    expect(unselected.field).toMatchObject({ id: "targetHandle", required: true });
    unselected.answer("H1");
    expect(unselected.field).toMatchObject({ id: "patch", required: true });
    unselected.answer(JSON.stringify({ pattern: "SOLID" }));
    expect(unselected.snapshot.status).toBe("ready");
  });
});
