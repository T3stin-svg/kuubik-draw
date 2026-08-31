import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import golden from "./annotation.golden.json";
import { readLeaderContract, readMTextContract } from "./contracts.js";
import {
  createLeader,
  createMLeader,
  createMText,
  createTextStyle,
  deriveMTextLayout,
  editLeader,
  editMText,
} from "./text.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "text-leader-wave11", now: "2026-08-31T21:00:00.000Z" });
  document.textStyles.push(
    { id: "TXT", name: "Standard", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 },
    { id: "NARROW", name: "Narrow", fontFamily: "Arial Narrow", widthFactor: 0.8, obliqueAngleRad: 0.1 },
  );
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 40 } });
  return document;
}

describe("F-057..F-060 text and leader completion wave", () => {
  it("preserves existing paragraph ids when MTEXT gains a paragraph and matches the golden edit contract", () => {
    const document = fixture();
    const original = createMText(document, {
      handle: "T1", layerId: "0", position: { x: 10, y: 20 }, text: "Pealkiri\nSisu", height: 2.5, width: 50,
      styleId: "TXT", paragraphs: [{ id: "TITLE", alignment: "center" }, { id: "BODY", alignment: "justify" }],
    });
    document.entities.push(original);
    const before = structuredClone(document);
    const change = editMText(document, "T1", { text: "Pealkiri\nSisu\nLisa", width: 24, attachment: "bottom-right", lineSpacingFactor: 1.5, wrapMode: "character", styleId: null });
    expect(document).toEqual(before);
    expect(change).toMatchObject({ type: "put", entity: { handle: "T1", position: { x: 10, y: 20 } } });
    if (change.type !== "put") throw new Error("Expected MTEXT put change.");
    expect(change.entity).not.toHaveProperty("styleId");
    expect(readMTextContract(change.entity)).toEqual(golden.mtextStableEditContract);
  });

  it("wraps Unicode by complete code points without corrupting model text", () => {
    const document = fixture();
    const text = "A😀B🚀C";
    const entity = createMText(document, { handle: "U1", layerId: "0", position: { x: -5, y: 7 }, text, height: 2, width: 1.2, wrapMode: "character" });
    const lines = deriveMTextLayout(document, entity).map((line) => line.text);
    expect(lines).toEqual(["A", "😀", "B", "🚀", "C"]);
    expect(lines.join("")).toBe(text);
    expect(lines.every((line) => !/[\uD800-\uDFFF]/u.test(line) || Array.from(line).length === 1)).toBe(true);
  });

  it("detaches LEADER content/association and MLEADER style/association without changing handles", () => {
    const document = fixture();
    const anchor = { handle: "10", feature: "end" as const, fallback: { x: 100, y: 40 } };
    const leader = createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 10 }], text: "Viide", textStyleId: "TXT", anchor });
    const mleader = createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 30, y: 15 }], text: "Märkus", textPosition: { x: 35, y: 15 }, styleId: "MLEADER-STD", textStyleId: "TXT", textHeight: 2.5, landingGap: 1.25, arrowType: "open", arrowSize: 3.5, landingEnabled: false, landingLength: 0, anchor });
    document.entities.push(leader, mleader);
    const leaderChange = editLeader(document, "L1", { text: null, textStyleId: null, anchor: null });
    const mleaderChange = editLeader(document, "ML1", { textStyleId: null, anchor: null });
    expect(leaderChange).toMatchObject({ type: "put", entity: { handle: "L1", vertices: [{ x: 100, y: 40 }, { x: 20, y: 10 }] } });
    if (leaderChange.type !== "put" || mleaderChange.type !== "put") throw new Error("Expected leader put changes.");
    expect(leaderChange.entity).not.toHaveProperty("text");
    expect(readLeaderContract(leaderChange.entity)).toMatchObject({ kind: "leader", associative: false, content: { textHeight: 2.5 } });
    expect(readLeaderContract(leaderChange.entity)).not.toHaveProperty("anchor");
    expect(readLeaderContract(mleaderChange.entity)).toEqual(golden.detachedMLeaderContract);
  });

  it("rejects runtime payload variants that TypeScript types alone cannot protect", () => {
    const document = fixture();
    const before = structuredClone(document);
    expect(() => createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "A", height: 2.5, width: 20, attachment: "middle-baseline" as never })).toThrow(/attachment/u);
    expect(() => createMText(document, { handle: "T2", layerId: "0", position: { x: 0, y: 0 }, text: "A", height: 2.5, width: 20, wrapMode: "auto" as never })).toThrow(/wrap mode/u);
    expect(() => createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], arrowType: "triangle" as never })).toThrow(/arrow type/u);
    expect(() => createLeader(document, { handle: "L2", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], landingEnabled: "yes" as never })).toThrow(/landing enabled/u);
    document.entities.push(createMText(document, { handle: "Case", layerId: "0", position: { x: 0, y: 0 }, text: "A", height: 2.5, width: 20 }));
    expect(() => createMText(document, { handle: "case", layerId: "0", position: { x: 0, y: 0 }, text: "B", height: 2.5, width: 20 })).toThrow(/Duplicate entity handle/u);
    expect(() => createTextStyle(document, { id: "txt", name: "Different", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 })).toThrow(/already exists/u);
    expect({ ...document, entities: before.entities }).toEqual(before);
  });
});
