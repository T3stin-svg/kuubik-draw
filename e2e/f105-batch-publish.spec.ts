import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createF105Document, F105_LAYOUT_IDS } from "../parity/fixtures/f105-document.js";

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

async function measuredDisplayWindow(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const desk = document.querySelector<HTMLElement>('[data-testid="paper-space-desk"]');
    const sheet = document.querySelector<HTMLElement>('[data-testid="paper-space-sheet"]');
    if (!desk || !sheet) throw new Error("Paper-space DOM is missing.");
    const paperWidth = Number(sheet.dataset.paperWidthMm); const paperHeight = Number(sheet.dataset.paperHeightMm);
    const deskRect = desk.getBoundingClientRect(); const sheetRect = sheet.getBoundingClientRect();
    const deskLeft = deskRect.left + desk.clientLeft; const deskTop = deskRect.top + desk.clientTop;
    const sheetLeft = sheetRect.left + sheet.clientLeft; const sheetTop = sheetRect.top + sheet.clientTop;
    const sheetBottom = sheetTop + sheet.clientHeight;
    const scale = ((sheet.clientWidth / paperWidth) + (sheet.clientHeight / paperHeight)) / 2;
    const round = (value: number) => Number(value.toFixed(6));
    return {
      x: round((deskLeft - sheetLeft) / scale),
      y: round((sheetBottom - (deskTop + desk.clientHeight)) / scale),
      width: round(desk.clientWidth / scale),
      height: round(desk.clientHeight / scale),
    };
  });
}

async function oneDownload(page: Page): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Publish layouts" }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { download, bytes: await readFile(path!) };
}

function pdfSummary(bytes: Buffer) {
  const text = bytes.toString("latin1");
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    a4Pages: (text.match(/\/MediaBox \[0 0 595\.275591 841\.889764\]/gu) ?? []).length,
    pageTree: text.match(/\/Kids \[([^\]]+)\]/u)?.[1]?.trim() ?? null,
    planTitleAt: text.indexOf("(F-105 SHEET 20 PLAN) Tj"),
    sectionTitleAt: text.indexOf("(F-105 SHEET 10 SECTION) Tj"),
    red: text.includes("1 0 0 RG 1 0 0 rg"),
    blue: text.includes("0 0.4 1 RG 0 0.4 1 rg"),
    images: (text.match(/\/Subtype \/Image\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
  };
}

function layoutPlacement(bytes: Buffer) {
  const text = bytes.toString("latin1");
  const match = text.match(/\nq ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) re W n ([-+0-9.]+) 0 0 ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) cm/u);
  if (!match) return null;
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

test("F-105 persists ordered publish settings and downloads multi-page, excluded and separate PDFs", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF105Document("local"));
  await page.getByRole("button", { name: "F-105 SHEET 10 SECTION", exact: true }).click();

  const options = page.getByTestId("publish-options");
  await options.locator("summary").click();
  await expect(options).toHaveAttribute("data-order", F105_LAYOUT_IDS.join("|"));
  await expect(options).toHaveAttribute("data-included", F105_LAYOUT_IDS.join("|"));
  await options.getByRole("button", { name: "Liiguta publish leht F-105 SHEET 20 PLAN üles" }).click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await expect(options).toHaveAttribute("data-order", [...F105_LAYOUT_IDS].reverse().join("|"));

  const sectionIncluded = options.getByRole("checkbox", { name: "Avalda F-105 SHEET 10 SECTION" });
  await sectionIncluded.click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await expect(sectionIncluded).not.toBeChecked();
  await expect(options).toHaveAttribute("data-included", F105_LAYOUT_IDS[1]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(options).toHaveAttribute("data-included", [...F105_LAYOUT_IDS].reverse().join("|"));
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(options).toHaveAttribute("data-included", F105_LAYOUT_IDS[1]);

  const nameInput = options.getByRole("textbox", { name: "Publish failinimi" });
  await nameInput.fill("F105 Browser");
  await options.getByRole("button", { name: "Salvesta publish failinimi" }).click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await nameInput.fill("  F105 Browser  ");
  await options.getByRole("button", { name: "Salvesta publish failinimi" }).click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await expect(nameInput).toHaveValue("F105 Browser");
  const excluded = await oneDownload(page);
  expect(excluded.download.suggestedFilename()).toBe("F105 Browser.pdf");
  expect(pdfSummary(excluded.bytes)).toMatchObject({ pages: 1, a4Pages: 1, planTitleAt: expect.any(Number), sectionTitleAt: -1, red: true, blue: false, images: 0, eof: true });
  expect(pdfSummary(excluded.bytes).planTitleAt).toBeGreaterThan(0);

  await sectionIncluded.click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await expect(sectionIncluded).toBeChecked();
  const multi = await oneDownload(page);
  const multiSummary = pdfSummary(multi.bytes);
  expect(multi.download.suggestedFilename()).toBe("F105 Browser.pdf");
  expect(multiSummary).toMatchObject({ version: "1.4", pages: 2, a4Pages: 2, red: true, blue: true, images: 0, eof: true });
  expect(multiSummary.planTitleAt).toBeGreaterThan(0);
  expect(multiSummary.sectionTitleAt).toBeGreaterThan(multiSummary.planTitleAt);

  await options.getByRole("combobox", { name: "Publish output" }).selectOption("separate");
  const separateDownloads: Download[] = [];
  page.on("download", (download) => separateDownloads.push(download));
  await page.getByRole("button", { name: "Publish layouts" }).click();
  await expect.poll(() => separateDownloads.length).toBe(2);
  const separate = await Promise.all(separateDownloads.map(async (download) => {
    const path = await download.path();
    expect(path).not.toBeNull();
    return { download, bytes: await readFile(path!) };
  }));
  expect(separate.map(({ download }) => download.suggestedFilename())).toEqual([
    "F105 Browser-F-105 SHEET 20 PLAN.pdf",
    "F105 Browser-F-105 SHEET 10 SECTION.pdf",
  ]);
  expect(separate.map(({ bytes }) => pdfSummary(bytes).pages)).toEqual([1, 1]);
  expect(pdfSummary(separate[0]!.bytes)).toMatchObject({ planTitleAt: expect.any(Number), sectionTitleAt: -1, red: true, blue: false });
  expect(pdfSummary(separate[1]!.bytes)).toMatchObject({ planTitleAt: -1, sectionTitleAt: expect.any(Number), red: false, blue: true });

  await page.reload();
  await expect(page.getByText(/Taastatud revision/u)).toBeVisible();
  await page.getByRole("button", { name: "F-105 SHEET 10 SECTION", exact: true }).click();
  const restored = page.getByTestId("publish-options");
  await expect(restored).toHaveAttribute("data-order", [...F105_LAYOUT_IDS].reverse().join("|"));
  await expect(restored).toHaveAttribute("data-included", [...F105_LAYOUT_IDS].reverse().join("|"));
  await expect(restored).toHaveAttribute("data-output", "separate");
  await restored.locator("summary").click();
  await expect(restored.getByRole("textbox", { name: "Publish failinimi" })).toHaveValue("F105 Browser");
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await restored.locator(".publish-options-grid").screenshot({ path: resolve(captureDir, "F-105-browser-publish.png") });
    await Promise.all([
      writeFile(resolve(captureDir, "F-105-browser-excluded.pdf"), excluded.bytes),
      writeFile(resolve(captureDir, "F-105-browser-multi.pdf"), multi.bytes),
      writeFile(resolve(captureDir, "F-105-browser-plan.pdf"), separate[0]!.bytes),
      writeFile(resolve(captureDir, "F-105-browser-section.pdf"), separate[1]!.bytes),
    ]);
    await writeFile(resolve(captureDir, "F-105-browser-matrix.json"), `${JSON.stringify({
      schemaVersion: 1, rowId: "F-105", status: "PASS", viewport: { width: 1920, height: 1080 },
      action: "Reorder -> exclude -> atomic Undo/Redo -> multi-page publish -> restore -> separate PDFs -> reload",
      order: [...F105_LAYOUT_IDS].reverse(), included: [...F105_LAYOUT_IDS].reverse(), output: "separate", baseFileName: "F105 Browser",
      outputs: {
        excluded: { bytes: excluded.bytes.byteLength, sha256: sha256(excluded.bytes), name: excluded.download.suggestedFilename(), summary: pdfSummary(excluded.bytes) },
        multi: { bytes: multi.bytes.byteLength, sha256: sha256(multi.bytes), name: multi.download.suggestedFilename(), summary: multiSummary },
        separate: separate.map(({ download, bytes }) => ({ bytes: bytes.byteLength, sha256: sha256(bytes), name: download.suggestedFilename(), summary: pdfSummary(bytes) })),
      },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});

test("F-105 captures an inactive Display layout source for batch publish", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const document = createF105Document("local");
  document.layouts[1]!.pageSetup!.plotArea = { kind: "display" };
  await seedLocalDocument(page, document);
  await page.getByRole("button", { name: "F-105 SHEET 10 SECTION", exact: true }).click();
  const expectedWindow = await measuredDisplayWindow(page);
  const options = page.getByTestId("publish-options");
  await options.locator("summary").click();
  const capture = options.getByRole("button", { name: "Salvesta publish kuvaala F-105 SHEET 10 SECTION" });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(options).toHaveAttribute("data-busy", "false");
  await expect(capture).toHaveText("Kuvaala ✓");
  await options.getByRole("checkbox", { name: "Avalda F-105 SHEET 20 PLAN" }).uncheck();
  await expect(options).toHaveAttribute("data-busy", "false");
  const stored = await readLocalDocument(page);
  const storedSettings = stored.metadata.extensions?.["kuubikDraw.layoutPublish.v1"] as { sheets?: Array<{ layoutId: string; displayWindow?: typeof expectedWindow }> } | undefined;
  const storedWindow = storedSettings?.sheets?.find((sheet) => sheet.layoutId === F105_LAYOUT_IDS[0])?.displayWindow;
  expect(storedWindow).toEqual(expectedWindow);
  await options.locator("summary").click();
  await page.getByRole("button", { name: "F-105 SHEET 20 PLAN", exact: true }).click();
  await options.locator("summary").click();
  const output = await oneDownload(page);
  const summary = pdfSummary(output.bytes); const placement = layoutPlacement(output.bytes);
  expect(summary).toMatchObject({ pages: 1, a4Pages: 1, red: false, blue: true, images: 0, eof: true });
  expect(placement).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(placement!.source[key] - expectedWindow[key])).toBeLessThanOrEqual(0.0002);
  }
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await Promise.all([
      writeFile(resolve(captureDir, "F-105-browser-display.pdf"), output.bytes),
      writeFile(resolve(captureDir, "F-105-browser-display.json"), `${JSON.stringify({
        schemaVersion: 1, rowId: "F-105", status: "PASS", viewport: { width: 1920, height: 1080 },
        sourceLayoutId: F105_LAYOUT_IDS[0], activeLayoutAtPublish: F105_LAYOUT_IDS[1], expectedWindow, storedWindow,
        output: { bytes: output.bytes.byteLength, sha256: sha256(output.bytes), name: output.download.suggestedFilename(), summary, placement },
        consoleErrors: errors,
      }, null, 2)}\n`, "utf8"),
    ]);
  }
});
