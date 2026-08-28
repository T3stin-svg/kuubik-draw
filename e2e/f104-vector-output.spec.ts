import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createF104Document, F104_LAYOUT_NAME, F104_VIEWPORT_IDS } from "../parity/fixtures/f104-document.js";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

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

async function downloadedBytes(page: Page, buttonName: string): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { download, bytes: await readFile(path!) };
}

function parseKDraw(bytes: Buffer): KDrawDocumentV1 {
  const text = bytes.toString("utf8");
  expect(text.startsWith("KDRAW1\n")).toBe(true);
  const envelope = JSON.parse(text.slice("KDRAW1\n".length)) as {
    manifest: { entries: Array<{ path: string; byteLength: number; sha256: string }> };
    files: Record<string, string>;
  };
  const documentBytes = Buffer.from(envelope.files["document.json"]!, "base64");
  const entry = envelope.manifest.entries.find((candidate) => candidate.path === "document.json")!;
  expect(documentBytes.byteLength).toBe(entry.byteLength);
  expect(sha256(documentBytes)).toBe(entry.sha256);
  return JSON.parse(documentBytes.toString("utf8")) as KDrawDocumentV1;
}

async function viewportMetrics(page: Page) {
  return page.locator('[data-testid="paper-space-viewport"]').evaluateAll((elements) => elements.map((element) => {
    const viewport = element as HTMLElement;
    const canvas = viewport.querySelector("canvas")!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedPixels = 0;
    let redPixels = 0;
    let bluePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]!; const green = pixels[index + 1]!; const blue = pixels[index + 2]!; const alpha = pixels[index + 3]!;
      if (alpha > 0) paintedPixels += 1;
      if (red > 180 && green < 100 && blue < 100 && alpha > 0) redPixels += 1;
      if (blue > 140 && blue > red + 60 && alpha > 0) bluePixels += 1;
    }
    const box = viewport.getBoundingClientRect();
    return {
      id: viewport.dataset.viewportId,
      kind: viewport.dataset.viewportKind,
      context: viewport.dataset.spaceContext,
      viewCenter: viewport.dataset.viewCenter,
      viewHeight: Number(viewport.dataset.viewHeight),
      locked: viewport.dataset.displayLocked,
      clipPath: getComputedStyle(viewport).clipPath,
      frame: { x: box.x, y: box.y, width: box.width, height: box.height },
      canvas: { width: canvas.width, height: canvas.height, paintedPixels, redPixels, bluePixels },
    };
  }));
}

function pdfOperators(bytes: Buffer) {
  const text = bytes.toString("latin1");
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    a3: text.includes("/MediaBox [0 0 1190.551181 841.889764]"),
    rectangularClip: text.includes("16.25 25 185 247 re W n"),
    polygonClip: text.includes("218.75 25 m 403.75 25 l 382 272 l 240.5 272 l h W n"),
    scale50: text.includes("0.02 0 0 0.02 108.75 148.5 cm"),
    scale100: text.includes("0.01 0 0 0.01 111.25 148.5 cm"),
    red: text.includes("1 0 0 RG 1 0 0 rg"),
    blue: text.includes("0 0.392157 0.862745 RG 0 0.392157 0.862745 rg"),
    alpha60: text.includes("/GS60 gs") && text.includes("/CA 0.6 /ca 0.6"),
    title: text.includes("(KUUBIK F-104 VECTOR LAYOUT) Tj"),
    images: (text.match(/\/Subtype \/Image\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
  };
}

test("F-104 exports deterministic A3 vector SVG/PDF from two persisted layout viewports", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF104Document("local"));
  await page.getByRole("button", { name: F104_LAYOUT_NAME, exact: true }).click();

  const sheet = page.getByTestId("paper-space-sheet");
  await expect(sheet).toHaveAttribute("data-plot-profile", "color");
  await expect(sheet).toHaveAttribute("data-plot-lineweights", "true");
  await expect(sheet).toHaveAttribute("data-plot-transparency", "true");
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(2);
  const before = await viewportMetrics(page);
  expect(before.map(({ id, kind, viewCenter, viewHeight, locked }) => ({ id, kind, viewCenter, viewHeight, locked }))).toEqual([
    { id: F104_VIEWPORT_IDS[0], kind: "rectangle", viewCenter: "0,0", viewHeight: 12350, locked: "true" },
    { id: F104_VIEWPORT_IDS[1], kind: "polygon", viewCenter: "20000,0", viewHeight: 24700, locked: "true" },
  ]);
  expect(before[0]!.frame.x + before[0]!.frame.width).toBeLessThan(before[1]!.frame.x);
  expect(before[0]!.canvas.redPixels).toBeGreaterThan(50);
  expect(before[1]!.canvas.bluePixels).toBeGreaterThan(50);
  expect(before[0]!.clipPath).toBe("none");
  expect(before[1]!.clipPath).toContain("polygon(");

  const firstSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const firstPdf = await downloadedBytes(page, "Ekspordi layout PDF");
  const kdraw = await downloadedBytes(page, "KDraw eksport");
  const svgText = firstSvg.bytes.toString("utf8");
  expect(svgText).toContain('width="420mm" height="297mm"');
  expect((svgText.match(/data-viewport-id=/gu) ?? []).length).toBe(2);
  expect(svgText).toContain('<clipPath id="viewport-clip-0"><rect');
  expect(svgText).toContain('<clipPath id="viewport-clip-1"><polygon');
  expect(svgText).toContain("KUUBIK F-104 VECTOR LAYOUT");
  expect(pdfOperators(firstPdf.bytes)).toEqual({
    version: "1.4", pages: 1, a3: true, rectangularClip: true, polygonClip: true, scale50: true, scale100: true,
    red: true, blue: true, alpha60: true, title: true, images: 0, eof: true,
  });
  const exported = parseKDraw(kdraw.bytes);
  expect(exported.layouts[1]!.viewports.map((viewport) => ({ id: viewport.id, viewHeight: viewport.viewHeight, locked: viewport.locked, clipPoints: viewport.clipBoundary?.length ?? 0 }))).toEqual([
    { id: F104_VIEWPORT_IDS[0], viewHeight: 12350, locked: true, clipPoints: 0 },
    { id: F104_VIEWPORT_IDS[1], viewHeight: 24700, locked: true, clipPoints: 4 },
  ]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
  await page.getByRole("button", { name: F104_LAYOUT_NAME, exact: true }).click();
  const after = await viewportMetrics(page);
  expect(after.map(({ id, viewCenter, viewHeight, locked }) => ({ id, viewCenter, viewHeight, locked }))).toEqual(before.map(({ id, viewCenter, viewHeight, locked }) => ({ id, viewCenter, viewHeight, locked })));
  const secondSvg = await downloadedBytes(page, "Ekspordi layout SVG");
  const secondPdf = await downloadedBytes(page, "Ekspordi layout PDF");
  expect(secondSvg.bytes).toEqual(firstSvg.bytes);
  expect(secondPdf.bytes).toEqual(firstPdf.bytes);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await sheet.screenshot({ path: resolve(captureDir, "F-104-browser-layout.png") });
    await Promise.all([
      writeFile(resolve(captureDir, "F-104-browser-layout.svg"), firstSvg.bytes),
      writeFile(resolve(captureDir, "F-104-browser-layout.pdf"), firstPdf.bytes),
      writeFile(resolve(captureDir, "F-104-browser-layout.kdraw"), kdraw.bytes),
    ]);
    await writeFile(resolve(captureDir, "F-104-browser-vector-output.json"), `${JSON.stringify({
      schemaVersion: 1, rowId: "F-104", status: "PASS", viewport: { width: 1920, height: 1080 },
      action: "Open persisted A3 paper layout -> inspect locked 1:50 rectangular and 1:100 polygon-clipped viewports -> SVG/PDF/KDRAW1 export -> reload -> exact SVG/PDF re-export",
      before, after, outputs: {
        svg: { bytes: firstSvg.bytes.byteLength, sha256: sha256(firstSvg.bytes), suggestedFilename: firstSvg.download.suggestedFilename() },
        pdf: { bytes: firstPdf.bytes.byteLength, sha256: sha256(firstPdf.bytes), suggestedFilename: firstPdf.download.suggestedFilename(), operators: pdfOperators(firstPdf.bytes) },
        kdraw: { bytes: kdraw.bytes.byteLength, sha256: sha256(kdraw.bytes), suggestedFilename: kdraw.download.suggestedFilename(), revision: exported.revision },
      },
      deterministicReload: { svgSha256: sha256(secondSvg.bytes), pdfSha256: sha256(secondPdf.bytes) },
      layout: exported.layouts[1], consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
