import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { checkpointKDrawDocument, seedKDrawDocument } from "./helpers/indexed-db.js";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function paperDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.layouts.push({
    id: "layout-f098",
    name: "F098 PAPER",
    kind: "paper",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [],
    entities: [{
      kind: "circle",
      handle: "20",
      layerId: "0",
      center: { x: 60, y: 60 },
      radius: 30,
      appearance: { color: "#111111", lineweightMm: 0.5 },
    }],
  });
  return document;
}

async function seedLocalDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
  await seedKDrawDocument(page, document);
}

async function paperMetrics(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('.drawing-area[data-mode="paper"]')!;
    const desk = document.querySelector<HTMLElement>(".paper-space-desk")!;
    const sheet = document.querySelector<HTMLElement>(".paper-space-sheet")!;
    const printable = document.querySelector<HTMLElement>(".paper-printable-area")!;
    const palette = document.querySelector<HTMLElement>(".layer-manager")!;
    const canvas = sheet.querySelector<HTMLCanvasElement>("canvas")!;
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) paintedPixels += 1;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      area: rect(area),
      desk: rect(desk),
      sheet: rect(sheet),
      printable: rect(printable),
      palette: rect(palette),
      canvas: rect(canvas),
      canvasBitmap: { width: canvas.width, height: canvas.height, paintedPixels },
      paper: { widthMm: Number(sheet.dataset.paperWidthMm), heightMm: Number(sheet.dataset.paperHeightMm) },
      colors: {
        desk: getComputedStyle(desk).backgroundColor,
        sheet: getComputedStyle(sheet).backgroundColor,
        canvas: getComputedStyle(canvas).backgroundColor,
      },
    };
  });
}

async function downloadKDraw(page: Page): Promise<{ bytes: Buffer; sha256: string }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  if (process.env.PARITY_CAPTURE_DIR) await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-098-browser-paper-space.kdraw"), bytes);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("F-098 shows a positive A3 paper sheet in the workspace and restores it from IndexedDB", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, paperDocument());
  await expect(page.locator('.drawing-area[data-mode="model"]')).toBeVisible();
  await page.getByRole("tab", { name: "F098 PAPER", exact: true }).click();
  await expect(page.locator('.drawing-area[data-mode="paper"]')).toBeVisible();
  await expect(page.getByText("PAPER · mm · GRID")).toBeVisible();

  const beforeReload = await paperMetrics(page);
  expect(beforeReload.viewport).toMatchObject({ width: 1920, height: 1080 });
  expect(beforeReload.area.width).toBeGreaterThan(1500);
  expect(beforeReload.area.height).toBeGreaterThan(700);
  expect(beforeReload.desk).toMatchObject({ x: beforeReload.area.x, y: beforeReload.area.y, width: beforeReload.area.width });
  expect(beforeReload.area.height - beforeReload.desk.height).toBe(69);
  expect(beforeReload.sheet.width).toBeGreaterThan(700);
  expect(beforeReload.sheet.height).toBeGreaterThan(500);
  expect(beforeReload.sheet.x).toBeGreaterThanOrEqual(beforeReload.desk.x + 20);
  expect(beforeReload.printable.x).toBeGreaterThan(beforeReload.sheet.x);
  expect(beforeReload.printable.y).toBeGreaterThan(beforeReload.sheet.y);
  expect(beforeReload.sheet.width / beforeReload.sheet.height).toBeCloseTo(420 / 297, 2);
  expect(beforeReload.canvas.width / beforeReload.canvas.height).toBeCloseTo(420 / 297, 2);
  expect(beforeReload.paper).toEqual({ widthMm: 420, heightMm: 297 });
  expect(beforeReload.colors).toEqual({ desk: "rgb(52, 58, 64)", sheet: "rgb(255, 255, 255)", canvas: "rgb(255, 255, 255)" });
  expect(beforeReload.canvasBitmap.paintedPixels).toBeGreaterThan(100);
  const exported = await downloadKDraw(page);

  expect(await checkpointKDrawDocument(page, { suspendApp: true })).toEqual({ revision: 1, layoutRepairs: [] });
  await page.goto("/d/local");
  await expect(page.getByTestId("recovery-panel").getByText("Pärast katkestust taastati revisjon 1.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "F098 PAPER", exact: true }).click();
  const afterReload = await paperMetrics(page);
  expect(afterReload.paper).toEqual(beforeReload.paper);
  expect(afterReload.sheet.width).toBeCloseTo(beforeReload.sheet.width, 0);
  expect(afterReload.sheet.height).toBeCloseTo(beforeReload.sheet.height, 0);
  expect(afterReload.canvasBitmap.paintedPixels).toBeGreaterThan(100);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-098-browser-paper-space.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-098",
      status: "PASS",
      action: "Model -> F098 PAPER -> measure -> KDRAW1 download -> reload -> F098 PAPER -> measure",
      expectedPaper: { widthMm: 420, heightMm: 297 },
      beforeReload,
      afterReload,
      exported: { bytes: exported.bytes.byteLength, sha256: exported.sha256 },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
