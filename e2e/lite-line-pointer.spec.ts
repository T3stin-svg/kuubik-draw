import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

import { seedKDrawDocument } from "./helpers/indexed-db.js";

async function readLocalDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result as KDrawDocumentV1);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document;
  });
}

async function canvasInkPixels(page: Page): Promise<number> {
  return page.getByLabel("Kuubik Draw joonestusala").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) count += 1;
    return count;
  });
}

test("Lite LINE ribbon command draws with two real canvas clicks and persists", async ({ page }) => {
  test.setTimeout(45_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedKDrawDocument(page, createEmptyDocument({ documentId: "local", now: "2026-09-01T12:00:00.000Z" }));

  await expect(page.getByTestId("view-orientation-indicator")).toHaveCount(0);
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const beforeInk = await canvasInkPixels(page);
  await page.getByRole("button", { name: "Ribbon Line command" }).click();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const first = { x: Math.round(box!.width * 0.28), y: Math.round(box!.height * 0.32) };
  const second = { x: Math.round(box!.width * 0.68), y: Math.round(box!.height * 0.68) };
  await canvas.click({ position: first });
  await expect(page.getByText(/LINE esimene punkt:/u)).toBeVisible();
  const preview = page.getByTestId("line-canvas-preview");
  await expect(preview).toBeVisible();

  await canvas.hover({ position: second });
  await expect.poll(async () => {
    const startX = Number(await preview.getAttribute("data-start-x"));
    const startY = Number(await preview.getAttribute("data-start-y"));
    const endX = Number(await preview.getAttribute("data-end-x"));
    const endY = Number(await preview.getAttribute("data-end-y"));
    return Math.hypot(endX - startX, endY - startY);
  }).toBeGreaterThan(100);

  await canvas.click({ position: second });
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("LINE runtime salvestatud, revision 1")).toBeVisible();
  await expect.poll(async () => {
    const document = await readLocalDocument(page);
    return { revision: document.revision, lines: document.entities.filter((entity) => entity.kind === "line").length };
  }).toEqual({ revision: 1, lines: 1 });
  await expect.poll(() => canvasInkPixels(page)).toBeGreaterThan(beforeInk);

  const stored = await readLocalDocument(page);
  const line = stored.entities.find((entity) => entity.kind === "line");
  expect(line).toBeDefined();
  if (!line || line.kind !== "line") throw new Error("LINE read-back puudub.");
  expect(Number.isFinite(line.start.x) && Number.isFinite(line.start.y)).toBe(true);
  expect(Number.isFinite(line.end.x) && Number.isFinite(line.end.y)).toBe(true);
  expect(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y)).toBeGreaterThan(100);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await readLocalDocument(page)).entities.filter((entity) => entity.kind === "line").length).toBe(0);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect.poll(async () => (await readLocalDocument(page)).entities.filter((entity) => entity.kind === "line").length).toBe(1);

  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await expect.poll(async () => (await readLocalDocument(page)).entities.filter((entity) => entity.kind === "line").length).toBe(1);
  expect(consoleErrors).toEqual([]);
});
