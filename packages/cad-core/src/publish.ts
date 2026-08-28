import type { CadDocumentMetadata, CadPaperRect, KDrawDocumentV1 } from "@kuubik/cad-schema";

export const LAYOUT_PUBLISH_EXTENSION_KEY = "kuubikDraw.layoutPublish.v1";

export type LayoutPublishOutput = "multi-page" | "separate";

export interface LayoutPublishSheet {
  layoutId: string;
  included: boolean;
  /** Captured paper-space Display source for layouts published while inactive. */
  displayWindow?: CadPaperRect;
}

export interface LayoutPublishSettingsV1 {
  schemaVersion: 1;
  sheets: LayoutPublishSheet[];
  output: LayoutPublishOutput;
  baseFileName: string;
}

export type LayoutPublishSettingsErrorCode = "INVALID_SETTINGS" | "INVALID_FILENAME" | "MISSING_LAYOUT" | "NO_LAYOUTS";

export class LayoutPublishSettingsError extends Error {
  constructor(readonly code: LayoutPublishSettingsErrorCode, message: string) {
    super(message);
    this.name = "LayoutPublishSettingsError";
  }
}

function paperLayoutIds(document: KDrawDocumentV1): string[] {
  return document.layouts.filter((layout) => layout.kind === "paper").map((layout) => layout.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const WINDOWS_DEVICE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const MAX_PDF_COMPONENT_CODE_UNITS = 255;
const PDF_EXTENSION = ".pdf";

function truncateCodePointSafe(value: string, maxCodeUnits: number): string {
  let result = "";
  for (const codePoint of value) {
    if (result.length + codePoint.length > maxCodeUnits) break;
    result += codePoint;
  }
  return result;
}

function safeStem(value: string, maxCodeUnits: number): string {
  let sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  if (!sanitized) throw new LayoutPublishSettingsError("INVALID_FILENAME", "Publish file name must contain a usable character.");
  sanitized = truncateCodePointSafe(sanitized, maxCodeUnits).replace(/[. ]+$/gu, "");
  if (!sanitized) throw new LayoutPublishSettingsError("INVALID_FILENAME", "Publish file name must contain a usable character.");
  if (WINDOWS_DEVICE_STEM.test(sanitized)) sanitized = `_${sanitized}`;
  return truncateCodePointSafe(sanitized, maxCodeUnits).replace(/[. ]+$/gu, "");
}

export function sanitizePdfFileStem(value: string): string {
  return safeStem(value, 180);
}

function defaultSettings(document: KDrawDocumentV1): LayoutPublishSettingsV1 {
  return {
    schemaVersion: 1,
    sheets: paperLayoutIds(document).map((layoutId) => ({ layoutId, included: true })),
    output: "multi-page",
    baseFileName: sanitizePdfFileStem(document.metadata.title?.trim() || document.documentId),
  };
}

function parseStoredSettings(value: unknown): LayoutPublishSettingsV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.sheets) ||
    (value.output !== "multi-page" && value.output !== "separate") || typeof value.baseFileName !== "string") {
    throw new LayoutPublishSettingsError("INVALID_SETTINGS", "Stored layout publish settings are invalid.");
  }
  const sheets = value.sheets.map((sheet): LayoutPublishSheet => {
    if (!isRecord(sheet) || typeof sheet.layoutId !== "string" || sheet.layoutId.length === 0 || typeof sheet.included !== "boolean") {
      throw new LayoutPublishSettingsError("INVALID_SETTINGS", "Every publish sheet requires a layout id and included state.");
    }
    let displayWindow: CadPaperRect | undefined;
    if (sheet.displayWindow !== undefined) {
      if (!isRecord(sheet.displayWindow)) throw new LayoutPublishSettingsError("INVALID_SETTINGS", "A captured Display window must be a rectangle.");
      const candidate = sheet.displayWindow;
      const values = [candidate.x, candidate.y, candidate.width, candidate.height];
      if (values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)) ||
        (candidate.width as number) <= 0 || (candidate.height as number) <= 0) {
        throw new LayoutPublishSettingsError("INVALID_SETTINGS", "A captured Display window must be finite and positive.");
      }
      displayWindow = { x: candidate.x as number, y: candidate.y as number, width: candidate.width as number, height: candidate.height as number };
    }
    return { layoutId: sheet.layoutId, included: sheet.included, ...(displayWindow ? { displayWindow } : {}) };
  });
  if (new Set(sheets.map((sheet) => sheet.layoutId)).size !== sheets.length) {
    throw new LayoutPublishSettingsError("INVALID_SETTINGS", "Publish sheet ids must be unique.");
  }
  return { schemaVersion: 1, sheets, output: value.output, baseFileName: sanitizePdfFileStem(value.baseFileName) };
}

function assertExactLayoutMembership(document: KDrawDocumentV1, settings: LayoutPublishSettingsV1): void {
  const expected = paperLayoutIds(document);
  const actual = settings.sheets.map((sheet) => sheet.layoutId);
  if (actual.length !== expected.length || new Set(actual).size !== expected.length || expected.some((layoutId) => !actual.includes(layoutId))) {
    throw new LayoutPublishSettingsError("MISSING_LAYOUT", "Publish set must contain every current paper layout exactly once.");
  }
}

export function resolveLayoutPublishSettings(document: KDrawDocumentV1): LayoutPublishSettingsV1 {
  const stored = document.metadata.extensions?.[LAYOUT_PUBLISH_EXTENSION_KEY];
  if (stored === undefined) return defaultSettings(document);
  const parsed = parseStoredSettings(stored);
  const currentIds = paperLayoutIds(document);
  const currentSet = new Set(currentIds);
  const surviving = parsed.sheets.filter((sheet) => currentSet.has(sheet.layoutId));
  const represented = new Set(surviving.map((sheet) => sheet.layoutId));
  return {
    ...parsed,
    sheets: [...surviving, ...currentIds.filter((layoutId) => !represented.has(layoutId)).map((layoutId) => ({ layoutId, included: true }))],
  };
}

export function metadataWithLayoutPublishSettings(
  document: KDrawDocumentV1,
  requested: LayoutPublishSettingsV1,
): { type: "set-metadata"; metadata: CadDocumentMetadata } {
  const parsed = parseStoredSettings(requested);
  assertExactLayoutMembership(document, parsed);
  return {
    type: "set-metadata",
    metadata: {
      ...structuredClone(document.metadata),
      extensions: {
        ...structuredClone(document.metadata.extensions ?? {}),
        [LAYOUT_PUBLISH_EXTENSION_KEY]: structuredClone(parsed),
      },
    },
  };
}

export interface LayoutPublishPlan {
  settings: LayoutPublishSettingsV1;
  layoutIds: string[];
  multiPageFileName: string;
  separateFiles: Array<{ layoutId: string; fileName: string }>;
}

export function buildLayoutPublishPlan(document: KDrawDocumentV1, settings = resolveLayoutPublishSettings(document)): LayoutPublishPlan {
  const normalized = parseStoredSettings(settings);
  assertExactLayoutMembership(document, normalized);
  const layouts = new Map(document.layouts.filter((layout) => layout.kind === "paper").map((layout) => [layout.id, layout]));
  const layoutIds = normalized.sheets.filter((sheet) => sheet.included).map((sheet) => sheet.layoutId);
  if (layoutIds.length === 0) throw new LayoutPublishSettingsError("NO_LAYOUTS", "At least one paper layout must be included in the publish set.");
  for (const layoutId of layoutIds) if (!layouts.has(layoutId)) throw new LayoutPublishSettingsError("MISSING_LAYOUT", `Publish layout not found: ${layoutId}`);
  const base = sanitizePdfFileStem(normalized.baseFileName);
  const used = new Set<string>();
  const separateFiles = layoutIds.map((layoutId) => {
    const layout = layouts.get(layoutId)!;
    const preferred = `${base}-${sanitizePdfFileStem(layout.name)}`;
    let collision = 1;
    let stem = safeStem(preferred, MAX_PDF_COMPONENT_CODE_UNITS - PDF_EXTENSION.length);
    while (used.has(stem.toLocaleLowerCase("en-US"))) {
      collision += 1;
      const suffix = `-${collision}`;
      stem = `${safeStem(preferred, MAX_PDF_COMPONENT_CODE_UNITS - PDF_EXTENSION.length - suffix.length)}${suffix}`;
    }
    used.add(stem.toLocaleLowerCase("en-US"));
    return { layoutId, fileName: `${stem}${PDF_EXTENSION}` };
  });
  return { settings: normalized, layoutIds, multiPageFileName: `${base}.pdf`, separateFiles };
}
