import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { createEmptyDocument, createPaperLayout } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

type RecordedOperation = { commandId: string; baseRevision: number };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function pageSetupDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: 100, y: 0 } });
  const created = createPaperLayout(document, {
    name: "F102 PAGE SETUP",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [{
      id: "viewport-f102", center: { x: 210, y: 148.5 }, width: 390, height: 267,
      viewCenter: { x: 0, y: 0 }, viewHeight: 5340, twistAngleRad: 0, locked: true,
    }],
    entities: [{ kind: "line", handle: "20", layerId: "0", start: { x: 10, y: 20 }, end: { x: 190, y: 270 } }],
  });
  document.layouts = created.layouts;
  return document;
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

async function readDocument(page: Page): Promise<KDrawDocumentV1> {
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

async function readOperations(page: Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const values = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return values.sort((a, b) => a.revision - b.revision).map((entry) => entry.operation);
  });
}

async function downloadedBytes(page: Page, buttonName: string): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await pending; const path = await download.path();
  expect(path).not.toBeNull();
  return { download, bytes: await readFile(path!) };
}

function independentPdfSummary(bytes: Buffer) {
  const text = bytes.toString("latin1");
  const media = text.match(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/u);
  const xref = text.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
  const offsetsValid = xref ? xref[2]!.trim().split("\n").slice(1).every((line, index) => text.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false;
  const outerTransform = text.match(/\nq ([-+0-9.]+) 0 0 ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) cm/u);
  const paperLine = [...text.matchAll(/([-+0-9.]+) ([-+0-9.]+) m ([-+0-9.]+) ([-+0-9.]+) l S/gu)]
    .toSorted((a, b) => Math.abs(Number(b[4]) - Number(b[2])) - Math.abs(Number(a[4]) - Number(a[2])))[0] ?? null;
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    mediaBoxPt: media ? { width: Number(media[1]), height: Number(media[2]) } : null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    strokeCommands: (text.match(/\bS\b/gu) ?? []).length,
    xrefOffsetsValid: offsetsValid,
    paperLineDeltaMm: outerTransform && paperLine ? {
      x: Math.abs((Number(paperLine[3]) - Number(paperLine[1])) * Number(outerTransform[1])) * 25.4 / 72,
      y: Math.abs((Number(paperLine[4]) - Number(paperLine[2])) * Number(outerTransform[2])) * 25.4 / 72,
    } : null,
  };
}

test("F-102 applies/persists Page Setup, preserves viewport paper coordinates and emits physical SVG/PDF", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, pageSetupDocument());
  await page.getByRole("button", { name: "F102 PAGE SETUP", exact: true }).click();
  const sheet = page.getByTestId("paper-space-sheet"); const viewport = page.locator('[data-viewport-id="viewport-f102"]');
  await expect(sheet).toHaveAttribute("data-paper-width-mm", "420");
  await expect(sheet).toHaveAttribute("data-page-orientation", "landscape");
  const initial = await viewport.evaluate((element) => ({
    center: (element as HTMLElement).dataset.frameCenter,
    width: Number((element as HTMLElement).dataset.frameWidth),
    height: Number((element as HTMLElement).dataset.frameHeight),
  }));
  expect(initial).toEqual({ center: "210,148.5", width: 390, height: 267 });

  await page.getByLabel("Paper media").selectOption("ISO_A4");
  await page.getByLabel("Paper orientation").selectOption("portrait");
  await page.getByLabel("Plot area").selectOption("window");
  await page.getByLabel("Plot scale mode").selectOption("custom");
  await page.getByLabel("Plot scale denominator").fill("2");
  await page.getByLabel("Plot offset X").fill("0");
  await page.getByLabel("Plot offset Y").fill("0");
  await page.getByLabel("Plot window X").fill("10");
  await page.getByLabel("Plot window Y").fill("20");
  await page.getByLabel("Plot window width").fill("180");
  await page.getByLabel("Plot window height").fill("250");
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(1);
  await expect(sheet).toHaveAttribute("data-paper-width-mm", "210");
  await expect(sheet).toHaveAttribute("data-paper-height-mm", "297");
  await expect(sheet).toHaveAttribute("data-plot-area", "window");
  await expect(sheet).toHaveAttribute("data-plot-scale", "2");
  const configured = await viewport.evaluate((element) => ({
    center: (element as HTMLElement).dataset.frameCenter,
    width: Number((element as HTMLElement).dataset.frameWidth),
    height: Number((element as HTMLElement).dataset.frameHeight),
  }));
  expect(configured).toEqual({ center: "210,148.5", width: 390, height: 267 });

  const svgDownload = await downloadedBytes(page, "Ekspordi layout SVG");
  const svgText = svgDownload.bytes.toString("utf8");
  expect(svgDownload.download.suggestedFilename()).toBe("local-F102 PAGE SETUP.svg");
  expect(svgText).toContain('width="210mm" height="297mm"');
  expect(svgText).toContain('data-source="10,20,180,250"');
  expect(svgText).toContain('data-destination="10,10,90,125"');
  const pdfDownload = await downloadedBytes(page, "Ekspordi layout PDF");
  const pdfSummary = independentPdfSummary(pdfDownload.bytes);
  expect(pdfDownload.download.suggestedFilename()).toBe("local-F102 PAGE SETUP.pdf");
  expect(pdfSummary).toEqual({
    version: "1.4", mediaBoxPt: { width: 595.275591, height: 841.889764 }, pages: 1, strokeCommands: 2, xrefOffsetsValid: true,
    paperLineDeltaMm: { x: 90.0000105, y: 125.00001458333334 },
  });
  const kdrawDownload = await downloadedBytes(page, "KDraw eksport");
  expect(kdrawDownload.bytes.toString("utf8").startsWith("KDRAW1\n")).toBe(true);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-paper-width-mm", "420");
  await expect(viewport).toHaveAttribute("data-frame-width", "390");
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-paper-width-mm", "210");
  await expect(viewport).toHaveAttribute("data-frame-width", "390");

  await page.getByLabel("Plot area").selectOption("extents");
  await page.getByLabel("Plot scale mode").selectOption("fit");
  await page.getByLabel("Center plot").check();
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(4);
  await expect(sheet).toHaveAttribute("data-plot-area", "extents");
  await expect(sheet).toHaveAttribute("data-plot-scale", "fit");
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-center-plot", "true");

  await page.getByLabel("Plot area").selectOption("window");
  await page.getByLabel("Plot scale mode").selectOption("custom");
  await page.getByLabel("Plot scale denominator").fill("2");
  await page.getByLabel("Center plot").uncheck();
  await page.getByLabel("Plot offset X").fill("0");
  await page.getByLabel("Plot offset Y").fill("0");
  await page.getByLabel("Plot window X").fill("-25");
  await page.getByLabel("Plot window Y").fill("-40");
  await page.getByLabel("Plot window width").fill("300");
  await page.getByLabel("Plot window height").fill("400");
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(5);
  const outsideWindow = (await readDocument(page)).layouts[1]!.pageSetup;
  expect(outsideWindow?.plotArea).toEqual({ kind: "window", window: { x: -25, y: -40, width: 300, height: 400 } });

  await page.getByLabel("Plot area").selectOption("display");
  await page.getByLabel("Plot scale mode").selectOption("fit");
  await page.getByLabel("Center plot").check();
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(6);
  await expect(sheet).toHaveAttribute("data-plot-area", "display");
  const visibleDisplaySource = await page.evaluate(() => {
    const desk = document.querySelector<HTMLElement>('[data-testid="paper-space-desk"]');
    const paper = document.querySelector<HTMLElement>('[data-testid="paper-space-sheet"]');
    if (!desk || !paper) throw new Error("Visible paper-space geometry is missing.");
    const deskRect = desk.getBoundingClientRect(); const paperRect = paper.getBoundingClientRect();
    const deskLeft = deskRect.left + desk.clientLeft; const deskTop = deskRect.top + desk.clientTop;
    const paperLeft = paperRect.left + paper.clientLeft; const paperTop = paperRect.top + paper.clientTop;
    const scale = ((paper.clientWidth / 210) + (paper.clientHeight / 297)) / 2;
    const round = (value: number) => Number(value.toFixed(6));
    return {
      x: round((deskLeft - paperLeft) / scale),
      y: round((paperTop + paper.clientHeight - (deskTop + desk.clientHeight)) / scale),
      width: round(desk.clientWidth / scale), height: round(desk.clientHeight / scale),
    };
  });
  const displaySvgDownload = await downloadedBytes(page, "Ekspordi layout SVG");
  const displaySvg = displaySvgDownload.bytes.toString("utf8");
  expect(displaySvg).toContain('data-plot-area="display"');
  const displaySourceValues = displaySvg.match(/data-source="([^"]+)"/u)?.[1]?.split(",").map(Number);
  expect(displaySourceValues?.length).toBe(4);
  const displaySource = { x: displaySourceValues![0]!, y: displaySourceValues![1]!, width: displaySourceValues![2]!, height: displaySourceValues![3]! };
  expect(displaySource).toEqual(visibleDisplaySource);
  expect(displaySource.width).toBeGreaterThan(210);
  expect(displaySource.height).toBeGreaterThan(297);
  const displaySvgTransform = displaySvg.match(/<g transform="translate\([^)]*\) scale\(([-+0-9.]+) ([-+0-9.]+)\) translate\([^)]*\)">/u);
  const displaySvgPaperLine = displaySvg.match(/<line data-handle="20"[^>]*x1="([-+0-9.]+)" y1="([-+0-9.]+)" x2="([-+0-9.]+)" y2="([-+0-9.]+)"\/>/u);
  expect(displaySvgTransform).not.toBeNull(); expect(displaySvgPaperLine).not.toBeNull();
  const displaySvgLineDeltaMm = {
    x: Math.abs((Number(displaySvgPaperLine![3]) - Number(displaySvgPaperLine![1])) * Number(displaySvgTransform![1])),
    y: Math.abs((Number(displaySvgPaperLine![4]) - Number(displaySvgPaperLine![2])) * Number(displaySvgTransform![2])),
  };
  const displayPdfDownload = await downloadedBytes(page, "Ekspordi layout PDF");
  const displayPdfSummary = independentPdfSummary(displayPdfDownload.bytes);
  expect(displayPdfSummary.pages).toBe(1);
  expect(displayPdfSummary.xrefOffsetsValid).toBe(true);
  expect(displayPdfSummary.paperLineDeltaMm?.x).toBeGreaterThan(40);
  expect(displayPdfSummary.paperLineDeltaMm?.y).toBeGreaterThan(55);
  expect(displayPdfSummary.paperLineDeltaMm?.x).toBeCloseTo(displaySvgLineDeltaMm.x, 3);
  expect(displayPdfSummary.paperLineDeltaMm?.y).toBeCloseTo(displaySvgLineDeltaMm.y, 3);

  await page.getByLabel("Paper media").selectOption("ISO_A3");
  await page.getByLabel("Paper orientation").selectOption("landscape");
  await page.getByLabel("Plot area").selectOption("layout");
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(7);
  await expect(sheet).toHaveAttribute("data-paper-width-mm", "420");
  await expect(sheet).toHaveAttribute("data-paper-height-mm", "297");
  await expect(sheet).toHaveAttribute("data-plot-area", "layout");
  await expect(sheet).toHaveAttribute("data-plot-scale", "1");
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-center-plot", "false");

  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual(["PAGESETUP", "UNDO", "PAGESETUP", "PAGESETUP", "PAGESETUP", "PAGESETUP", "PAGESETUP"]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  await page.reload();
  await expect(page.getByText("Taastatud revision 7")).toBeVisible();
  await page.getByRole("button", { name: "F102 PAGE SETUP", exact: true }).click();
  await expect(page.getByTestId("paper-space-sheet")).toHaveAttribute("data-paper-width-mm", "420");
  const stored = await readDocument(page);
  expect(stored.layouts[1]!.pageSetup).toEqual({
    mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
    plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
    displayPlotStyles: false,
  });
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR); await mkdir(captureDir, { recursive: true });
    await writeFile(resolve(captureDir, "F-102-browser-page-setup.svg"), svgDownload.bytes);
    await writeFile(resolve(captureDir, "F-102-browser-page-setup.pdf"), pdfDownload.bytes);
    await writeFile(resolve(captureDir, "F-102-browser-page-setup.kdraw"), kdrawDownload.bytes);
    await writeFile(resolve(captureDir, "F-102-browser-display.svg"), displaySvgDownload.bytes);
    await writeFile(resolve(captureDir, "F-102-browser-display.pdf"), displayPdfDownload.bytes);
    await writeFile(resolve(captureDir, "F-102-browser-page-setup.json"), `${JSON.stringify({
      schemaVersion: 1, rowId: "F-102", status: "PASS", viewport: { width: 1920, height: 1080 },
      action: "A3 Layout -> A4 portrait Window 1:2 -> physical outputs -> undo/redo -> Extents Fit Center -> out-of-sheet Window -> Display current paper view -> restore A3 Layout 1:1 -> reload",
      initial, configured,
      window: { paper: { widthMm: 210, heightMm: 297 }, source: { x: 10, y: 20, width: 180, height: 250 }, destination: { x: 10, y: 10, width: 90, height: 125 } },
      outsideWindow: outsideWindow?.plotArea,
      display: {
        plotArea: "display", source: displaySource, visibleSource: visibleDisplaySource,
        svg: { bytes: displaySvgDownload.bytes.byteLength, sha256: createHash("sha256").update(displaySvgDownload.bytes).digest("hex"), paperLineDeltaMm: displaySvgLineDeltaMm },
        pdf: { bytes: displayPdfDownload.bytes.byteLength, sha256: createHash("sha256").update(displayPdfDownload.bytes).digest("hex"), summary: displayPdfSummary },
      },
      svg: { bytes: svgDownload.bytes.byteLength, sha256: createHash("sha256").update(svgDownload.bytes).digest("hex") },
      pdf: { bytes: pdfDownload.bytes.byteLength, sha256: createHash("sha256").update(pdfDownload.bytes).digest("hex"), summary: pdfSummary },
      kdraw: { bytes: kdrawDownload.bytes.byteLength, sha256: createHash("sha256").update(kdrawDownload.bytes).digest("hex") },
      operations, restored: stored.layouts[1], documentRevision: stored.revision, consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
