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

function breakDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T06:00:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#40a0ff", lineweightMm: 0.35 }, extensionData: { rowId: "F-026" }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 1500, y: 0 }, radius: 500 },
  ];
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

test("F-026 BREAK two-point and at-point preview equal one atomic commit and exact outputs", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = breakDocument();
  await seedLocalDocument(page, source);

  await page.getByLabel("BREAK sihid").fill("10@500,9>@; 20@2000,0>1500,500");
  await expect(page.getByTestId("break-preview")).toHaveText("BREAK eelvaade: 3 tulemust · 2 sammu");
  await expect(page.getByTestId("break-preview")).toHaveAttribute("data-hidden-source-count", "2");
  await page.getByRole("button", { name: "BREAK Undo" }).click();
  await expect(page.getByLabel("BREAK sihid")).toHaveValue("10@500,9>@");
  await expect(page.getByText("BREAK Undo: viimane siht eemaldatud; 1 jääb")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("BREAK sihid").fill("10@500,9>@; 20@2000,0>1500,500");
  await page.getByRole("button", { name: "BREAK", exact: true }).click();
  await expect(page.getByText("2 BREAK sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, appearance: source.entities[0]!.appearance, extensionData: source.entities[0]!.extensionData });
  expect(committed.entities.find((entity) => entity.handle === "21")).toMatchObject({ kind: "line", start: { x: 500, y: 0 }, end: { x: 1000, y: 0 } });
  const openedCircle = committed.entities.find((entity) => entity.handle === "20");
  expect(openedCircle).toMatchObject({ kind: "arc", center: { x: 1500, y: 0 }, radius: 500, counterClockwise: true });
  if (openedCircle?.kind !== "arc") throw new Error("Expected two-point BREAK to convert the circle to an arc.");
  expect(openedCircle.startAngleRad).toBeCloseTo(Math.PI / 2, 10);
  expect(openedCircle.endAngleRad).toBeCloseTo(Math.PI * 2, 10);

  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({ commandId: "BREAK", targetHandles: ["10", "20"], resultHandles: ["10", "21", "20"], args: { multiple: true } });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.find((entity) => entity.handle === "10")).toMatchObject({ type: "LINE" });
  expect(parsed?.entities.find((entity) => entity.handle === "20")).toMatchObject({ type: "ARC", center: { x: 1500, y: 0 }, radius: 500 });
  expect(parsed?.entities.find((entity) => entity.handle === "21")).toMatchObject({ type: "LINE" });

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
  await capture("F-026-browser.dxf", dxfBytes);
  await capture("F-026-browser.kdraw", kdrawBytes);
  await capture("F-026-browser-matrix.json", { rowId: "F-026", source, committed, operation, restored: restored.document, undoRestored, redone, consoleErrors, status: "PASS" });
});

test("F-026 BREAK physical two-click canvas accepts a free second point and commits projected geometry", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T06:10:00.000Z" });
  source.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } }];
  await seedLocalDocument(page, source);
  await page.getByLabel("BREAK režiim").selectOption("two-point");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const screenPoint = (x: number, y: number) => ({
    x: box!.x + box!.width / 2 + (x - 1000) * pixelsPerWorldUnit,
    y: box!.y + box!.height / 2 - (y - 1000) * pixelsPerWorldUnit,
  });
  const first = screenPoint(250, 1000);
  const second = screenPoint(750, 1200);
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText("BREAK objekt 10 ja esimene punkt valitud; vali teine katkestuspunkt")).toBeVisible();
  await expect(page.getByRole("button", { name: "BREAK", exact: true })).toBeDisabled();
  await page.mouse.click(second.x, second.y);
  await expect(page.getByLabel("BREAK sihid")).toHaveValue(/^10@.*>.*$/u);
  await expect(page.getByTestId("break-preview")).toHaveText("BREAK eelvaade: 2 tulemust · 1 sammu");
  await page.getByRole("button", { name: "BREAK", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 1000 }, end: { x: 250, y: 1000 } },
    { kind: "line", handle: "11", end: { x: 1000, y: 1000 } },
  ]);
  const secondPiece = committed.entities.find((entity) => entity.handle === "11");
  if (secondPiece?.kind !== "line") throw new Error("Expected the second BREAK piece to be a line.");
  expect(secondPiece.start.x).toBeCloseTo(750, 3);
  expect(secondPiece.start.y).toBeCloseTo(1000, 8);
  const [operation] = await readOperations(page);
  expect(operation).toMatchObject({ commandId: "BREAK", targetHandles: ["10"], resultHandles: ["10", "11"] });
  await capture("F-026-browser-canvas.json", { rowId: "F-026", source, committed, operation, status: "PASS" });
});

test("F-026 BREAK at point canvas creates an explicit at-point target and locked input stays unchanged", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T06:20:00.000Z" });
  source.layers.push({ id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true });
  source.entities = [
    { kind: "arc", handle: "10", layerId: "0", center: { x: 1000, y: 1000 }, radius: 400, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
    { kind: "line", handle: "20", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("BREAK režiim").selectOption("at-point");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 400 * pixelsPerWorldUnit);
  await expect(page.getByLabel("BREAK sihid")).toHaveValue(/10@.*>@$/u);
  await page.getByRole("button", { name: "BREAK", exact: true }).click();
  const opened = await readDocument(page);
  expect(opened.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "arc" });
  expect(opened.entities.find((entity) => entity.handle === "21")).toMatchObject({ kind: "arc" });

  await seedLocalDocument(page, source);
  await page.getByLabel("BREAK sihid").fill("20@250,0>750,0");
  await page.getByRole("button", { name: "BREAK", exact: true }).click();
  await expect(page.getByTestId("break-rejected")).toContainText("20#1 (locked-layer)");
  const lockedRestored = await readDocument(page);
  const lockedOperations = await readOperations(page);
  expect(lockedRestored).toEqual(source);
  expect(lockedOperations).toEqual([]);
  await capture("F-026-browser-at-point.json", { rowId: "F-026", source, opened, lockedRestored, lockedOperations, status: "PASS" });
});
