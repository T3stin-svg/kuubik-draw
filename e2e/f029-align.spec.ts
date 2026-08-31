import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw } from "@kuubik/cad-core";
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

test("F-029 ALIGN two-pair Scale Yes preview equals atomic commit, output and Undo/Redo", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T13:00:00.000Z" });
  source.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", lineweightMm: 0.35 }, extensionData: { rowId: "F-029" } },
    { kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 0, y: 200, startWidth: 2, endWidth: 4 }, { x: 100, y: 200, startWidth: 4, endWidth: 6 }] },
    { kind: "line", handle: "30", layerId: "locked", start: { x: 0, y: 400 }, end: { x: 100, y: 400 } },
  ];
  await seedLocalDocument(page, source);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ALIGN punktipaaride arv").selectOption("2");
  await page.getByLabel("ALIGN source 1").fill("0,0");
  await page.getByLabel("ALIGN destination 1").fill("100,200");
  await page.getByLabel("ALIGN source 2").fill("100,0");
  await page.getByLabel("ALIGN destination 2").fill("100,400");
  await page.getByLabel("ALIGN Scale Yes").check();
  await expect(page.getByTestId("align-preview")).toContainText("ALIGN eelvaade: 2 tulemust · 2 paar · 90.000° · ×2.000000");
  await page.getByRole("button", { name: "ALIGN", exact: true }).click();
  await expect(page.getByText("2 objekti joondatud 2 punktipaariga ja ×2.000000 scale'iga ühe Undo-operatsioonina; 1 jäi muutmata")).toBeVisible();
  await expect(page.getByTestId("align-rejected")).toContainText("30 (locked-layer)");

  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 100, y: 200 }, end: { x: 100, y: 400 }, appearance: { color: "#ff0000", lineweightMm: 0.35 } });
  expect(committed.entities.find((entity) => entity.handle === "20")).toMatchObject({ kind: "polyline", vertices: [{ x: -300, y: 200, startWidth: 4, endWidth: 8 }, { x: -300, y: 400, startWidth: 8, endWidth: 12 }] });
  expect(committed.entities.find((entity) => entity.handle === "30")).toEqual(source.entities[2]);
  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({
    commandId: "ALIGN",
    targetHandles: ["10", "20"],
    resultHandles: ["10", "20"],
    args: { targetHandles: ["10", "20", "30"], pointPairCount: 2, scaleToFit: true, scaleFactor: 2 },
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.find((entity) => entity.handle === "10")?.vertices).toMatchObject([{ x: 100, y: 200 }, { x: 100, y: 400 }]);
  expect(parsed?.entities.find((entity) => entity.handle === "20")?.vertices).toMatchObject([{ x: -300, y: 200, startWidth: 4, endWidth: 8 }, { x: -300, y: 400, startWidth: 8, endWidth: 12 }]);

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
  await capture("F-029-browser.dxf", dxfBytes);
  await capture("F-029-browser.kdraw", kdrawBytes);
  await capture("F-029-browser-matrix.json", { rowId: "F-029", source, committed, operation, undoRestored, redone, consoleErrors, status: "PASS" });
});

test("F-029 ALIGN captures four physical canvas points for two-pair rotation", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T13:10:00.000Z" });
  source.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }];
  await seedLocalDocument(page, source);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ALIGN punktipaaride arv").selectOption("2");
  await page.getByLabel("ALIGN source 1").focus();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  for (const point of [[0, 0], [500, 500], [1000, 0], [500, 1500]] as const) {
    const pixel = await modelWorldToScreen(canvas, { x: point[0], y: point[1] });
    await page.mouse.click(pixel.x, pixel.y);
  }
  const values = await Promise.all(["ALIGN source 1", "ALIGN destination 1", "ALIGN source 2", "ALIGN destination 2"].map((label) => page.getByLabel(label).inputValue()));
  const parsedValues = values.map((value) => value.split(",").map(Number));
  [[0, 0], [500, 500], [1000, 0], [500, 1500]].forEach((expected, pointIndex) => {
    expected.forEach((coordinate, coordinateIndex) => expect(Math.abs(parsedValues[pointIndex]![coordinateIndex]! - coordinate)).toBeLessThanOrEqual(0.001));
  });
  await expect(page.getByTestId("align-preview")).toContainText("2 paar · 90.000° · ×1.000000");
  await page.getByRole("button", { name: "ALIGN", exact: true }).click();
  expect((await readDocument(page)).entities[0]).toMatchObject({ kind: "line", start: { x: expect.closeTo(500, 3), y: expect.closeTo(500, 3) }, end: { x: expect.closeTo(500, 3), y: expect.closeTo(1500, 3) } });
});
