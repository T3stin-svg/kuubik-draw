import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: Record<string, unknown> };

const captureRoot = process.env.PARITY_CAPTURE_DIR;
async function capture(name: string, value: unknown): Promise<void> {
  if (!captureRoot) return;
  await mkdir(captureRoot, { recursive: true });
  const path = resolve(captureRoot, name);
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) await writeFile(path, value);
  else await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  }, structuredClone(document));
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
    const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
    const result = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result as KDrawDocumentV1);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return result;
  });
}

async function readOperations(page: Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
    const rows = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result as Array<{ revision: number; operation: RecordedOperation }>);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return rows.sort((first, second) => first.revision - second.revision).map(({ operation }) => operation);
  });
}

test("F-027 STRETCH crossing preview equals atomic commit, Undo/Redo and file readback", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:00:00.000Z" });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, appearance: { color: "#ff0000", lineweightMm: 0.35 }, extensionData: { rowId: "F-027" } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 800, y: 0 }, radius: 50 },
    { kind: "circle", handle: "30", layerId: "0", center: { x: 350, y: 0 }, radius: 100 },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("STRETCH crossing").fill("400,-100; 1100,100 | 790,-10; 810,-10; 810,10; 790,10");
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveText("STRETCH eelvaade: 2 tulemust · 2 sammu · Δ250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveAttribute("data-hidden-source-count", "2");

  await page.getByRole("button", { name: "STRETCH Undo" }).click();
  await expect(page.getByLabel("STRETCH crossing")).toHaveValue("400,-100; 1100,100");
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("STRETCH crossing").fill("400,-100; 1100,100 | 790,-10; 810,-10; 810,10; 790,10");
  await page.getByRole("button", { name: "STRETCH", exact: true }).click();
  await expect(page.getByText("1 venitatud ja 1 liigutatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities.find((entity) => entity.handle === "10")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 1250, y: 50 }, appearance: source.entities[0]!.appearance, extensionData: source.entities[0]!.extensionData });
  expect(committed.entities.find((entity) => entity.handle === "20")).toMatchObject({ kind: "circle", center: { x: 1050, y: 50 }, radius: 50 });
  expect(committed.entities.find((entity) => entity.handle === "30")).toEqual(source.entities[2]);
  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({ commandId: "STRETCH", targetHandles: ["10", "20"], resultHandles: ["10", "20"], args: { delta: { x: 250, y: 50 } } });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.find((entity) => entity.handle === "10")).toMatchObject({
    type: "LINE",
    vertices: [{ x: 0, y: 0 }, { x: 1250, y: 50 }],
  });
  expect(parsed?.entities.find((entity) => entity.handle === "20")).toMatchObject({ type: "CIRCLE", center: { x: 1050, y: 50 }, radius: 50 });

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restored = await deserializeKDraw(kdrawBytes);
  expect(restored.document.entities).toEqual(committed.entities);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const undoRestored = await readDocument(page);
  expect(undoRestored.entities).toEqual(source.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readDocument(page);
  expect(redone.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);
  await capture("F-027-browser.dxf", dxfBytes);
  await capture("F-027-browser.kdraw", kdrawBytes);
  await capture("F-027-browser-matrix.json", { rowId: "F-027", source, committed, operation, restored: restored.document, undoRestored, redone, consoleErrors, status: "PASS" });
});

test("F-027 STRETCH quarter ellipse matches native geometry through browser and file outputs", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:05:00.000Z" });
  source.entities = [{
    kind: "ellipse", handle: "40", layerId: "0", center: { x: 1000, y: 1000 }, majorAxis: { x: 100, y: 0 },
    ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2, extensionData: { rowId: "F-027", fixture: "quarter" },
  }];
  await seedLocalDocument(page, source);
  await page.getByLabel("STRETCH crossing").fill("1090,990; 1110,1010");
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@25,5");
  await page.getByRole("button", { name: "STRETCH", exact: true }).click();
  const committed = await readDocument(page);
  const ellipse = committed.entities[0];
  expect(ellipse).toMatchObject({
    kind: "ellipse", handle: "40",
    center: { x: expect.closeTo(1009.852004872791, 10), y: expect.closeTo(998.9222357577537, 10) },
    majorAxis: { x: expect.closeTo(115.564843901568, 10), y: expect.closeTo(2.120881991279924, 10) },
    ratio: expect.closeTo(0.444723039979619, 10),
    startParameter: expect.closeTo(0.077190120252004, 10),
    endParameter: expect.closeTo(1.647986447046899, 10),
    extensionData: source.entities[0]!.extensionData,
  });
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities[0]).toMatchObject({
    type: "ELLIPSE", handle: "40",
    center: { x: expect.closeTo(1009.852004872791, 10), y: expect.closeTo(998.9222357577537, 10) },
    majorAxisEndPoint: { x: expect.closeTo(115.564843901568, 10), y: expect.closeTo(2.120881991279924, 10) },
    axisRatio: expect.closeTo(0.444723039979619, 10),
  });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restored = await deserializeKDraw(kdrawBytes);
  expect(restored.document.entities).toEqual(committed.entities);
  await capture("F-027-browser-ellipse.dxf", dxfBytes);
  await capture("F-027-browser-ellipse.kdraw", kdrawBytes);
  await capture("F-027-browser-ellipse.json", { rowId: "F-027", source, committed, restored: restored.document, parsed: parsed?.entities[0], status: "PASS" });
});

test("F-027 STRETCH refuses selected locked geometry without creating an operation", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:10:00.000Z" });
  source.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  source.entities = [{ kind: "line", handle: "10", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }];
  await seedLocalDocument(page, source);
  await page.getByLabel("STRETCH crossing").fill("400,-100; 1100,100");
  await page.getByRole("button", { name: "STRETCH", exact: true }).click();
  await expect(page.getByTestId("stretch-rejected")).toContainText("10 (locked-layer)");
  const lockedRestored = await readDocument(page);
  const lockedOperations = await readOperations(page);
  expect(lockedRestored).toEqual(source);
  expect(lockedOperations).toEqual([]);
  await capture("F-027-browser-locked.json", { rowId: "F-027", source, lockedRestored, lockedOperations, status: "PASS" });
});

test("F-027 STRETCH creates a real crossing window by dragging on the canvas", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:20:00.000Z" });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 800, y: 0 }, radius: 50 },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("STRETCH crossing").fill("");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("F-027 drawing canvas has no browser bounding box.");
  const pixelsPerWorldUnit = Math.min(box.width / 3000, box.height / 3000);
  const screen = (worldX: number, worldY: number) => ({
    x: box.x + box.width / 2 + (worldX - 1000) * pixelsPerWorldUnit,
    y: box.y + box.height / 2 - (worldY - 1000) * pixelsPerWorldUnit,
  });
  const start = screen(400, -100);
  const end = screen(1100, 100);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect(page.getByTestId("stretch-crossing-draft")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("stretch-crossing-draft")).toHaveCount(0);
  const crossingValue = await page.getByLabel("STRETCH crossing").inputValue();
  const coordinates = crossingValue.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(coordinates).toHaveLength(4);
  [400, -100, 1100, 100].forEach((expected, index) => expect(Math.abs(coordinates[index]! - expected)).toBeLessThanOrEqual(0.01));
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveText("STRETCH eelvaade: 2 tulemust · 2 sammu · Δ250,50");
  await capture("F-027-browser-drag.json", { rowId: "F-027", crossingValue, coordinates, preview: "2 results / 2 steps", status: "PASS" });
});

test("F-027 STRETCH creates and edits a physical crossing polygon on the canvas", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:30:00.000Z" });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 800, y: 0 }, radius: 50 },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("STRETCH crossing").fill("");
  await page.getByLabel("STRETCH valikuviis").selectOption("crossing-polygon");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("F-027 drawing canvas has no browser bounding box.");
  const pixelsPerWorldUnit = Math.min(box.width / 3000, box.height / 3000);
  const screen = (worldX: number, worldY: number) => ({
    x: box.x + box.width / 2 + (worldX - 1000) * pixelsPerWorldUnit,
    y: box.y + box.height / 2 - (worldY - 1000) * pixelsPerWorldUnit,
  });
  for (const point of [[400, -100], [1100, -100], [1100, 100]] as const) {
    const pixel = screen(point[0], point[1]);
    await page.mouse.click(pixel.x, pixel.y);
  }
  await expect(page.getByTestId("stretch-polygon-draft").locator("circle")).toHaveCount(3);
  await page.getByRole("button", { name: "STRETCH Undo" }).click();
  await expect(page.getByTestId("stretch-polygon-draft").locator("circle")).toHaveCount(2);
  for (const point of [[1100, 100], [400, 100]] as const) {
    const pixel = screen(point[0], point[1]);
    await page.mouse.click(pixel.x, pixel.y);
  }
  await page.getByRole("button", { name: "Lõpeta STRETCH Polygon" }).click();
  await expect(page.getByTestId("stretch-polygon-draft")).toHaveCount(0);
  const crossingValue = await page.getByLabel("STRETCH crossing").inputValue();
  const coordinates = crossingValue.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(coordinates).toHaveLength(8);
  [400, -100, 1100, -100, 1100, 100, 400, 100].forEach((expected, index) => expect(Math.abs(coordinates[index]! - expected)).toBeLessThanOrEqual(0.01));
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveText("STRETCH eelvaade: 2 tulemust · 2 sammu · Δ250,50");
  await capture("F-027-browser-polygon.json", { rowId: "F-027", crossingValue, coordinates, preview: "2 results / 2 steps", status: "PASS" });
});
