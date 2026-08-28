import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import {
  f018BasePoint,
  f018ExpectedCommittedEntities,
  f018ExpectedRejected,
  f018ExpectedRotatedHandles,
  f018NewAngleDeg,
  f018ReferenceAngleDeg,
  f018ReferencePoints,
  f018StandardDocument,
} from "../parity/fixtures/f018-standard-fixture.mjs";

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
  }, structuredClone(f018StandardDocument));
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readLocalDocument(page: import("@playwright/test").Page): Promise<typeof f018StandardDocument> {
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
    return document as typeof f018StandardDocument;
  });
}

async function readFirstOperation(page: import("@playwright/test").Page): Promise<{
  targetHandles: string[];
  resultHandles: string[];
  args: unknown;
} | undefined> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const records = await new Promise<Array<{ operation: { targetHandles: string[]; resultHandles: string[]; args: unknown } }>>((resolveRead, rejectRead) => {
      const transaction = database.transaction("operations", "readonly");
      const request = transaction.objectStore("operations").getAll();
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return records[0]?.operation;
  });
}

async function captureJson(name: string, value: unknown): Promise<void> {
  const captureRoot = process.env.PARITY_CAPTURE_DIR;
  if (!captureRoot) return;
  await mkdir(resolve(captureRoot), { recursive: true });
  await writeFile(resolve(captureRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("F-018 ROTATE preselection, numeric angle, DXF and atomic UNDO", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByLabel("Esimene nurk").fill("0,1000");
  await page.getByLabel("Teine nurk").fill("1000,1500");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ROTATE baaspunkt").fill("0,0");
  await page.getByLabel("ROTATE nurk").fill("90");
  await expect(page.getByTestId("rotate-preview")).toHaveText("ROTATE eelvaade: 2 · 90°");
  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("2 objekti pööratud 90°")).toBeVisible();

  const rotatedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const rotated = new DxfParser().parseSync((await downloadBytes(await rotatedDownload, "F-018-browser-rotated.dxf")).toString("utf8"));
  expect(rotated?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, shape: entity.shape, vertices: entity.vertices }))).toEqual([
    { type: "LINE", handle: "10", shape: undefined, vertices: [{ x: -10, y: 10, z: 0 }, { x: -90, y: 180, z: 0 }] },
    { type: "LWPOLYLINE", handle: "11", shape: true, vertices: [{ x: -1000, y: 0 }, { x: -1000, y: 1000 }, { x: -1500, y: 1000 }, { x: -1500, y: 0 }] },
  ]);

  await page.getByRole("button", { name: "UNDO" }).click();
  await expect(page.getByText("UNDO taastatud, revision 4")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 4")).toBeVisible();
  const restoredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const restored = new DxfParser().parseSync((await downloadBytes(await restoredDownload, "F-018-browser-restored.dxf")).toString("utf8"));
  expect(restored?.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  expect(consoleErrors).toEqual([]);
});

test("F-018 ROTATE postselection, numeric Reference, point target and mixed locked layer", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Uus kiht" }).click();
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();

  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("ROTATE: vali objektid, seejärel kinnita valik, baaspunkt ja nurk")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti valitud; ROTATE: määra baaspunkt ja nurk")).toBeVisible();
  await page.getByLabel("ROTATE baaspunkt").fill("0,0");
  await page.getByLabel("ROTATE režiim").selectOption("reference");
  await page.getByLabel("ROTATE Reference").fill("0");
  await page.getByLabel("ROTATE uus nurk").fill("0,1000");
  await expect(page.getByTestId("rotate-preview")).toHaveText("ROTATE eelvaade: 1 · 90°");
  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("1 objekti pööratud 90°; 1 jäi muutmata")).toBeVisible();
  expect(JSON.parse((await page.getByTestId("rotate-rejected").getAttribute("data-rejected")) ?? "null")).toEqual([
    { handle: "12", reason: "locked-layer" },
  ]);
  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();

  const mixedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const mixed = new DxfParser().parseSync((await downloadBytes(await mixedDownload, "F-018-browser-locked.dxf")).toString("utf8"));
  expect(mixed?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "0", vertices: [{ x: -10, y: 10, z: 0 }, { x: -90, y: 180, z: 0 }] },
    { handle: "12", layer: "layer-1", vertices: [{ x: 10, y: 20, z: 0 }, { x: 180, y: 90, z: 0 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-018 ROTATE point angle, clockwise rotation, coincident Reference rejection and equal-angle no-op", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ROTATE baaspunkt").fill("0,0");
  await page.getByLabel("ROTATE nurk").fill("0,-1000");
  await expect(page.getByTestId("rotate-preview")).toHaveText("ROTATE eelvaade: 1 · -90°");
  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("1 objekti pööratud -90°")).toBeVisible();
  expect((await readLocalDocument(page)).entities[0]).toMatchObject({ start: { x: 10, y: -10 }, end: { x: 90, y: -180 } });
  await page.getByRole("button", { name: "UNDO" }).click();

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ROTATE režiim").selectOption("reference");
  await page.getByLabel("ROTATE Reference").fill("0,0; 0,0");
  await page.getByLabel("ROTATE uus nurk").fill("90");
  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("ROTATE viga: Angle points must not coincide.")).toBeVisible();
  await page.getByLabel("ROTATE Reference").fill("1000,1000");
  await page.getByLabel("ROTATE uus nurk").fill("45");
  await expect(page.getByTestId("rotate-preview")).toHaveText("ROTATE eelvaade: 0 · 0°");
  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("ROTATE ei muutnud geomeetriat")).toBeVisible();
  await expect(page.getByRole("button", { name: "UNDO" })).toBeDisabled();
  const noOpDocument = await readLocalDocument(page);
  expect(noOpDocument.revision).toBe(3);
  expect(noOpDocument.entities[0]).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 180, y: 90 } });
  expect(consoleErrors).toEqual([]);
});

test("F-018 ROTATE two-point Reference standard matrix persists and undoes atomically", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page);
  await expect(page.getByText("14 objekti · 0 valitud")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("ROTATE baaspunkt").fill(`${f018BasePoint.x},${f018BasePoint.y}`);
  await page.getByLabel("ROTATE režiim").selectOption("reference");
  await page.getByLabel("ROTATE Reference").fill(f018ReferencePoints.map((point) => `${point.x},${point.y}`).join("; "));
  await page.getByLabel("ROTATE uus nurk").fill(String(f018NewAngleDeg));
  await expect(page.getByTestId("rotate-preview")).toHaveText("ROTATE eelvaade: 12 · 90°");

  await page.getByRole("button", { name: "ROTATE", exact: true }).click();
  await expect(page.getByText("12 objekti pööratud 90°; 2 jäi muutmata")).toBeVisible();
  const runtimeRejected = JSON.parse((await page.getByTestId("rotate-rejected").getAttribute("data-rejected")) ?? "null");
  expect(runtimeRejected).toEqual(f018ExpectedRejected);
  const rotated = await readLocalDocument(page);
  expect(rotated.revision).toBe(1);
  expect(rotated.entities).toEqual(f018ExpectedCommittedEntities);
  const operation = await readFirstOperation(page);
  expect(operation?.targetHandles).toEqual(f018ExpectedRotatedHandles);
  expect(operation?.resultHandles).toEqual(f018ExpectedRotatedHandles);
  expect(operation?.args).toEqual({
    basePoint: f018BasePoint,
    angle: { mode: "reference", referenceAngleDeg: f018ReferenceAngleDeg, newAngleDeg: f018NewAngleDeg },
    deltaAngleDeg: 90,
  });

  await page.getByRole("button", { name: "UNDO" }).click();
  await expect(page.getByText("UNDO taastatud, revision 2")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 2")).toBeVisible();
  const restored = await readLocalDocument(page);
  expect(restored.entities).toEqual(f018StandardDocument.entities);
  await captureJson("F-018-browser-standard-matrix.json", {
    schemaVersion: 1,
    rowId: "F-018",
    source: "Chromium IndexedDB read-back after real ROTATE Reference UI commit and one UNDO",
    rotated: { revision: rotated.revision, entities: rotated.entities, rotatedHandles: operation?.resultHandles, args: operation?.args },
    rejected: runtimeRejected,
    restored: { revision: restored.revision, entities: restored.entities },
    status: "PASS",
  });
  expect(consoleErrors).toEqual([]);
});
