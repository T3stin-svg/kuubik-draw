import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import {
  f017BasePoint,
  f017DestinationPoints,
  f017ExpectedCommittedEntities,
  f017ExpectedCopiedHandles,
  f017ExpectedRejected,
  f017ExpectedSourceHandles,
  f017StandardDocument,
} from "../parity/fixtures/f017-standard-fixture.mjs";

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
  }, structuredClone(f017StandardDocument));
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readLocalDocument(page: import("@playwright/test").Page): Promise<typeof f017StandardDocument> {
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
    return document as typeof f017StandardDocument;
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

test("F-017 COPY preselection, repeated original-relative placements, DXF and atomic UNDO", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByLabel("Esimene nurk").fill("0,1000");
  await page.getByLabel("Teine nurk").fill("1000,1500");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("COPY baaspunkt").fill("100,200");
  await page.getByLabel("COPY sihtpunktid").fill("600,950; -200,300");
  await expect(page.getByTestId("copy-preview")).toHaveText("COPY eelvaade: 4 · 2 paigutust");
  await expect(page.getByText("2 objekti · 2 valitud")).toBeVisible();

  await page.getByRole("button", { name: "COPY", exact: true }).click();
  await expect(page.getByText("4 koopiat loodud · 2 paigutust")).toBeVisible();
  await expect(page.getByText("6 objekti · 0 valitud")).toBeVisible();

  const copiedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const copied = new DxfParser().parseSync((await downloadBytes(await copiedDownload, "F-017-browser-copied.dxf")).toString("utf8"));
  expect(copied?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, shape: entity.shape, vertices: entity.vertices }))).toEqual([
    { type: "LINE", handle: "10", shape: undefined, vertices: [{ x: 10, y: 10, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { type: "LWPOLYLINE", handle: "11", shape: true, vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
    { type: "LINE", handle: "12", shape: undefined, vertices: [{ x: 510, y: 760, z: 0 }, { x: 680, y: 840, z: 0 }] },
    { type: "LWPOLYLINE", handle: "13", shape: true, vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
    { type: "LINE", handle: "14", shape: undefined, vertices: [{ x: -290, y: 110, z: 0 }, { x: -120, y: 190, z: 0 }] },
    { type: "LWPOLYLINE", handle: "15", shape: true, vertices: [{ x: -300, y: 1100 }, { x: 700, y: 1100 }, { x: 700, y: 1600 }, { x: -300, y: 1600 }] },
  ]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 4")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 4")).toBeVisible();
  const restoredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const restored = new DxfParser().parseSync((await downloadBytes(await restoredDownload, "F-017-browser-restored.dxf")).toString("utf8"));
  expect(restored?.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  expect(consoleErrors).toEqual([]);
});

test("F-017 COPY postselection, one @relative destination and mixed locked layer", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Uus kiht" }).click();
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();

  await page.getByRole("button", { name: "COPY", exact: true }).click();
  await expect(page.getByText("COPY: vali objektid, seejärel kinnita valik ja punktid")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti valitud; COPY: määra baaspunkt ja sihtpunkt(id)")).toBeVisible();
  await page.getByLabel("COPY baaspunkt").fill("0,0");
  await page.getByLabel("COPY sihtpunktid").fill("@100,50");
  await expect(page.getByTestId("copy-preview")).toHaveText("COPY eelvaade: 1 · 1 paigutust");
  await page.getByRole("button", { name: "COPY", exact: true }).click();
  await expect(page.getByText("1 koopiat loodud · 1 paigutust; 1 jäi kopeerimata")).toBeVisible();
  expect(JSON.parse((await page.getByTestId("copy-rejected").getAttribute("data-rejected")) ?? "null")).toEqual([
    { handle: "12", reason: "locked-layer" },
  ]);
  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();

  const mixedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const mixed = new DxfParser().parseSync((await downloadBytes(await mixedDownload, "F-017-browser-locked.dxf")).toString("utf8"));
  expect(mixed?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "0", vertices: [{ x: 10, y: 10, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { handle: "13", layer: "0", vertices: [{ x: 110, y: 60, z: 0 }, { x: 280, y: 140, z: 0 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-017 COPY accepts a coincident destination as a real copy", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("COPY baaspunkt").fill("200,300");
  await page.getByLabel("COPY sihtpunktid").fill("200,300");
  await expect(page.getByTestId("copy-preview")).toHaveText("COPY eelvaade: 1 · 1 paigutust");
  await page.getByRole("button", { name: "COPY", exact: true }).click();
  await expect(page.getByText("1 koopiat loodud · 1 paigutust")).toBeVisible();
  const stored = await readLocalDocument(page);
  expect(stored.entities).toEqual([
    { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-017 COPY standard entity matrix preserves originals/properties, persists and undoes atomically", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page);
  await expect(page.getByText("14 objekti · 0 valitud")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("COPY baaspunkt").fill(`${f017BasePoint.x},${f017BasePoint.y}`);
  await page.getByLabel("COPY sihtpunktid").fill(f017DestinationPoints.map((point) => `${point.x},${point.y}`).join("; "));
  await expect(page.getByTestId("copy-preview")).toHaveText("COPY eelvaade: 24 · 2 paigutust");

  await page.getByRole("button", { name: "COPY", exact: true }).click();
  await expect(page.getByText("24 koopiat loodud · 2 paigutust; 2 jäi kopeerimata")).toBeVisible();
  const runtimeRejected = JSON.parse((await page.getByTestId("copy-rejected").getAttribute("data-rejected")) ?? "null");
  expect(runtimeRejected).toEqual(f017ExpectedRejected);
  const copied = await readLocalDocument(page);
  expect(copied.revision).toBe(1);
  expect(copied.entities).toEqual(f017ExpectedCommittedEntities);
  const operation = await readFirstOperation(page);
  expect(operation?.targetHandles).toEqual(f017ExpectedSourceHandles);
  expect(operation?.resultHandles).toEqual(f017ExpectedCopiedHandles);
  expect(operation?.args).toEqual({ basePoint: f017BasePoint, destinationPoints: f017DestinationPoints });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 2")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 2")).toBeVisible();
  const restored = await readLocalDocument(page);
  expect(restored.entities).toEqual(f017StandardDocument.entities);
  await captureJson("F-017-browser-standard-matrix.json", {
    schemaVersion: 1,
    rowId: "F-017",
    source: "Chromium IndexedDB read-back after real repeated COPY UI commit and one UNDO",
    copied: { revision: copied.revision, entities: copied.entities, sourceHandles: operation?.targetHandles, copiedHandles: operation?.resultHandles },
    rejected: runtimeRejected,
    restored: { revision: restored.revision, entities: restored.entities },
    status: "PASS",
  });
  expect(consoleErrors).toEqual([]);
});
