import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { CadPageSetup, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createF106Document } from "../parity/fixtures/f106-document.js";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
type Rect = { x: number; y: number; width: number; height: number };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function seedLocalDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
  await page.goto("/d/local");
  await page.evaluate(async (value) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const transaction = database.transaction(["documents", "operations", "snapshots"], "readwrite");
      transaction.objectStore("documents").put(value);
      transaction.objectStore("operations").clear();
      transaction.objectStore("snapshots").clear();
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => rejectWrite(transaction.error);
    });
    database.close();
  }, document);
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readLocalDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const value = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return value as KDrawDocumentV1;
  });
}

async function download(page: Page, name: string): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const result = await pending;
  const path = await result.path();
  expect(path).not.toBeNull();
  return { download: result, bytes: await readFile(path!) };
}

function pdfPlacement(bytes: Buffer): { destination: Rect; source: Rect; scaleFactor: number } {
  const text = bytes.toString("latin1");
  const match = text.match(/\nq ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) re W n ([-+0-9.]+) 0 0 ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) cm/u);
  if (!match) throw new Error("Model PDF placement operator is missing.");
  const mmToPt = 72 / 25.4;
  const destination = { x: Number(match[1]) / mmToPt, y: Number(match[2]) / mmToPt, width: Number(match[3]) / mmToPt, height: Number(match[4]) / mmToPt };
  const scaleFactor = Number(match[5]) / mmToPt;
  return {
    destination,
    scaleFactor,
    source: {
      x: (destination.x - Number(match[7]) / mmToPt) / scaleFactor,
      y: (destination.y - Number(match[8]) / mmToPt) / scaleFactor,
      width: destination.width / scaleFactor,
      height: destination.height / scaleFactor,
    },
  };
}

function pdfSummary(bytes: Buffer) {
  const text = bytes.toString("latin1");
  return {
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    a4Portrait: text.includes("/MediaBox [0 0 595.275591 841.889764]"),
    a3Landscape: text.includes("/MediaBox [0 0 1190.551181 841.889764]"),
    title: text.includes("(F-106 MODEL 1:50) Tj"),
    images: (text.match(/\/Subtype \/Image\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
  };
}

// PDF operands are rounded to six decimals; reconstructing source coordinates
// through a 1:50/1:100 transform amplifies that harmless rounding.
function expectRect(actual: Rect, expected: Rect, tolerance = 0.2): void {
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(tolerance);
}

async function applySetup(page: Page, setup: {
  media: string; orientation: string; area: "window" | "extents" | "display"; scale: "custom" | "fit";
  denominator?: string; center: boolean; offset?: { x: string; y: string }; window?: Rect;
}): Promise<void> {
  await page.getByRole("combobox", { name: "Model paper media" }).selectOption(setup.media);
  await page.getByRole("combobox", { name: "Model paper orientation" }).selectOption(setup.orientation);
  await page.getByRole("combobox", { name: "Model plot area" }).selectOption(setup.area);
  await page.getByRole("combobox", { name: "Model plot scale mode" }).selectOption(setup.scale);
  if (setup.denominator) await page.getByRole("textbox", { name: "Model plot scale denominator" }).fill(setup.denominator);
  const center = page.getByRole("checkbox", { name: "Model center plot" });
  if ((await center.isChecked()) !== setup.center) await center.click();
  if (!setup.center && setup.offset) {
    await page.getByRole("textbox", { name: "Model plot offset X" }).fill(setup.offset.x);
    await page.getByRole("textbox", { name: "Model plot offset Y" }).fill(setup.offset.y);
  }
  if (setup.window) {
    await page.getByRole("textbox", { name: "Model plot window X" }).fill(String(setup.window.x));
    await page.getByRole("textbox", { name: "Model plot window Y" }).fill(String(setup.window.y));
    await page.getByRole("textbox", { name: "Model plot window width" }).fill(String(setup.window.width));
    await page.getByRole("textbox", { name: "Model plot window height" }).fill(String(setup.window.height));
  }
  await page.getByRole("button", { name: "Rakenda model page setup" }).click();
  await expect(page.getByTestId("model-page-setup-controls")).toHaveAttribute("data-plot-area", setup.area);
}

async function measuredDisplayWindow(page: Page): Promise<Rect> {
  return page.getByLabel("Kuubik Draw joonestusala").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixelsPerUnit = Math.min(canvas.clientWidth / 3000, canvas.clientHeight / 3000);
    const width = canvas.clientWidth / pixelsPerUnit; const height = canvas.clientHeight / pixelsPerUnit;
    const round = (value: number) => Number(value.toFixed(6));
    return { x: round(1000 - width / 2), y: round(1000 - height / 2), width: round(width), height: round(height) };
  });
}

test("F-106 persists and plots Model Extents, Window and Display as physical vector outputs", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-29T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF106Document("local"));
  const controls = page.getByTestId("model-page-setup-controls");
  await expect(controls).toHaveAttribute("data-media", "ISO_A4");
  await expect(controls).toHaveAttribute("data-orientation", "portrait");
  await expect(controls).toHaveAttribute("data-plot-area", "extents");
  await expect(controls).toHaveAttribute("data-plot-scale", "50");
  await expect(controls).toHaveAttribute("data-center-plot", "true");

  const extentsPdf = await download(page, "Ekspordi model PDF");
  const extentsSvg = await download(page, "Ekspordi model SVG");
  expect(extentsPdf.download.suggestedFilename()).toBe("local-Model.pdf");
  expect(extentsSvg.download.suggestedFilename()).toBe("local-Model.svg");
  expect(pdfSummary(extentsPdf.bytes)).toEqual({ pages: 1, a4Portrait: true, a3Landscape: false, title: true, images: 0, eof: true });
  const extentsPlacement = pdfPlacement(extentsPdf.bytes);
  expectRect(extentsPlacement.source, { x: 1000, y: 2000, width: 4000, height: 11250 });
  expectRect(extentsPlacement.destination, { x: 65, y: 36, width: 80, height: 225 }, 0.001);
  expect(Math.abs(extentsPlacement.scaleFactor - 0.02)).toBeLessThan(1e-6);
  const svgText = extentsSvg.bytes.toString("utf8");
  expect(svgText).toContain('width="210mm" height="297mm"');
  expect(svgText).toContain('data-model-space-plot="true"');
  expect(svgText).toContain('data-plot-area="extents"');
  expect(svgText).toContain("F-106 MODEL 1:50");
  expect(svgText).not.toContain("<image");

  const plotWindow = { x: -100, y: 200, width: 8000, height: 5000 };
  await page.getByRole("textbox", { name: "Model plot scale denominator" }).fill("not-a-number");
  await applySetup(page, { media: "ISO_A3", orientation: "landscape", area: "window", scale: "fit", center: false, offset: { x: "4", y: "6" }, window: plotWindow });
  await expect(controls).toHaveAttribute("data-paper", "420,297");
  await expect(controls).toHaveAttribute("data-plot-scale", "fit");
  await expect(controls).toHaveAttribute("data-plot-origin", "4,6");
  const windowPdf = await download(page, "Ekspordi model PDF");
  expect(pdfSummary(windowPdf.bytes)).toMatchObject({ pages: 1, a3Landscape: true, images: 0, eof: true });
  const windowPlacement = pdfPlacement(windowPdf.bytes);
  expectRect(windowPlacement.source, plotWindow);
  expectRect(windowPlacement.destination, { x: 14, y: 16, width: 400, height: 250 }, 0.001);
  expect(Math.abs(windowPlacement.scaleFactor - 0.05)).toBeLessThan(1e-6);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(controls).toHaveAttribute("data-plot-area", "extents");
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(controls).toHaveAttribute("data-plot-area", "window");

  await applySetup(page, { media: "ISO_A4", orientation: "portrait", area: "display", scale: "custom", denominator: "100", center: true });
  const displayWindow = await measuredDisplayWindow(page);
  const displayPdf = await download(page, "Ekspordi model PDF");
  const displayPlacement = pdfPlacement(displayPdf.bytes);
  expectRect(displayPlacement.source, displayWindow);
  expect(Math.abs(displayPlacement.scaleFactor - 0.01)).toBeLessThan(1e-6);
  expect(pdfSummary(displayPdf.bytes)).toMatchObject({ pages: 1, a4Portrait: true, images: 0, eof: true });

  const stored = await readLocalDocument(page);
  const setup = stored.layouts[0]!.pageSetup as CadPageSetup;
  expect(stored.revision).toBe(4);
  expect(setup).toMatchObject({ mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "display" }, plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 100 }, centerPlot: true });
  await page.reload();
  await expect(page.getByText("Taastatud revision 4")).toBeVisible();
  await expect(controls).toHaveAttribute("data-plot-area", "display");
  await expect(controls).toHaveAttribute("data-plot-scale", "100");
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await controls.screenshot({ path: resolve(captureDir, "F-106-browser-model-controls.png") });
    await Promise.all([
      writeFile(resolve(captureDir, "F-106-browser-extents.pdf"), extentsPdf.bytes),
      writeFile(resolve(captureDir, "F-106-browser-extents.svg"), extentsSvg.bytes),
      writeFile(resolve(captureDir, "F-106-browser-window.pdf"), windowPdf.bytes),
      writeFile(resolve(captureDir, "F-106-browser-display.pdf"), displayPdf.bytes),
    ]);
    await writeFile(resolve(captureDir, "F-106-browser-matrix.json"), `${JSON.stringify({
      schemaVersion: 1, rowId: "F-106", status: "PASS", viewport: { width: 1920, height: 1080 },
      workflow: "Model Extents A4 fixed 1:50 centered -> Window A3 Fit offset -> atomic Undo/Redo -> Display A4 fixed 1:100 centered -> IndexedDB reload",
      outputs: {
        extents: { bytes: extentsPdf.bytes.byteLength, sha256: sha256(extentsPdf.bytes), summary: pdfSummary(extentsPdf.bytes), placement: extentsPlacement },
        svg: { bytes: extentsSvg.bytes.byteLength, sha256: sha256(extentsSvg.bytes) },
        window: { bytes: windowPdf.bytes.byteLength, sha256: sha256(windowPdf.bytes), summary: pdfSummary(windowPdf.bytes), placement: windowPlacement },
        display: { bytes: displayPdf.bytes.byteLength, sha256: sha256(displayPdf.bytes), summary: pdfSummary(displayPdf.bytes), placement: displayPlacement },
      },
      displayWindow, storedRevision: stored.revision, storedPageSetup: setup, consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});

test("F-106 reports an empty Extents plot without a download or page error", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, { ...createF106Document("local"), entities: [] });

  await page.getByRole("button", { name: "Ekspordi model PDF" }).click();
  await expect(page.getByText(/Model PDF viga:.*no printable model-space geometry/u)).toBeVisible();
  await page.getByRole("button", { name: "Ekspordi model SVG" }).click();
  await expect(page.getByText(/Model SVG viga:.*no printable model-space geometry/u)).toBeVisible();
  expect(errors).toEqual([]);
});
