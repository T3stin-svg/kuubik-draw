import { describe, expect, it } from "vitest";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./annotation.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readLeaderContract, readMTextContract } from "./contracts.js";
import {
  applyTextStyle,
  createLeader,
  createMLeader,
  createMText,
  deriveMTextLayout,
  editLeader,
  editMText,
  evaluateTextAnnotationCapability,
  updateAssociativeLeaders,
  updateTextStyle,
} from "./text.js";
import { updateAssociativeAnnotations } from "./update.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "text-leader-wave7", now: "2026-08-31T19:00:00.000Z" });
  document.textStyles.push(
    { id: "TXT-ISO", name: "ISO", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 },
    { id: "TXT-NARROW", name: "Narrow", fontFamily: "Arial Narrow", widthFactor: 0.8, obliqueAngleRad: 0 },
  );
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 40 } });
  return document;
}

describe("F-057 MTEXT paragraph, wrap and model-space contract", () => {
  it("matches the golden paragraph/alignment contract and derives deterministic wrapped lines", () => {
    const document = fixture();
    const mtext = createMText(document, {
      handle: "T1", layerId: "0", position: { x: 1234.5, y: -55 }, text: "üks kaks kolm neli\nteine lõik", height: 2,
      width: 18, rotationRad: Math.PI / 6, styleId: "TXT-ISO", attachment: "middle-center", lineSpacingFactor: 1.2,
      wrapMode: "word", paragraphs: [{ id: "TITLE", alignment: "center" }, { id: "BODY", alignment: "justify" }],
    });
    expect(readMTextContract(mtext)).toEqual(golden.mtextContract);
    expect(mtext).toMatchObject({ handle: "T1", position: { x: 1234.5, y: -55 }, rotationRad: Math.PI / 6, styleId: "TXT-ISO" });
    expect(deriveMTextLayout(document, mtext)).toEqual([
      { paragraphId: "TITLE", alignment: "center", text: "üks kaks kolm" },
      { paragraphId: "TITLE", alignment: "center", text: "neli" },
      { paragraphId: "BODY", alignment: "justify", text: "teine lõik" },
    ]);
  });

  it("edits width, wrap, paragraphs and rotation under the same handle", () => {
    const document = fixture();
    document.entities.push(createMText(document, { handle: "T1", layerId: "0", position: { x: 1, y: 2 }, text: "A B", height: 2, width: 20, styleId: "TXT-ISO" }));
    const change = editMText(document, "T1", { text: "A B C\nD E", width: 6, wrapMode: "character", rotationRad: 0.75, paragraphs: [{ id: "P-A", alignment: "right" }, { id: "P-B", alignment: "left" }] });
    expect(change).toMatchObject({ type: "put", entity: { handle: "T1", rotationRad: 0.75, styleId: "TXT-ISO" } });
    if (change.type !== "put") throw new Error("Expected MTEXT put change.");
    expect(readMTextContract(change.entity)).toMatchObject({ width: 6, wrapMode: "character", paragraphs: [{ id: "P-A", alignment: "right" }, { id: "P-B", alignment: "left" }] });
  });

  it("keeps deterministic line limits across a bounded width/height property corpus", () => {
    const document = fixture();
    for (let index = 1; index <= 32; index += 1) {
      const height = 0.5 + index / 10; const width = height * (2 + index % 11);
      const entity = createMText(document, { handle: `T${index}`, layerId: "0", position: { x: index, y: -index }, text: "ABCDEFGHIJKLMNO", height, width, wrapMode: "character" });
      const limit = Math.max(1, Math.floor(width / (height * 0.6)));
      expect(deriveMTextLayout(document, entity).every((line) => line.text.length <= limit)).toBe(true);
    }
  });
});

describe("F-058 text style create/apply/update semantics", () => {
  it("applies one style atomically without changing annotation handles and updates the resource by stable id", () => {
    const document = fixture();
    document.entities.push(
      createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "Tekst", height: 2.5, width: 40, styleId: "TXT-ISO" }),
      createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "Viide", textStyleId: "TXT-ISO" }),
    );
    const changes = applyTextStyle(document, "TXT-NARROW", ["T1", "L1"]);
    const session = new CadSession(document);
    session.commit({ opId: "style-apply", baseRevision: 0, commandId: "STYLE", args: {}, targetHandles: ["T1", "L1"], resultHandles: ["T1", "L1"] }, changes);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "T1", "L1"]);
    expect(session.document.entities.find((entity) => entity.handle === "T1")).toMatchObject({ styleId: "TXT-NARROW" });
    expect(readLeaderContract(session.document.entities.find((entity) => entity.handle === "L1")!)?.kind === "leader"
      ? (readLeaderContract(session.document.entities.find((entity) => entity.handle === "L1")!) as { content: { textStyleId?: string } }).content.textStyleId : undefined).toBe("TXT-NARROW");
    session.undo(); expect(session.document.entities).toEqual(document.entities);
    session.redo(); expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "T1", "L1"]);
    expect(updateTextStyle(session.document, { id: "TXT-NARROW", name: "Narrow", fontFamily: "Liberation Sans Narrow", widthFactor: 0.75, obliqueAngleRad: 0.1 })).toMatchObject({ textStyle: { id: "TXT-NARROW", widthFactor: 0.75 } });
  });
});

describe("F-059/F-060 LEADER and MLEADER contracts", () => {
  it("preserves arrow, landing, content, style references and associative handles", () => {
    const document = fixture();
    const leader = createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: -1, y: -1 }, { x: 20, y: 10 }], text: "Viide", contentPosition: { x: 28, y: 10 }, textStyleId: "TXT-ISO", textHeight: 2.5, arrowType: "open", arrowSize: 3, landingEnabled: true, landingLength: 8, anchor: { handle: "10", feature: "end", fallback: { x: 100, y: 40 } } });
    const mleader = createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: -1, y: -1 }, { x: 20, y: 10 }], text: "Märkus", textPosition: { x: 28, y: 10 }, styleId: "MLEADER-STD", textStyleId: "TXT-ISO", textHeight: 2.5, landingGap: 1.25, arrowType: "dot", arrowSize: 3.5, landingEnabled: true, landingLength: 8, anchor: { handle: "10", feature: "start", fallback: { x: 0, y: 0 } } });
    expect(readLeaderContract(leader)).toEqual(golden.leaderContract);
    expect(readLeaderContract(mleader)).toEqual(golden.mleaderContract);
    expect(leader.vertices[0]).toEqual({ x: 100, y: 40 });
    expect(mleader.vertices[0]).toEqual({ x: 0, y: 0 });
  });

  it("edits MLEADER content and geometry without losing either style reference or handle", () => {
    const document = fixture();
    document.entities.push(createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 10 }], text: "Märkus", textPosition: { x: 28, y: 10 }, styleId: "MLEADER-STD", textStyleId: "TXT-ISO", textHeight: 2.5 }));
    const change = editLeader(document, "ML1", { text: "Muudetud", arrowType: "open", landingLength: 12, textPosition: { x: 34, y: 11 } });
    expect(change).toMatchObject({ type: "put", entity: { handle: "ML1", text: "Muudetud" } });
    if (change.type !== "put") throw new Error("Expected MLEADER put change.");
    expect(readLeaderContract(change.entity)).toMatchObject({ kind: "mleader", styleId: "MLEADER-STD", textStyleId: "TXT-ISO", textPosition: { x: 34, y: 11 }, arrow: { type: "open" }, landing: { length: 12 } });
  });

  it("updates associative leader heads under stable handles and fails closed for orphaned/locked annotations", () => {
    const document = fixture();
    document.entities.push(createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 10 }], text: "Viide", anchor: { handle: "10", feature: "end", fallback: { x: 100, y: 40 } } }));
    document.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: 5, y: 6 }, end: { x: 125, y: 46 } };
    expect(updateAssociativeLeaders(document, ["10"])).toMatchObject({ updatedHandles: ["L1"], broken: [], changes: [{ entity: { handle: "L1", vertices: [{ x: 125, y: 46 }, { x: 20, y: 10 }] } }] });
    const orphan = structuredClone(document); orphan.entities = orphan.entities.filter((entity) => entity.handle !== "10");
    expect(updateAssociativeLeaders(orphan, ["10"])).toMatchObject({ changes: [], broken: [{ leaderHandle: "L1", targetHandle: "10" }] });
    expect(evaluateTextAnnotationCapability(orphan, "L1")).toEqual({ executable: false, code: "orphan-association", handle: "10" });
    document.layers[0]!.locked = true;
    expect(evaluateTextAnnotationCapability(document, "L1")).toEqual({ executable: false, code: "locked-layer", handle: "0" });
    expect(() => updateAssociativeLeaders(document, ["10"])).toThrow(/locked/u);
  });

  it("batches geometry plus multiple leader refreshes into one Undo/Redo step", () => {
    const document = fixture();
    document.entities.push(
      createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 10 }], anchor: { handle: "10", feature: "start", fallback: { x: 0, y: 0 } } }),
      createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 100, y: 40 }, { x: 30, y: 15 }], text: "M", textPosition: { x: 35, y: 15 }, styleId: "MLS", textHeight: 2.5, anchor: { handle: "10", feature: "end", fallback: { x: 100, y: 40 } } }),
    );
    const moved: CadEntity = { kind: "line", handle: "10", layerId: "0", start: { x: 7, y: 8 }, end: { x: 130, y: 50 } };
    const staged = structuredClone(document); staged.entities[0] = moved;
    const associations = updateAssociativeAnnotations(staged, ["10"]);
    expect(associations.updatedHandles).toEqual(["L1", "ML1"]);
    const session = new CadSession(document);
    session.commit({ opId: "move-leaders", baseRevision: 0, commandId: "MOVE", args: {}, targetHandles: ["10", "L1", "ML1"], resultHandles: ["10", "L1", "ML1"] }, [{ type: "put", entity: moved }, ...associations.changes]);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.find((entity) => entity.handle === "L1")).toMatchObject({ handle: "L1", vertices: [{ x: 7, y: 8 }, { x: 20, y: 10 }] });
    expect(session.document.entities.find((entity) => entity.handle === "ML1")).toMatchObject({ handle: "ML1", vertices: [{ x: 130, y: 50 }, { x: 30, y: 15 }] });
    session.undo(); expect(session.document.entities).toEqual(document.entities);
    session.redo(); expect(session.document.entities.find((entity) => entity.handle === "ML1")?.handle).toBe("ML1");
  });

  it("rejects invalid handles, styles, paragraph contracts and locked-layer creation without mutation", () => {
    const document = fixture(); const before = structuredClone(document);
    expect(() => createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], anchor: { handle: "MISSING", feature: "start", fallback: { x: 0, y: 0 } } })).toThrow(/orphan/iu);
    expect(() => createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "A\nB", height: 2.5, width: 20, paragraphs: [{ id: "P1", alignment: "left" }] })).toThrow(/one paragraph/u);
    expect(() => applyTextStyle(document, "MISSING", ["10"])).toThrow(/Unknown text style/u);
    expect(() => createMText(document, { handle: "10", layerId: "0", position: { x: 0, y: 0 }, text: "Duplicate", height: 2.5, width: 20 })).toThrow(/Duplicate entity handle/u);
    const orphanStyle = fixture(); orphanStyle.entities.push(createMText(orphanStyle, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "Styled", height: 2.5, width: 20, styleId: "TXT-ISO" })); orphanStyle.textStyles = [];
    expect(evaluateTextAnnotationCapability(orphanStyle, "T1")).toEqual({ executable: false, code: "orphan-style", handle: "TXT-ISO" });
    expect(evaluateTextAnnotationCapability(document, "MISSING")).toEqual({ executable: false, code: "missing-annotation", handle: "MISSING" });
    document.layers[0]!.locked = true;
    expect(() => createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: "M", textPosition: { x: 2, y: 1 }, styleId: "MLS", textHeight: 2.5 })).toThrow(/locked/u);
    expect({ ...document, layers: before.layers }).toEqual(before);
  });
});
