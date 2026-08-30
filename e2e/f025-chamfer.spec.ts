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

function pairDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:00:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#40a0ff" }, extensionData: { rowId: "F-025" }, start: { x: -1000, y: 0 }, end: { x: 0, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 1000 } },
    { kind: "line", handle: "30", layerId: "0", start: { x: 1000, y: 0 }, end: { x: 2000, y: 0 } },
    { kind: "line", handle: "40", layerId: "0", start: { x: 1000, y: 0 }, end: { x: 1000, y: 1000 } },
  ];
  return document;
}

function dxfRecordPairs(text: string, type: string, handle: string): Array<[number, string]> {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index + 3 < lines.length; index += 2) {
    if (lines[index]?.trim() !== "0" || lines[index + 1]?.trim() !== type) continue;
    const pairs: Array<[number, string]> = [];
    for (let pairIndex = index + 2; pairIndex + 1 < lines.length; pairIndex += 2) {
      const code = Number(lines[pairIndex]?.trim());
      const value = lines[pairIndex + 1]?.trim() ?? "";
      if (code === 0) break;
      pairs.push([code, value]);
    }
    if (pairs.some(([code, value]) => code === 5 && value === handle)) return pairs;
  }
  return [];
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

async function readOperation(page: Page): Promise<RecordedOperation> {
  const rows = await readOperations(page);
  return rows[0]!;
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
    return rows.sort((first, second) => first.revision - second.revision).map((row) => row.operation);
  });
}

test("F-025 CHAMFER Distance Multiple preview equals one atomic commit and Undo/Redo", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const seeded = pairDocument();
  await seedLocalDocument(page, seeded);
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  await page.getByLabel("CHAMFER Method").selectOption("distance");
  await page.getByLabel("CHAMFER esimene kaugus").fill("100");
  await page.getByLabel("CHAMFER teine kaugus").fill("200");
  await page.getByLabel("CHAMFER Trim").selectOption("trim");
  await page.getByLabel("CHAMFER paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 6 tulemust · 2 sammu");
  await expect(page.getByTestId("chamfer-preview")).toHaveAttribute("data-hidden-source-count", "4");

  await page.getByRole("button", { name: "CHAMFER Undo" }).click();
  await expect(page.getByLabel("CHAMFER paarid")).toHaveValue("10@-500,0>20@0,500");
  await expect(page.getByText("CHAMFER Undo: viimane paar eemaldatud; 1 paari jääb")).toBeVisible();
  await page.getByLabel("CHAMFER paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await expect(page.getByText("2 CHAMFER sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", end: { x: -100, y: 0 } },
    { kind: "line", handle: "20", start: { x: 0, y: 200 } },
    { kind: "line", handle: "30", start: { x: 1100, y: 0 } },
    { kind: "line", handle: "40", start: { x: 1000, y: 200 } },
    { kind: "line", handle: "41", start: { x: -100, y: 0 }, end: { x: 0, y: 200 } },
    { kind: "line", handle: "42", start: { x: 1100, y: 0 }, end: { x: 1000, y: 200 } },
  ]);
  const operation = await readOperation(page);
  expect(operation).toMatchObject({ commandId: "CHAMFER", targetHandles: ["10", "20", "30", "40"], resultHandles: ["10", "20", "41", "30", "40", "42"], args: { specification: { method: "distance", firstDistance: 100, secondDistance: 200 }, multiple: true } });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => [entity.handle, entity.type])).toEqual([
    ["10", "LINE"], ["20", "LINE"], ["30", "LINE"], ["40", "LINE"], ["41", "LINE"], ["42", "LINE"],
  ]);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restoredContainer = await deserializeKDraw(kdrawBytes);
  expect(restoredContainer.manifest.documentPath).toBe("document.json");
  expect(restoredContainer.manifest.entries).toHaveLength(1);
  expect(restoredContainer.attachments.size).toBe(0);
  expect(restoredContainer.document.entities).toEqual(committed.entities);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const undoRestored = await readDocument(page);
  expect(undoRestored.entities).toEqual(seeded.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readDocument(page);
  expect(redone.entities).toEqual(committed.entities);
  expect(errors).toEqual([]);
  await capture("F-025-browser.dxf", dxfBytes);
  await capture("F-025-browser.kdraw", kdrawBytes);
  await capture("F-025-browser-matrix.json", { rowId: "F-025", source: seeded, committed, operation, restored: restoredContainer.document, undoRestored, redone, consoleErrors: errors, status: "PASS" });
});

test("F-025 CHAMFER Angle No Trim and Polyline modes preserve their distinct semantics", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const document = pairDocument();
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER Method").selectOption("angle");
  await page.getByLabel("CHAMFER esimene kaugus").fill("100");
  await page.getByLabel("CHAMFER nurk").fill("45");
  await page.getByLabel("CHAMFER Trim").selectOption("no-trim");
  await page.getByLabel("CHAMFER paarid").fill("10@-500,0>20@0,500");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 1 tulemust · 1 sammu");
  await expect(page.getByTestId("chamfer-preview")).toHaveAttribute("data-hidden-source-count", "0");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const noTrim = await readDocument(page);
  expect(noTrim.entities.slice(0, 4)).toEqual(document.entities);
  expect(noTrim.entities[4]).toMatchObject({ kind: "line", start: { x: -100, y: 0 }, end: { x: 0, y: 100 } });
  const angleOperation = await readOperation(page);

  const polylineDocument = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:10:00.000Z" });
  polylineDocument.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] }];
  await seedLocalDocument(page, polylineDocument);
  await page.getByLabel("CHAMFER režiim").selectOption("polyline");
  await page.getByLabel("CHAMFER Method").selectOption("distance");
  await page.getByLabel("CHAMFER esimene kaugus").fill("100");
  await page.getByLabel("CHAMFER teine kaugus").fill("100");
  await page.getByLabel("CHAMFER Trim").selectOption("trim");
  await page.getByLabel("CHAMFER Polyline handle'id").fill("10");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const polyline = await readDocument(page);
  expect(polyline.entities[0]).toMatchObject({ kind: "polyline", handle: "10", vertices: [{ x: 100, y: 0 }, { x: 900, y: 0 }, { x: 1000, y: 100 }, { x: 1000, y: 900 }, { x: 900, y: 1000 }, { x: 100, y: 1000 }, { x: 0, y: 900 }, { x: 0, y: 100 }] });
  const polylineOperation = await readOperation(page);
  expect(errors).toEqual([]);
  await capture("F-025-browser-modes.json", { rowId: "F-025", angleSource: document, noTrim, angleOperation, polylineSource: polylineDocument, polyline, polylineOperation, consoleErrors: errors, status: "PASS" });
});

test("F-025 CHAMFER physical picks use stable objects and Shift only overrides the second pair", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:20:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: 1100 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER esimene kaugus").fill("100");
  await page.getByLabel("CHAMFER teine kaugus").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const first = { x: box!.x + box!.width / 2 - 500 * pixelsPerWorldUnit, y: box!.y + box!.height / 2 };
  const second = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 - 500 * pixelsPerWorldUnit };
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText("CHAMFER esimene objekt: 10; vali teine objekt")).toBeVisible();
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect(page.getByText("CHAMFER Shift-teine objekt: 20; see paar kasutab nullkaugusega teravat nurka")).toBeVisible();
  await expect(page.getByLabel("CHAMFER esimene kaugus")).toHaveValue("100");
  await expect(page.getByLabel("CHAMFER paarid")).toHaveValue(/10@.*>20@.*~0$/u);
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", end: { x: 1000, y: 1000 } },
    { kind: "line", handle: "20", start: { x: 1000, y: 1000 } },
  ]);
  expect(committed.entities).toHaveLength(2);
  expect(await readOperation(page)).toMatchObject({ commandId: "CHAMFER", args: { pairs: [{ sharpCorner: true }] } });
});

test("F-025 CHAMFER Shift no-op preview equals commit and writes no operation", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:25:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: 1000 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  await page.mouse.click(box!.x + box!.width / 2 - 500 * pixelsPerWorldUnit, box!.y + box!.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 500 * pixelsPerWorldUnit);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 0 tulemust · 1 sammu");
  await expect(page.getByTestId("chamfer-preview")).toHaveAttribute("data-hidden-source-count", "0");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await expect(page.getByText("CHAMFER ei muutnud geomeetriat")).toBeVisible();
  const restored = await readDocument(page);
  const operations = await readOperations(page);
  expect(restored).toEqual(document);
  expect(operations).toEqual([]);
  await capture("F-025-browser-shift-no-op.json", { rowId: "F-025", source: document, restored, operations, hiddenSourceCount: 0, status: "PASS" });
});

test("F-025 CHAMFER canvas switches Polyline to pair mode before a Shift pair", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:27:00.000Z" });
  document.entities = [
    { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 1800, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 1200 }, { x: 1800, y: 1200 }] },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "line", handle: "30", layerId: "0", start: { x: 1000, y: 1100 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER režiim").selectOption("polyline");
  await page.getByLabel("CHAMFER Polyline handle'id").fill("10");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  await page.mouse.click(box!.x + box!.width / 2 - 500 * pixelsPerWorldUnit, box!.y + box!.height / 2);
  await expect(page.getByLabel("CHAMFER režiim")).toHaveValue("pairs");
  await page.keyboard.down("Shift");
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 500 * pixelsPerWorldUnit);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 2 tulemust · 1 sammu");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities[0]).toEqual(document.entities[0]);
  expect(committed.entities.slice(1)).toMatchObject([
    { kind: "line", handle: "20", end: { x: 1000, y: 1000 } },
    { kind: "line", handle: "30", start: { x: 1000, y: 1000 } },
  ]);
  const operation = await readOperation(page);
  expect(operation).toMatchObject({ commandId: "CHAMFER", targetHandles: ["20", "30"], args: { mode: "pairs", pairs: [{ sharpCorner: true }] } });
  await capture("F-025-browser-mode-transition.json", { rowId: "F-025", source: document, committed, operation, status: "PASS" });
});

test("F-025 CHAMFER browser and KDraw preserve overlap skips and both closed seam orders", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:29:00.000Z" });
  source.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }] }];
  await seedLocalDocument(page, source);
  await page.getByLabel("CHAMFER režiim").selectOption("polyline");
  await page.getByLabel("CHAMFER Method").selectOption("distance");
  await page.getByLabel("CHAMFER esimene kaugus").fill("20");
  await page.getByLabel("CHAMFER teine kaugus").fill("20");
  await page.getByLabel("CHAMFER Polyline handle'id").fill("10");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const overlap = await readDocument(page);
  expect(overlap.entities[0]).toMatchObject({ kind: "polyline", handle: "10", vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 }] });

  const runSeam = async (firstSegment: 0 | 3, secondSegment: 0 | 3): Promise<{ document: KDrawDocumentV1; operation: RecordedOperation; kdrawBytes: Uint8Array }> => {
    await seedLocalDocument(page, source);
    await page.getByLabel("CHAMFER režiim").selectOption("pairs");
    await page.getByLabel("CHAMFER esimene kaugus").fill("10");
    await page.getByLabel("CHAMFER teine kaugus").fill("20");
    const point = (segment: 0 | 3) => segment === 0 ? "10,0" : "0,10";
    await page.getByLabel("CHAMFER paarid").fill(`10#${firstSegment}@${point(firstSegment)}>10#${secondSegment}@${point(secondSegment)}`);
    await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
    const result = await readDocument(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "KDraw eksport" }).click();
    const path = await (await download).path();
    const kdrawBytes = await readFile(path!);
    const container = await deserializeKDraw(kdrawBytes);
    expect(container.document.entities).toEqual(result.entities);
    return { document: result, operation: await readOperation(page), kdrawBytes };
  };
  const forward = await runSeam(3, 0);
  const reverse = await runSeam(0, 3);
  expect(forward.document.entities[0]).toMatchObject({ kind: "polyline", handle: "10", vertices: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 10 }] });
  expect(reverse.document.entities[0]).toMatchObject({ kind: "polyline", handle: "10", vertices: [{ x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 20 }] });
  await capture("F-025-browser-seam-forward.kdraw", forward.kdrawBytes);
  await capture("F-025-browser-seam-reverse.kdraw", reverse.kdrawBytes);
  await capture("F-025-browser-edge-cases.json", { rowId: "F-025", source, overlap, forward: { document: forward.document, operation: forward.operation }, reverse: { document: reverse.document, operation: reverse.operation }, status: "PASS" });
});

test("F-025 CHAMFER browser uses current layer and second-selection non-colour properties", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-30T01:31:00.000Z" });
  document.layers.push(
    { id: "first", name: "FIRST", visible: true, frozen: false, locked: false, plottable: true },
    { id: "second", name: "SECOND", visible: true, frozen: false, locked: false, plottable: true },
    { id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true },
  );
  document.currentLayerId = "current";
  document.entities = [
    { kind: "line", handle: "10", layerId: "first", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "first-type", lineweightMm: 0.5, transparency: 50 }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
    { kind: "line", handle: "20", layerId: "second", appearance: { color: "#00ff00", colorMethod: "aci", aciIndex: 3, linetypeId: "second-type", lineweightMm: 0.35, transparency: 25 }, start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
  ];
  document.linetypes.push(
    { id: "first-type", name: "FIRST_TYPE", description: "F-025 first", pattern: [5, -2] },
    { id: "second-type", name: "SECOND_TYPE", description: "F-025 second", pattern: [2, -1] },
  );
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  await page.getByLabel("CHAMFER esimene kaugus").fill("10");
  await page.getByLabel("CHAMFER teine kaugus").fill("20");
  await page.getByLabel("CHAMFER Trim").selectOption("no-trim");
  await page.getByLabel("CHAMFER paarid").fill("10@-50,0>20@0,50");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities[2]).toEqual({ kind: "line", handle: "21", layerId: "current", appearance: { lineweightMm: 0.35, transparency: 25 }, start: { x: -10, y: 0 }, end: { x: 0, y: 20 } });
  const kdrawDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const kdrawBytes = await readFile((await (await kdrawDownload).path())!);
  expect((await deserializeKDraw(kdrawBytes)).document.entities).toEqual(committed.entities);
  const dxfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfBytes = await readFile((await (await dxfDownload).path())!);
  const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(dxf?.entities.find((entity) => entity.handle === "21")).toMatchObject({ type: "LINE", layer: "CURRENT", lineweight: 35 });
  await capture("F-025-browser-properties.kdraw", kdrawBytes);
  await capture("F-025-browser-properties.dxf", dxfBytes);
  await capture("F-025-browser-properties.json", { rowId: "F-025", source: document, committed, operation: await readOperation(page), status: "PASS" });
});

test("F-025 CHAMFER rejects locked targets but permits explicit off-layer geometry", async ({ page }) => {
  const document = pairDocument();
  document.layers.push(
    { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "off", name: "OFF", visible: false, frozen: true, locked: false, plottable: true },
  );
  document.entities[0]!.layerId = "locked";
  document.entities[2]!.layerId = "off";
  document.entities[3]!.layerId = "off";
  await seedLocalDocument(page, document);
  await page.getByLabel("CHAMFER esimene kaugus").fill("100");
  await page.getByLabel("CHAMFER teine kaugus").fill("100");
  await page.getByLabel("CHAMFER paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await expect(page.getByTestId("chamfer-rejected")).toContainText("10+20#1 (locked-layer)");
  expect((await readDocument(page)).entities).toHaveLength(5);
  expect(await readOperation(page)).toMatchObject({ commandId: "CHAMFER", targetHandles: ["30", "40"] });
});

test("F-025 CHAMFER browser mirrors AutoCAD RAY/XLINE Trim, forward, reverse and No Trim outputs", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T02:00:00.000Z" });
  const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.5 };
  source.entities = [
    { kind: "ray", handle: "10", layerId: "0", appearance, basePoint: { x: -100, y: 0 }, direction: { x: 4, y: 0 } },
    { kind: "xline", handle: "20", layerId: "0", appearance, basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 3 } },
    { kind: "ray", handle: "30", layerId: "0", appearance, basePoint: { x: 200, y: 200 }, direction: { x: 4, y: 0 } },
    { kind: "xline", handle: "40", layerId: "0", appearance, basePoint: { x: 300, y: 200 }, direction: { x: 0, y: 3 } },
    { kind: "xline", handle: "50", layerId: "0", appearance, basePoint: { x: 400, y: 400 }, direction: { x: 4, y: 0 } },
    { kind: "line", handle: "60", layerId: "0", appearance, start: { x: 500, y: 400 }, end: { x: 500, y: 500 } },
    { kind: "ray", handle: "70", layerId: "0", appearance, basePoint: { x: 600, y: 600 }, direction: { x: 4, y: 0 } },
    { kind: "xline", handle: "80", layerId: "0", appearance, basePoint: { x: 700, y: 600 }, direction: { x: 0, y: 3 } },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  await page.getByLabel("CHAMFER esimene kaugus").fill("10");
  await page.getByLabel("CHAMFER teine kaugus").fill("20");
  await page.getByLabel("CHAMFER Trim").selectOption("trim");
  await page.getByLabel("CHAMFER paarid").fill("10@-50,0>20@0,50; 30@350,200>40@300,250; 50@450,400>60@500,450");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await page.getByLabel("CHAMFER Trim").selectOption("no-trim");
  await page.getByLabel("CHAMFER paarid").fill("70@650,600>80@700,650");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();

  const committed = await readDocument(page);
  expect(committed.entities.find(({ handle }) => handle === "10")).toMatchObject({ kind: "line", start: { x: -100, y: 0 }, end: { x: -10, y: 0 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "20")).toMatchObject({ kind: "ray", basePoint: { x: 0, y: 20 }, direction: { x: 0, y: 1 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "30")).toMatchObject({ kind: "ray", basePoint: { x: 310, y: 200 }, direction: { x: 1, y: 0 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "40")).toMatchObject({ kind: "ray", basePoint: { x: 300, y: 220 }, direction: { x: 0, y: 1 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "50")).toMatchObject({ kind: "ray", basePoint: { x: 490, y: 400 }, direction: { x: -1, y: 0 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "60")).toMatchObject({ kind: "line", start: { x: 500, y: 420 }, end: { x: 500, y: 500 }, appearance });
  expect(committed.entities.find(({ handle }) => handle === "70")).toEqual(source.entities.find(({ handle }) => handle === "70"));
  expect(committed.entities.find(({ handle }) => handle === "80")).toEqual(source.entities.find(({ handle }) => handle === "80"));
  expect(["81", "82", "83", "84"].map((handle) => committed.entities.find((entity) => entity.handle === handle))).toMatchObject([
    { kind: "line", start: { x: -10, y: 0 }, end: { x: 0, y: 20 } },
    { kind: "line", start: { x: 310, y: 200 }, end: { x: 300, y: 220 } },
    { kind: "line", start: { x: 490, y: 400 }, end: { x: 500, y: 420 } },
    { kind: "line", start: { x: 690, y: 600 }, end: { x: 700, y: 620 } },
  ]);
  const operations = await readOperations(page);
  expect(operations).toMatchObject([
    { commandId: "CHAMFER", targetHandles: ["10", "20", "30", "40", "50", "60"], resultHandles: ["10", "20", "81", "30", "40", "82", "50", "60", "83"], args: { trimMode: "trim" } },
    { commandId: "CHAMFER", targetHandles: ["70", "80"], resultHandles: ["84"], args: { trimMode: "no-trim" } },
  ]);

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!); const dxfText = dxfBytes.toString("utf8");
  expect(dxfRecordPairs(dxfText, "RAY", "20")).toEqual(expect.arrayContaining([[10, "0"], [20, "20"], [11, "0"], [21, "1"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "30")).toEqual(expect.arrayContaining([[10, "310"], [20, "200"], [11, "1"], [21, "0"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "40")).toEqual(expect.arrayContaining([[10, "300"], [20, "220"], [11, "0"], [21, "1"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "50")).toEqual(expect.arrayContaining([[10, "490"], [20, "400"], [11, "-1"], [21, "0"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "70")).toEqual(expect.arrayContaining([[10, "600"], [20, "600"], [11, "4"], [21, "0"]]));
  expect(dxfRecordPairs(dxfText, "XLINE", "80")).toEqual(expect.arrayContaining([[10, "700"], [20, "600"], [11, "0"], [21, "3"]]));
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  expect((await deserializeKDraw(kdrawBytes)).document.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);
  await capture("F-025-browser-construction.dxf", dxfBytes);
  await capture("F-025-browser-construction.kdraw", kdrawBytes);
  await capture("F-025-browser-construction.json", { rowId: "F-025", source, committed, operations, consoleErrors, status: "PASS" });
});

test("F-025 CHAMFER zero-distance Polyline and seam pair preserve an exact four-vertex identity", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T02:10:00.000Z" });
  source.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  await seedLocalDocument(page, source);
  await page.getByLabel("CHAMFER režiim").selectOption("polyline");
  await page.getByLabel("CHAMFER esimene kaugus").fill("0");
  await page.getByLabel("CHAMFER teine kaugus").fill("0");
  await page.getByLabel("CHAMFER Polyline handle'id").fill("10");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 0 tulemust · 1 sammu");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await expect(page.getByText("CHAMFER ei muutnud geomeetriat")).toBeVisible();
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  await page.getByLabel("CHAMFER paarid").fill("10#3@0,10>10#0@10,0~0");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 0 tulemust · 1 sammu");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored).toEqual(source);
  expect(await readOperations(page)).toEqual([]);
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path(); const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities[0]).toMatchObject({ type: "LWPOLYLINE", handle: "10", shape: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path(); const kdrawBytes = await readFile(path!);
  expect((await deserializeKDraw(kdrawBytes)).document).toEqual(source);
  await capture("F-025-browser-zero.dxf", dxfBytes);
  await capture("F-025-browser-zero.kdraw", kdrawBytes);
  await capture("F-025-browser-zero.json", { rowId: "F-025", source, restored, operations: [], status: "PASS" });
});

test("F-025 CHAMFER rejects oversized selected-polyline Trim without partial DXF, KDRAW or Undo state", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T02:20:00.000Z" });
  source.entities = [
    { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] },
    { kind: "polyline", handle: "20", layerId: "0", closed: true, vertices: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 5 }, { x: 20, y: 5 }] },
    { kind: "line", handle: "30", layerId: "0", start: { x: 25, y: 0 }, end: { x: 25, y: 100 } },
    { kind: "polyline", handle: "40", layerId: "0", closed: true, vertices: [{ x: 40, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 5 }, { x: 40, y: 5 }] },
    { kind: "polyline", handle: "50", layerId: "0", closed: true, vertices: [{ x: 45, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 5 }, { x: 45, y: 5 }] },
  ];
  await seedLocalDocument(page, source);
  await page.getByLabel("CHAMFER režiim").selectOption("pairs");
  await page.getByLabel("CHAMFER esimene kaugus").fill("10");
  await page.getByLabel("CHAMFER teine kaugus").fill("10");
  await page.getByLabel("CHAMFER Trim").selectOption("trim");
  await page.getByLabel("CHAMFER paarid").fill("10#0@2,0>10#1@5,2; 20#0@22,0>30@25,20; 40#0@42,0>50#3@45,2");
  await expect(page.getByTestId("chamfer-preview")).toHaveText("CHAMFER eelvaade: 0 tulemust · 0 sammu");
  await page.getByRole("button", { name: "CHAMFER", exact: true }).click();
  await expect(page.getByText("CHAMFER ei muutnud geomeetriat; 3 lukus, peidetud, puudu või sobimatu")).toBeVisible();
  await expect(page.getByRole("button", { name: "UNDO", exact: true })).toBeDisabled();
  const restored = await readDocument(page);
  const operations = await readOperations(page);
  expect(restored).toEqual(source);
  expect(operations).toEqual([]);

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path(); const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => ({ type: entity.type, handle: entity.handle }))).toEqual([
    { type: "LWPOLYLINE", handle: "10" }, { type: "LWPOLYLINE", handle: "20" }, { type: "LINE", handle: "30" },
    { type: "LWPOLYLINE", handle: "40" }, { type: "LWPOLYLINE", handle: "50" },
  ]);
  for (const handle of ["10", "20", "40", "50"]) {
    const expected = source.entities.find((entity) => entity.handle === handle);
    const actual = parsed?.entities.find((entity) => entity.handle === handle);
    expect(actual).toMatchObject({ type: "LWPOLYLINE", shape: true, vertices: expected?.kind === "polyline" ? expected.vertices : [] });
  }
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path(); const kdrawBytes = await readFile(path!);
  expect((await deserializeKDraw(kdrawBytes)).document).toEqual(source);
  expect(consoleErrors).toEqual([]);
  await capture("F-025-browser-distance-too-large.dxf", dxfBytes);
  await capture("F-025-browser-distance-too-large.kdraw", kdrawBytes);
  await capture("F-025-browser-distance-too-large.json", { rowId: "F-025", source, restored, operations, consoleErrors, status: "PASS" });
});
