import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw, lengthenEntityLength } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { modelWorldToScreen } from "./helpers/model-space.js";
import { seedKDrawDocument } from "./helpers/indexed-db.js";

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

test("F-028 LENGTHEN preview equals one atomic Multiple commit with Undo/Redo and output readback", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T12:20:00.000Z" });
  source.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", lineweightMm: 0.35 }, extensionData: { rowId: "F-028" } },
    { kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 0, y: 400, startWidth: 2, endWidth: 4 }, { x: 100, y: 400, startWidth: 4, endWidth: 6 }, { x: 100, y: 500, startWidth: 6, endWidth: 8 }] },
    { kind: "line", handle: "40", layerId: "locked", start: { x: 0, y: 800 }, end: { x: 100, y: 800 } },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("LENGTHEN režiim").selectOption("delta");
  await page.getByLabel("LENGTHEN mõõt").selectOption("length");
  await page.getByLabel("LENGTHEN väärtus").fill("25");
  await page.getByLabel("LENGTHEN sihid").fill("10@100,0; 20@100,500; 40@100,800");
  await expect(page.getByTestId("lengthen-preview")).toHaveText("LENGTHEN eelvaade: 2 tulemust · 2 sammu");
  await page.getByRole("button", { name: "LENGTHEN Undo" }).click();
  await expect(page.getByLabel("LENGTHEN sihid")).toHaveValue("10@100,0; 20@100,500");
  expect((await readDocument(page)).revision).toBe(0);
  await page.getByLabel("LENGTHEN sihid").fill("10@100,0; 20@100,500; 40@100,800");
  await page.getByRole("button", { name: "LENGTHEN", exact: true }).click();
  await expect(page.getByText("2 LENGTHEN sammu salvestatud ühe Undo-operatsioonina; 1 jäi muutmata")).toBeVisible();
  await expect(page.getByTestId("lengthen-rejected")).toContainText("40#3 (locked-layer)");

  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities.find((entity) => entity.handle === "10")).toEqual({ ...source.entities[0], end: { x: 125, y: 0 } });
  expect(committed.entities.find((entity) => entity.handle === "20")).toMatchObject({ kind: "polyline", vertices: [{ x: 0, y: 400 }, { x: 100, y: 400, startWidth: 4, endWidth: 6.5 }, { x: 100, y: 525 }] });
  expect(committed.entities.find((entity) => entity.handle === "40")).toEqual(source.entities[2]);
  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({
    commandId: "LENGTHEN", targetHandles: ["10", "20"], resultHandles: ["10", "20"],
    args: { mode: "delta", measurement: "length", value: 25, multiple: true },
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.find((entity) => entity.handle === "10")?.vertices).toMatchObject([{ x: 0, y: 0 }, { x: 125, y: 0 }]);
  expect(parsed?.entities.find((entity) => entity.handle === "20")?.vertices).toMatchObject([{ x: 0, y: 400 }, { x: 100, y: 400, startWidth: 4, endWidth: 6.5 }, { x: 100, y: 525 }]);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  expect((await deserializeKDraw(kdrawBytes)).document.entities).toEqual(committed.entities);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const undoRestored = await readDocument(page);
  expect(undoRestored.entities).toEqual(source.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readDocument(page);
  expect(redone.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);
  await capture("F-028-browser.dxf", dxfBytes);
  await capture("F-028-browser.kdraw", kdrawBytes);
  await capture("F-028-browser-matrix.json", { rowId: "F-028", source, committed, operation, undoRestored, redone, consoleErrors, status: "PASS" });
});

test("F-028 LENGTHEN uses physical canvas endpoint and Dynamic destination picks", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T12:30:00.000Z" });
  source.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }];
  await seedLocalDocument(page, source);
  await page.getByLabel("LENGTHEN režiim").selectOption("dynamic");
  await page.getByLabel("LENGTHEN sihid").fill("");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const endpoint = await modelWorldToScreen(canvas, { x: 1000, y: 0 });
  const destination = await modelWorldToScreen(canvas, { x: 1500, y: 50 });
  await page.mouse.click(endpoint.x, endpoint.y);
  await expect(page.getByText("LENGTHEN Dynamic objekt 10 ja muudetav ots valitud; määra uus otsapunkt")).toBeVisible();
  await page.mouse.click(destination.x, destination.y);
  const targetInput = await page.getByLabel("LENGTHEN sihid").inputValue();
  const coordinates = targetInput.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  expect(coordinates).toHaveLength(5);
  expect(coordinates[0]).toBe(10);
  [1000, 0, 1500, 50].forEach((expected, index) => expect(Math.abs(coordinates[index + 1]! - expected)).toBeLessThanOrEqual(0.001));
  await expect(page.getByTestId("lengthen-preview")).toHaveText("LENGTHEN eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "LENGTHEN", exact: true }).click();
  const committed = await readDocument(page);
  const changed = committed.entities[0]!;
  expect(changed).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: expect.closeTo(1500, 3), y: 0 } });
  expect(lengthenEntityLength(changed)).toBeCloseTo(1500, 3);
  await capture("F-028-browser-dynamic.json", { rowId: "F-028", targetInput, committed, status: "PASS" });
});

test("F-028 LENGTHEN exposes ARC Delta/Total angle variants", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T12:40:00.000Z" });
  source.entities = [{ kind: "arc", handle: "30", layerId: "0", center: { x: 0, y: 0 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true }];
  await seedLocalDocument(page, source);
  await page.getByLabel("LENGTHEN režiim").selectOption("total");
  await page.getByLabel("LENGTHEN mõõt").selectOption("angle");
  await page.getByLabel("LENGTHEN väärtus").fill("180");
  await page.getByLabel("LENGTHEN sihid").fill("30@0,100");
  await expect(page.getByTestId("lengthen-preview")).toHaveText("LENGTHEN eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "LENGTHEN", exact: true }).click();
  expect((await readDocument(page)).entities[0]).toMatchObject({ kind: "arc", startAngleRad: 0, endAngleRad: expect.closeTo(Math.PI, 11), radius: 100 });
});
