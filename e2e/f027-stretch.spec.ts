import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { modelWorldToScreen } from "./helpers/model-space.js";
import { currentKDrawDocument, seedKDrawDocument } from "./helpers/indexed-db.js";

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
  await seedKDrawDocument(page, document);
}

async function readDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
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
      const request = indexedDB.open("kuubik-draw");
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
    { kind: "polyline", handle: "40", layerId: "0", closed: false, vertices: [
      { x: 0, y: 400, bulge: 0.5, startWidth: 2, endWidth: 4 },
      { x: 1000, y: 400, bulge: -0.25, startWidth: 4, endWidth: 6 },
      { x: 2000, y: 400, startWidth: 6, endWidth: 8 },
    ] },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("STRETCH crossing").fill("400,-100; 1100,100 | 790,-10; 810,-10; 810,10; 790,10 | 900,300; 1100,500");
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveText("STRETCH eelvaade: 3 tulemust · 3 sammu · Δ250,50");
  await expect(page.getByTestId("stretch-preview")).toHaveAttribute("data-hidden-source-count", "3");

  await page.getByRole("button", { name: "STRETCH Undo" }).click();
  await expect(page.getByLabel("STRETCH crossing")).toHaveValue("400,-100; 1100,100 | 790,-10; 810,-10; 810,10; 790,10");
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("STRETCH crossing").fill("400,-100; 1100,100 | 790,-10; 810,-10; 810,10; 790,10 | 900,300; 1100,500");
  await page.getByRole("button", { name: "STRETCH", exact: true }).click();
  await expect(page.getByText("2 venitatud ja 1 liigutatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities.find((entity) => entity.handle === "10")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 1250, y: 50 }, appearance: source.entities[0]!.appearance, extensionData: source.entities[0]!.extensionData });
  expect(committed.entities.find((entity) => entity.handle === "20")).toMatchObject({ kind: "circle", center: { x: 1050, y: 50 }, radius: 50 });
  expect(committed.entities.find((entity) => entity.handle === "30")).toEqual(source.entities[2]);
  expect(committed.entities.find((entity) => entity.handle === "40")).toMatchObject({ kind: "polyline", vertices: [
    { x: 0, y: 400, bulge: expect.closeTo(0.39968038348871576, 14), startWidth: 2, endWidth: 4 },
    { x: 1250, y: 450, bulge: expect.closeTo(-0.3325950526188697, 14), startWidth: 4, endWidth: 6 },
    { x: 2000, y: 400, startWidth: 6, endWidth: 8 },
  ] });
  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({ commandId: "STRETCH", targetHandles: ["10", "20", "40"], resultHandles: ["10", "20", "40"], args: { delta: { x: 250, y: 50 } } });

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
  expect(parsed?.entities.find((entity) => entity.handle === "40")?.vertices).toMatchObject([
    { x: 0, y: 400, bulge: expect.closeTo(0.39968038348871576, 14), startWidth: 2, endWidth: 4 },
    { x: 1250, y: 450, bulge: expect.closeTo(-0.3325950526188697, 14), startWidth: 4, endWidth: 6 },
    { x: 2000, y: 400, startWidth: 6, endWidth: 8 },
  ]);

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

test("F-027 STRETCH browser matches native arc-center, ellipse-midpoint, wrapped and whole-anchor semantics", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T09:03:00.000Z" });
  source.entities = [
    { kind: "arc", handle: "A1", layerId: "0", center: { x: 0, y: 1000 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
    { kind: "ellipse", handle: "E1", layerId: "0", center: { x: 500, y: 1000 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 },
    { kind: "ellipse", handle: "E2", layerId: "0", center: { x: 1000, y: 1000 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 5.5, endParameter: 7 },
    { kind: "ellipse", handle: "E3", layerId: "0", center: { x: 1500, y: 1000 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
    { kind: "circle", handle: "C1", layerId: "0", center: { x: 2000, y: 1000 }, radius: 100 },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("STRETCH crossing").fill([
    "-10,990; 10,1110",
    "560,1025; 580,1045",
    "1065,1020; 1085,1045",
    "1490,990; 1610,1010",
    "1990,990; 2110,1010",
  ].join(" | "));
  await page.getByLabel("STRETCH baaspunkt").fill("0,0");
  await page.getByLabel("STRETCH sihtpunkt").fill("@25,5");
  await expect(page.getByTestId("stretch-preview")).toHaveText("STRETCH eelvaade: 3 tulemust · 3 sammu · Δ25,5");
  await page.getByRole("button", { name: "STRETCH", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities.find((entity) => entity.handle === "A1")).toEqual(source.entities[0]);
  expect(committed.entities.find((entity) => entity.handle === "E1")).toEqual(source.entities[1]);
  expect(committed.entities.find((entity) => entity.handle === "E2")).toMatchObject({
    kind: "ellipse",
    center: { x: expect.closeTo(1016.321187837475, 10), y: expect.closeTo(1024.7416264179425, 10) },
    majorAxis: { x: expect.closeTo(-95.68145757452969, 10), y: expect.closeTo(29.35210104127352, 10) },
    ratio: expect.closeTo(0.576564048333548, 10),
    startParameter: expect.closeTo(2.341890538582327, 10),
    endParameter: expect.closeTo(3.841890538582323, 10),
  });
  expect(committed.entities.find((entity) => entity.handle === "E3")).toMatchObject({ kind: "ellipse", center: { x: 1525, y: 1005 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5 });
  expect(committed.entities.find((entity) => entity.handle === "C1")).toMatchObject({ kind: "circle", center: { x: 2025, y: 1005 }, radius: 100 });
  expect(consoleErrors).toEqual([]);
  await capture("F-027-browser-native-edge-matrix.json", { rowId: "F-027", source, committed, consoleErrors, status: "PASS" });
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
  expect(lockedRestored).toEqual(currentKDrawDocument(source));
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
  const start = await modelWorldToScreen(canvas, { x: 400, y: -100 });
  const end = await modelWorldToScreen(canvas, { x: 1100, y: 100 });
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
  for (const point of [[400, -100], [1100, -100], [1100, 100]] as const) {
    const pixel = await modelWorldToScreen(canvas, { x: point[0], y: point[1] });
    await page.mouse.click(pixel.x, pixel.y);
  }
  await expect(page.getByTestId("stretch-polygon-draft").locator("circle")).toHaveCount(3);
  await page.getByRole("button", { name: "STRETCH Undo" }).click();
  await expect(page.getByTestId("stretch-polygon-draft").locator("circle")).toHaveCount(2);
  for (const point of [[1100, 100], [400, 100]] as const) {
    const pixel = await modelWorldToScreen(canvas, { x: point[0], y: point[1] });
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
