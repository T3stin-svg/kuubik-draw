import { describe, expect, it } from "vitest";
import { annotationPromptPlan } from "./model.js";
import { CommandPromptStateMachine } from "./prompt-state-machine.js";

describe("annotation/block command prompt state machine", () => {
  it("advances through command-specific choices, cancels without retained values and repeats from the first prompt", () => {
    const prompt = new CommandPromptStateMachine(annotationPromptPlan("DIMLINEAR"));
    expect(prompt.snapshot).toMatchObject({ commandId: "DIMLINEAR", status: "active", currentFieldId: "first" });
    prompt.answer({ x: 0, y: 0 });
    prompt.answer({ x: 100, y: 0 });
    prompt.answer({ x: 0, y: 20 });
    expect(prompt.snapshot).toMatchObject({ currentFieldId: "axis", currentChoices: ["horizontal", "vertical"] });
    expect(() => prompt.answer("diagonal")).toThrow(/must be one of/u);
    expect(prompt.snapshot.currentFieldId).toBe("axis");
    prompt.answer("horizontal");
    prompt.answer(true);
    expect(prompt.answer("DIM")).toMatchObject({ status: "ready", currentFieldId: null });
    expect(prompt.repeat()).toMatchObject({ status: "active", currentFieldId: "first", values: {} });
    prompt.answer({ x: 1, y: 2 });
    expect(prompt.cancel()).toMatchObject({ status: "cancelled", values: {} });
  });

  it.each([
    ["point", "bad"],
    ["number", Number.NaN],
    ["boolean", "true"],
    ["handles", []],
    ["attributes", ["not-an-attribute"]],
  ] as const)("rejects a mutated %s value without advancing state", (valueKind, invalidValue) => {
    const prompt = new CommandPromptStateMachine({ commandId: "MUTANT", fields: [{ id: "value", label: "Value", valueKind, required: true }] });
    const before = prompt.snapshot;
    expect(() => prompt.answer(invalidValue)).toThrow();
    expect(prompt.snapshot).toEqual(before);
  });
});
