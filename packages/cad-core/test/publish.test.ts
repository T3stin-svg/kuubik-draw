import { describe, expect, it } from "vitest";
import { createF105Document, F105_LAYOUT_IDS } from "../../../parity/fixtures/f105-document.js";
import {
  buildLayoutPublishPlan,
  CadSession,
  LAYOUT_PUBLISH_EXTENSION_KEY,
  LayoutPublishSettingsError,
  metadataWithLayoutPublishSettings,
  resolveLayoutPublishSettings,
  sanitizePdfFileStem,
} from "../src/index.js";

describe("layout publish settings", () => {
  it("defaults to every paper layout in document order and produces deterministic file names", () => {
    const document = createF105Document();
    const settings = resolveLayoutPublishSettings(document);
    expect(settings).toEqual({
      schemaVersion: 1,
      sheets: F105_LAYOUT_IDS.map((layoutId) => ({ layoutId, included: true })),
      output: "multi-page",
      baseFileName: "F-105 Publish Set",
    });
    expect(buildLayoutPublishPlan(document, settings)).toMatchObject({
      layoutIds: [...F105_LAYOUT_IDS],
      multiPageFileName: "F-105 Publish Set.pdf",
      separateFiles: [
        { layoutId: F105_LAYOUT_IDS[0], fileName: "F-105 Publish Set-F-105 SHEET 10 SECTION.pdf" },
        { layoutId: F105_LAYOUT_IDS[1], fileName: "F-105 Publish Set-F-105 SHEET 20 PLAN.pdf" },
      ],
    });
  });

  it("persists ordered include/exclude/output settings as one atomic undoable metadata operation", () => {
    const session = new CadSession(createF105Document());
    const settings = resolveLayoutPublishSettings(session.document);
    settings.sheets.reverse();
    settings.sheets[1]!.included = false;
    settings.output = "separate";
    settings.baseFileName = "F105 ordered";
    session.commit({ opId: "publish-1", baseRevision: 0, commandId: "PUBLISH_SET", args: settings, targetHandles: [], resultHandles: [] }, [
      metadataWithLayoutPublishSettings(session.document, settings),
    ], "2026-08-28T00:00:00.000Z");
    expect(resolveLayoutPublishSettings(session.document)).toEqual(settings);
    expect(buildLayoutPublishPlan(session.document).layoutIds).toEqual([F105_LAYOUT_IDS[1]]);
    session.undo("2026-08-28T00:00:01.000Z");
    expect(session.document.metadata.extensions?.[LAYOUT_PUBLISH_EXTENSION_KEY]).toBeUndefined();
    session.redo("2026-08-28T00:00:02.000Z");
    expect(resolveLayoutPublishSettings(session.document)).toEqual(settings);
  });

  it("repairs added/deleted layout membership but rejects corrupt settings and empty publish sets", () => {
    const document = createF105Document();
    document.metadata.extensions = { [LAYOUT_PUBLISH_EXTENSION_KEY]: {
      schemaVersion: 1, output: "multi-page", baseFileName: "F105",
      sheets: [{ layoutId: F105_LAYOUT_IDS[0], included: false }, { layoutId: "deleted-layout", included: true }],
    } };
    expect(resolveLayoutPublishSettings(document).sheets).toEqual([
      { layoutId: F105_LAYOUT_IDS[0], included: false }, { layoutId: F105_LAYOUT_IDS[1], included: true },
    ]);
    const none = resolveLayoutPublishSettings(createF105Document()); none.sheets.forEach((sheet) => { sheet.included = false; });
    expect(() => buildLayoutPublishPlan(createF105Document(), none)).toThrow(LayoutPublishSettingsError);
    const incomplete = resolveLayoutPublishSettings(createF105Document()); incomplete.sheets.pop();
    expect(() => buildLayoutPublishPlan(createF105Document(), incomplete)).toThrow(/every current paper layout/u);
    document.metadata.extensions[LAYOUT_PUBLISH_EXTENSION_KEY] = { schemaVersion: 1, output: "zip" };
    expect(() => resolveLayoutPublishSettings(document)).toThrow(/invalid/u);
  });

  it("sanitizes Windows device names, code points and component length before suffixing collisions", () => {
    expect(sanitizePdfFileStem('  A<B>:C?.  ')).toBe("A-B-C-");
    expect(sanitizePdfFileStem("CON")).toBe("_CON");
    expect(sanitizePdfFileStem("nul.txt")).toBe("_nul.txt");
    expect(sanitizePdfFileStem(`${"a".repeat(179)}😀`)).toBe("a".repeat(179));
    const document = createF105Document();
    document.metadata.title = "b".repeat(180);
    document.layouts[1]!.name = `${"x".repeat(178)} A`;
    document.layouts[2]!.name = `${"x".repeat(178)}  A`;
    const plan = buildLayoutPublishPlan(document);
    expect(plan.separateFiles[0]!.fileName.length).toBeLessThanOrEqual(255);
    expect(plan.separateFiles[1]!.fileName.length).toBeLessThanOrEqual(255);
    expect(plan.separateFiles[1]!.fileName).toMatch(/-2\.pdf$/u);
    expect(plan.separateFiles.every((file) => !/[. ]\.pdf$/u.test(file.fileName))).toBe(true);
    expect(plan.separateFiles.every((file) => !file.fileName.includes("\uFFFD"))).toBe(true);
  });

  it("validates and persists a per-layout captured Display window", () => {
    const document = createF105Document();
    const settings = resolveLayoutPublishSettings(document);
    settings.sheets[0]!.displayWindow = { x: -25, y: -40, width: 300, height: 400 };
    const changed = metadataWithLayoutPublishSettings(document, settings);
    expect(resolveLayoutPublishSettings({ ...document, metadata: changed.metadata }).sheets[0]!.displayWindow).toEqual({ x: -25, y: -40, width: 300, height: 400 });
    settings.sheets[0]!.displayWindow = { x: 0, y: 0, width: 0, height: 1 };
    expect(() => metadataWithLayoutPublishSettings(document, settings)).toThrow(/finite and positive/u);
  });
});
