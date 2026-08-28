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

function plotStyleDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.layers[0]!.appearance = { color: "#ff0000", colorMethod: "aci", lineweightMm: 0.7 };
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 30 }, end: { x: 190, y: 30 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 20, y: 45 }, end: { x: 190, y: 45 }, appearance: { color: "#00ff00", colorMethod: "aci", lineweightMm: 0.35 } },
    { kind: "line", handle: "13", layerId: "0", start: { x: 20, y: 60 }, end: { x: 190, y: 60 }, appearance: { color: "#0a64dc", colorMethod: "trueColor", lineweightMm: 0 } },
    {
      kind: "hatch", handle: "12", layerId: "0", pattern: "SOLID", associative: false,
      appearance: { transparency: 40 },
      loops: [{ isHole: false, vertices: [{ x: 50, y: 70 }, { x: 150, y: 70 }, { x: 150, y: 130 }, { x: 50, y: 130 }] }],
    },
  ];
  const created = createPaperLayout(document, {
    name: "F103 PLOT STYLE",
    paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    pageSetup: {
      mediaName: "ISO_A4", orientation: "landscape", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
      plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
      displayPlotStyles: false,
    },
    viewports: [{
      id: "viewport-f103", center: { x: 148.5, y: 105 }, width: 257, height: 150,
      viewCenter: { x: 105, y: 80 }, viewHeight: 150, twistAngleRad: 0, locked: true,
    }],
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
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { download, bytes: await readFile(path!) };
}

async function canvasPixels(page: Page) {
  return page.locator('[data-viewport-id="viewport-f103"] canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("F-103 viewport Canvas2D context is missing.");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Map<string, number>();
    const counts = {
      redOpaque: 0, redAlpha153: 0, greenOpaque: 0, greenAny: 0, trueColorBlueAny: 0, trueColorBlueRange: 0, blackOpaque: 0, blackAlpha153: 0,
      grayRedOpaque: 0, grayRedAlpha153: 0, grayGreenOpaque: 0, grayGreenAny: 0,
    };
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]!; const g = pixels[index + 1]!; const b = pixels[index + 2]!; const a = pixels[index + 3]!;
      if (a > 0) {
        const key = `${r},${g},${b},${a}`;
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
      }
      if (r === 255 && g === 0 && b === 0 && a === 255) counts.redOpaque += 1;
      if (r === 255 && g === 0 && b === 0 && a === 153) counts.redAlpha153 += 1;
      if (r === 0 && g === 255 && b === 0 && a === 255) counts.greenOpaque += 1;
      if (r === 0 && g === 255 && b === 0 && a > 0) counts.greenAny += 1;
      if (r === 10 && g === 100 && b === 220 && a > 0) counts.trueColorBlueAny += 1;
      if (r < 200 && g < 220 && b > 200 && b > g + 20 && a > 0) counts.trueColorBlueRange += 1;
      if (r === 0 && g === 0 && b === 0 && a === 255) counts.blackOpaque += 1;
      if (r === 0 && g === 0 && b === 0 && a === 153) counts.blackAlpha153 += 1;
      if (r >= 75 && r <= 77 && r === g && g === b && a === 255) counts.grayRedOpaque += 1;
      if (r >= 75 && r <= 77 && r === g && g === b && a === 153) counts.grayRedAlpha153 += 1;
      if (r >= 147 && r <= 150 && r === g && g === b && a === 255) counts.grayGreenOpaque += 1;
      if (r >= 147 && r <= 150 && r === g && g === b && a > 0) counts.grayGreenAny += 1;
    }
    const topColors = [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([rgba, count]) => ({ rgba, count }));
    return { width: canvas.width, height: canvas.height, counts, topColors };
  });
}

function pdfOperators(bytes: Buffer) {
  const text = bytes.toString("latin1");
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
    red: text.includes("1 0 0 RG 1 0 0 rg"),
    green: text.includes("0 1 0 RG 0 1 0 rg"),
    black: text.includes("0 0 0 RG 0 0 0 rg"),
    grayRed: text.includes("0.298039 0.298039 0.298039 RG"),
    grayGreen: text.includes("0.584314 0.584314 0.584314 RG"),
    trueColorBlue: text.includes("0.039216 0.392157 0.862745 RG"),
    fullLineweight: text.includes("0.7 w"),
    hairline: text.includes(" 0 w "),
    alpha60: text.includes("/GS60 gs") && text.includes("/CA 0.6 /ca 0.6"),
    solidFill: text.includes("f*"),
  };
}

async function setPlotStyle(page: Page, profile: "color" | "monochrome" | "grayscale", lineweights: boolean, transparency: boolean): Promise<void> {
  await page.getByLabel("Plot profile").selectOption(profile);
  if (lineweights) await page.getByLabel("Lineweights").check(); else await page.getByLabel("Lineweights").uncheck();
  if (transparency) await page.getByLabel("Transparency").check(); else await page.getByLabel("Transparency").uncheck();
  await page.getByLabel("Display plot styles").check();
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
}

test("F-103 applies/persists plot profiles, lineweights and transparency in preview and output", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, plotStyleDocument());
  await page.getByRole("button", { name: "F103 PLOT STYLE", exact: true }).click();
  const sheet = page.getByTestId("paper-space-sheet");
  await expect(sheet).toHaveAttribute("data-plot-profile", "monochrome");
  await expect(sheet).toHaveAttribute("data-plot-lineweights", "true");
  await expect(sheet).toHaveAttribute("data-plot-transparency", "true");
  await expect(sheet).toHaveAttribute("data-display-plot-styles", "false");
  const initialPixels = await canvasPixels(page);
  expect(initialPixels.counts.redAlpha153).toBeGreaterThan(1_000);
  expect(initialPixels.counts.greenAny).toBeGreaterThan(0);
  expect(initialPixels.counts.trueColorBlueRange).toBeGreaterThan(0);

  await setPlotStyle(page, "color", false, false);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(1);
  await expect(sheet).toHaveAttribute("data-plot-profile", "color");
  await expect(sheet).toHaveAttribute("data-plot-lineweights", "false");
  await expect(sheet).toHaveAttribute("data-plot-transparency", "false");
  await expect(sheet).toHaveAttribute("data-display-plot-styles", "true");
  const colorNoLineweightPixels = await canvasPixels(page);
  expect(colorNoLineweightPixels.counts.redOpaque).toBeGreaterThan(1_000);
  expect(colorNoLineweightPixels.counts.greenAny).toBeGreaterThan(0);
  expect(colorNoLineweightPixels.counts.redAlpha153).toBe(0);
  const colorNoLineweightSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const colorNoLineweightPdf = await downloadedBytes(page, "Ekspordi layout PDF");
  const colorNoLineweightSvgText = colorNoLineweightSvg.bytes.toString("utf8");
  expect(colorNoLineweightSvgText).toContain('data-plot-profile="color"');
  expect(colorNoLineweightSvgText).toContain('data-plot-lineweights="false"');
  expect(colorNoLineweightSvgText).toContain('data-lineweight-mm="0"');
  expect(colorNoLineweightSvgText).toContain('data-opacity="1"');
  const colorNoLineweightPdfOperators = pdfOperators(colorNoLineweightPdf.bytes);
  expect(colorNoLineweightPdfOperators).toMatchObject({ version: "1.4", pages: 1, eof: true, red: true, green: true, trueColorBlue: true, hairline: true, alpha60: false, solidFill: true });

  await page.reload();
  await expect(page.getByText("Taastatud revision 1")).toBeVisible();
  await page.getByRole("button", { name: "F103 PLOT STYLE", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-plot-profile", "color");
  await expect(sheet).toHaveAttribute("data-plot-lineweights", "false");

  await setPlotStyle(page, "grayscale", true, true);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(2);
  const grayscalePixels = await canvasPixels(page);
  expect(grayscalePixels.counts.grayRedAlpha153).toBeGreaterThan(1_000);
  expect(grayscalePixels.counts.grayGreenAny).toBeGreaterThan(0);
  const grayscaleSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const grayscalePdf = await downloadedBytes(page, "Ekspordi layout PDF");
  expect(grayscaleSvg.bytes.toString("utf8")).toContain('data-plot-color="#4c4c4c"');
  expect(grayscaleSvg.bytes.toString("utf8")).toContain('data-plot-color="#959595"');
  expect(grayscaleSvg.bytes.toString("utf8")).toContain('data-plot-color="#0a64dc"');
  expect(pdfOperators(grayscalePdf.bytes)).toMatchObject({ grayRed: true, grayGreen: true, trueColorBlue: true, fullLineweight: true, hairline: true, alpha60: true });

  await setPlotStyle(page, "color", true, true);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(3);
  const colorAlphaPixels = await canvasPixels(page);
  expect(colorAlphaPixels.counts.redOpaque).toBeGreaterThan(0);
  expect(colorAlphaPixels.counts.redAlpha153).toBeGreaterThan(1_000);
  expect(colorAlphaPixels.counts.greenAny).toBeGreaterThan(0);
  const colorAlphaSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const colorAlphaPdf = await downloadedBytes(page, "Ekspordi layout PDF");
  const colorAlphaSvgText = colorAlphaSvg.bytes.toString("utf8");
  expect(colorAlphaSvgText).toContain('data-plot-profile="color"');
  expect(colorAlphaSvgText).toContain('data-lineweight-mm="0.7"');
  expect(colorAlphaSvgText).toContain('fill-opacity="0.6"');
  expect(pdfOperators(colorAlphaPdf.bytes)).toMatchObject({ red: true, green: true, trueColorBlue: true, fullLineweight: true, hairline: true, alpha60: true, solidFill: true });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-plot-profile", "grayscale");
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-plot-profile", "color");

  await setPlotStyle(page, "monochrome", true, true);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(6);
  const monochromePixels = await canvasPixels(page);
  expect(monochromePixels.counts.blackOpaque).toBeGreaterThan(0);
  expect(monochromePixels.counts.blackAlpha153).toBeGreaterThan(1_000);
  const monochromeSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const monochromePdf = await downloadedBytes(page, "Ekspordi layout PDF");
  const kdraw = await downloadedBytes(page, "KDraw eksport");
  expect(monochromeSvg.bytes.toString("utf8")).toContain('data-plot-profile="monochrome"');
  expect(monochromeSvg.bytes.toString("utf8")).toContain('data-plot-color="#000000"');
  expect(monochromeSvg.bytes.toString("utf8")).toContain('data-plot-color="#0a64dc"');
  expect(monochromeSvg.bytes.toString("utf8")).toContain('data-lineweight-mm="0"');
  expect(pdfOperators(monochromePdf.bytes)).toMatchObject({ black: true, red: false, green: false, trueColorBlue: true, fullLineweight: true, hairline: true, alpha60: true });
  expect(kdraw.bytes.toString("utf8").startsWith("KDRAW1\n")).toBe(true);

  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual(["PAGESETUP", "PAGESETUP", "PAGESETUP", "UNDO", "PAGESETUP", "PAGESETUP"]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4, 5]);
  await page.reload();
  await expect(page.getByText("Taastatud revision 6")).toBeVisible();
  await page.getByRole("button", { name: "F103 PLOT STYLE", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-plot-profile", "monochrome");
  await expect(sheet).toHaveAttribute("data-plot-lineweights", "true");
  await expect(sheet).toHaveAttribute("data-plot-transparency", "true");
  const stored = await readDocument(page);
  expect(stored.layouts[1]!.pageSetup!.plotStyle).toEqual({ profile: "monochrome", plotLineweights: true, plotTransparency: true });
  expect(stored.layouts[1]!.pageSetup!.displayPlotStyles).toBe(true);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await page.locator('[data-viewport-id="viewport-f103"]').screenshot({ path: resolve(captureDir, "F-103-browser-monochrome.png") });
    const outputs: Array<[string, Buffer]> = [
      ["F-103-browser-color-no-lineweights.svg", colorNoLineweightSvg.bytes], ["F-103-browser-color-no-lineweights.pdf", colorNoLineweightPdf.bytes],
      ["F-103-browser-grayscale.svg", grayscaleSvg.bytes], ["F-103-browser-grayscale.pdf", grayscalePdf.bytes],
      ["F-103-browser-color-alpha.svg", colorAlphaSvg.bytes], ["F-103-browser-color-alpha.pdf", colorAlphaPdf.bytes],
      ["F-103-browser-monochrome.svg", monochromeSvg.bytes], ["F-103-browser-monochrome.pdf", monochromePdf.bytes],
      ["F-103-browser-plot-style.kdraw", kdraw.bytes],
    ];
    await Promise.all(outputs.map(([name, bytes]) => writeFile(resolve(captureDir, name), bytes)));
    await writeFile(resolve(captureDir, "F-103-browser-plot-style.json"), `${JSON.stringify({
      schemaVersion: 1, rowId: "F-103", status: "PASS", viewport: { width: 1920, height: 1080 },
      action: "Source preview OFF -> Color no-LW/no-alpha with preview ON -> reload -> Grayscale LW+alpha -> Color LW+alpha -> Undo/Redo -> Monochrome LW+alpha -> reload",
      previewState: { initialDisplayPlotStyles: false, afterFirstApply: true, finalDisplayPlotStyles: stored.layouts[1]!.pageSetup!.displayPlotStyles },
      pixels: { initial: initialPixels, colorNoLineweight: colorNoLineweightPixels, grayscale: grayscalePixels, colorAlpha: colorAlphaPixels, monochrome: monochromePixels },
      outputs: Object.fromEntries(outputs.map(([name, bytes]) => [name, { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }])),
      operators: { colorNoLineweight: colorNoLineweightPdfOperators, grayscale: pdfOperators(grayscalePdf.bytes), colorAlpha: pdfOperators(colorAlphaPdf.bytes), monochrome: pdfOperators(monochromePdf.bytes) },
      operations, finalLayout: stored.layouts[1], documentRevision: stored.revision, consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
