import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import {
  f019BasePoint,
  f019ExpectedCommittedEntities,
  f019ExpectedRejected,
  f019ExpectedScaledHandles,
  f019NewLength,
  f019ReferenceLength,
  f019ReferencePoints,
  f019StandardDocument,
} from "../parity/fixtures/f019-standard-fixture.mjs";

async function downloadBytes(download: { path(): Promise<string | null> }, captureName: string): Promise<Buffer> {
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const captureRoot = process.env.PARITY_CAPTURE_DIR;
  if (captureRoot) {
    await mkdir(resolve(captureRoot), { recursive: true });
    await writeFile(resolve(captureRoot, captureName), bytes);
  }
  return bytes;
}

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function seedLocalDocument(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/d/local");
  await page.evaluate(async (document) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const transaction = database.transaction(["documents", "operations", "snapshots"], "readwrite");
      transaction.objectStore("documents").put(document);
      transaction.objectStore("operations").clear();
      transaction.objectStore("snapshots").clear();
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => rejectWrite(transaction.error);
      transaction.onabort = () => rejectWrite(transaction.error);
    });
    database.close();
  }, structuredClone(f019StandardDocument));
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readLocalDocument(page: import("@playwright/test").Page): Promise<typeof f019StandardDocument> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<unknown>((resolveRead, rejectRead) => {
      const transaction = database.transaction("documents", "readonly");
      const request = transaction.objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document as typeof f019StandardDocument;
  });
}

type RecordedOperation = { opId: string; baseRevision: number; commandId: string; targetHandles: string[]; resultHandles: string[]; args: unknown };
async function readOperations(page: import("@playwright/test").Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const records = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      const transaction = database.transaction("operations", "readonly");
      const request = transaction.objectStore("operations").getAll();
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return records.sort((a, b) => a.revision - b.revision).map((record) => record.operation);
  });
}

async function captureJson(name: string, value: unknown): Promise<void> {
  const captureRoot = process.env.PARITY_CAPTURE_DIR;
  if (!captureRoot) return;
  await mkdir(resolve(captureRoot), { recursive: true });
  await writeFile(resolve(captureRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("F-019 SCALE preselection, numeric factor, DXF and atomic UNDO", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByLabel("Esimene nurk").fill("0,1000");
  await page.getByLabel("Teine nurk").fill("1000,1500");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SCALE baaspunkt").fill("0,0");
  await page.getByLabel("SCALE kordaja").fill("2");
  await expect(page.getByTestId("scale-preview")).toHaveText("SCALE eelvaade: 2 · ×2");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("2 objekti skaleeritud ×2")).toBeVisible();

  const scaledDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const scaled = new DxfParser().parseSync((await downloadBytes(await scaledDownload, "F-019-browser-scaled.dxf")).toString("utf8"));
  expect(scaled?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, shape: entity.shape, vertices: entity.vertices }))).toEqual([
    { type: "LINE", handle: "10", shape: undefined, vertices: [{ x: 20, y: 20, z: 0 }, { x: 360, y: 180, z: 0 }] },
    { type: "LWPOLYLINE", handle: "11", shape: true, vertices: [{ x: 0, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }] },
  ]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 4")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 4")).toBeVisible();
  const restoredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const restored = new DxfParser().parseSync((await downloadBytes(await restoredDownload, "F-019-browser-restored.dxf")).toString("utf8"));
  expect(restored?.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  expect(consoleErrors).toEqual([]);
});

test("F-019 SCALE postselection, numeric Reference, point new length and mixed locked layer", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Uus kiht" }).click();
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();

  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("SCALE: vali objektid, seejärel kinnita valik, baaspunkt ja mõõtkava")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti valitud; SCALE: määra baaspunkt ja mõõtkava")).toBeVisible();
  await page.getByLabel("SCALE baaspunkt").fill("0,0");
  await page.getByLabel("SCALE režiim").selectOption("reference");
  await page.getByLabel("SCALE Reference").fill("1000");
  await page.getByLabel("SCALE uus pikkus").fill("2000,0");
  await expect(page.getByTestId("scale-preview")).toHaveText("SCALE eelvaade: 1 · ×2");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("1 objekti skaleeritud ×2; 1 jäi muutmata")).toBeVisible();
  expect(JSON.parse((await page.getByTestId("scale-rejected").getAttribute("data-rejected")) ?? "null")).toEqual([
    { handle: "12", reason: "locked-layer" },
  ]);
  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();

  const mixedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const mixed = new DxfParser().parseSync((await downloadBytes(await mixedDownload, "F-019-browser-locked.dxf")).toString("utf8"));
  expect(mixed?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "0", vertices: [{ x: 20, y: 20, z: 0 }, { x: 360, y: 180, z: 0 }] },
    { handle: "12", layer: "layer-1", vertices: [{ x: 10, y: 20, z: 0 }, { x: 180, y: 90, z: 0 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-019 SCALE rejects invalid factors and gives factor one an AutoCAD-compatible undo entry", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SCALE baaspunkt").fill("0,0");
  await page.getByLabel("SCALE kordaja").fill("2,0");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("SCALE viga: Scale factor must be greater than zero.")).toBeVisible();

  await page.getByLabel("SCALE kordaja").fill("0");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("SCALE viga: Scale factor must be greater than zero.")).toBeVisible();
  await page.getByLabel("SCALE kordaja").fill("-2");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("SCALE viga: Scale factor must be greater than zero.")).toBeVisible();
  await page.getByLabel("SCALE kordaja").fill("1");
  await expect(page.getByTestId("scale-preview")).toHaveText("SCALE eelvaade: 0 · ×1");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("SCALE ×1 kinnitatud; geomeetria muutumata")).toBeVisible();
  await expect(page.getByRole("button", { name: "UNDO", exact: true })).toBeEnabled();
  const noOpDocument = await readLocalDocument(page);
  expect(noOpDocument.revision).toBe(2);
  expect(noOpDocument.entities[0]).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 180, y: 90 } });
  const factorOneOperations = await readOperations(page);
  expect(factorOneOperations.map((operation) => operation.commandId)).toEqual(["LINE", "SCALE"]);
  expect(factorOneOperations[1]).toMatchObject({
    commandId: "SCALE", targetHandles: ["10"], resultHandles: [],
    args: { factor: 1, copy: false, geometryNoOp: true },
  });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 3")).toBeVisible();
  const afterOneUndo = await readLocalDocument(page);
  expect(afterOneUndo.entities[0]).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 180, y: 90 } });
  const afterUndoOperations = await readOperations(page);
  expect(afterUndoOperations.map((operation) => operation.commandId)).toEqual(["LINE", "SCALE", "UNDO"]);
  await captureJson("F-019-browser-factor-one-undo.json", {
    schemaVersion: 1,
    rowId: "F-019",
    source: "Chromium IndexedDB read-back after LINE, factor-one SCALE and one UNDO",
    factorOne: { revision: noOpDocument.revision, entities: noOpDocument.entities, operations: factorOneOperations },
    afterOneUndo: { revision: afterOneUndo.revision, entities: afterOneUndo.entities, operations: afterUndoOperations },
    status: "PASS",
  });
  expect(consoleErrors).toEqual([]);
});

test("F-019 SCALE Copy uses one-point Reference and two-point new length", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SCALE baaspunkt").fill("0,0");
  await page.getByLabel("SCALE režiim").selectOption("reference");
  await page.getByLabel("SCALE Reference").fill("1000,0");
  await page.getByLabel("SCALE uus pikkus").fill("3000,2000; 3000,4000");
  await page.getByLabel("SCALE Copy").check();
  await expect(page.getByTestId("scale-preview")).toHaveText("SCALE eelvaade: 1 · ×2 · Copy");
  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("1 objekti kopeeritud ja skaleeritud ×2")).toBeVisible();
  const operations = await readOperations(page);
  expect(operations.at(-1)).toMatchObject({
    commandId: "SCALE",
    baseRevision: 1,
    targetHandles: ["10"],
    resultHandles: ["11"],
    args: {
      basePoint: { x: 0, y: 0 },
      scale: { mode: "reference", referenceLength: 1000, newLength: 2000 },
      factor: 2,
      copy: true,
    },
  });

  const copiedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const copied = new DxfParser().parseSync((await downloadBytes(await copiedDownload, "F-019-browser-copied.dxf")).toString("utf8"));
  expect(copied?.entities.map((entity) => ({ handle: entity.handle, vertices: entity.vertices }))).toEqual([
    { handle: "10", vertices: [{ x: 10, y: 10, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { handle: "11", vertices: [{ x: 20, y: 20, z: 0 }, { x: 360, y: 180, z: 0 }] },
  ]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readLocalDocument(page)).entities.map((entity) => entity.handle)).toEqual(["10"]);
  expect(consoleErrors).toEqual([]);
});

test("F-019 SCALE two-point Reference standard matrix persists and undoes atomically", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page);
  await expect(page.getByText("14 objekti · 0 valitud")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SCALE baaspunkt").fill(`${f019BasePoint.x},${f019BasePoint.y}`);
  await page.getByLabel("SCALE režiim").selectOption("reference");
  await page.getByLabel("SCALE Reference").fill(f019ReferencePoints.map((point) => `${point.x},${point.y}`).join("; "));
  await page.getByLabel("SCALE uus pikkus").fill(String(f019NewLength));
  await expect(page.getByTestId("scale-preview")).toHaveText("SCALE eelvaade: 12 · ×2");

  await page.getByRole("button", { name: "SCALE", exact: true }).click();
  await expect(page.getByText("12 objekti skaleeritud ×2; 2 jäi muutmata")).toBeVisible();
  const runtimeRejected = JSON.parse((await page.getByTestId("scale-rejected").getAttribute("data-rejected")) ?? "null");
  expect(runtimeRejected).toEqual(f019ExpectedRejected);
  const scaled = await readLocalDocument(page);
  expect(scaled.revision).toBe(1);
  expect(scaled.entities).toEqual(f019ExpectedCommittedEntities);
  const operation = (await readOperations(page))[0];
  expect(operation?.targetHandles).toEqual(f019ExpectedScaledHandles);
  expect(operation?.resultHandles).toEqual(f019ExpectedScaledHandles);
  expect(operation?.args).toEqual({
    basePoint: f019BasePoint,
    scale: { mode: "reference", referenceLength: f019ReferenceLength, newLength: f019NewLength },
    factor: 2,
    copy: false,
  });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 2")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 2")).toBeVisible();
  const restored = await readLocalDocument(page);
  expect(restored.entities).toEqual(f019StandardDocument.entities);
  await captureJson("F-019-browser-standard-matrix.json", {
    schemaVersion: 1,
    rowId: "F-019",
    source: "Chromium IndexedDB read-back after real SCALE Reference UI commit and one UNDO",
    scaled: { revision: scaled.revision, entities: scaled.entities, scaledHandles: operation?.resultHandles, args: operation?.args },
    rejected: runtimeRejected,
    restored: { revision: restored.revision, entities: restored.entities },
    status: "PASS",
  });
  expect(consoleErrors).toEqual([]);
});
