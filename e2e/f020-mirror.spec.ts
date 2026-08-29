import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import {
  f020AxisEnd,
  f020AxisStart,
  f020ExpectedCreatedHandles,
  f020ExpectedPreservedEntities,
  f020ExpectedRejected,
  f020ExpectedSourceHandles,
  f020StandardDocument,
} from "../parity/fixtures/f020-standard-fixture.mjs";

type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: unknown };

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
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
  }, structuredClone(f020StandardDocument));
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readDocument(page: import("@playwright/test").Page): Promise<typeof f020StandardDocument> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document as typeof f020StandardDocument;
  });
}

async function readOperations(page: import("@playwright/test").Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const records = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return records.sort((a, b) => a.revision - b.revision).map((record) => record.operation);
  });
}

async function downloadedDxf(page: import("@playwright/test").Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, name), bytes);
  }
  return new DxfParser().parseSync(bytes.toString("utf8"));
}

async function captureJson(name: string, value: unknown): Promise<void> {
  if (!process.env.PARITY_CAPTURE_DIR) return;
  await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
  await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("F-020 MIRROR preselection defaults to keeping sources, exports DXF and undoes atomically", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MIRROR esimene punkt").fill("100,-100");
  await page.getByLabel("MIRROR teine punkt").fill("100,100");
  await expect(page.getByTestId("mirror-preview")).toHaveText("MIRROR eelvaade: 1 · lähteobjektid säilivad");
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("1 objekti peegeldatud; lähteobjektid säilitatud")).toBeVisible();
  const mirrored = await downloadedDxf(page, "F-020-browser-preserved.dxf");
  expect(mirrored?.entities.map((entity) => ({ handle: entity.handle, vertices: entity.vertices }))).toEqual([
    { handle: "10", vertices: [{ x: 10, y: 10, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { handle: "11", vertices: [{ x: 190, y: 10, z: 0 }, { x: 20, y: 90, z: 0 }] },
  ]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities.map((entity) => entity.handle)).toEqual(["10"]);
  expect(consoleErrors).toEqual([]);
});

test("F-020 MIRROR postselection supports erase Yes and rejects a mixed locked-layer target", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Uus kiht" }).click();
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("MIRROR: vali objektid, seejärel kinnita valik ja peegeldusjoon")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti valitud; MIRROR: määra peegeldusjoon ja lähteobjektide valik")).toBeVisible();
  await page.getByLabel("MIRROR esimene punkt").fill("100,-100");
  await page.getByLabel("MIRROR teine punkt").fill("100,100");
  await page.getByLabel("MIRROR kustuta lähteobjektid").check();
  await expect(page.getByTestId("mirror-preview")).toHaveText("MIRROR eelvaade: 1 · lähteobjektid kustutatakse");
  await expect(page.getByTestId("mirror-preview")).toHaveAttribute("data-hidden-source-count", "1");
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("1 objekti peegeldatud; lähteobjektid kustutatud; 1 jäi muutmata")).toBeVisible();
  expect(JSON.parse((await page.getByTestId("mirror-rejected").getAttribute("data-rejected")) ?? "null")).toEqual([
    { handle: "12", reason: "locked-layer" },
  ]);
  const mirrored = await downloadedDxf(page, "F-020-browser-erased-locked.dxf");
  expect(mirrored?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "0", vertices: [{ x: 190, y: 10, z: 0 }, { x: 20, y: 90, z: 0 }] },
    { handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20, z: 0 }, { x: 180, y: 90, z: 0 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-020 MIRROR command-first rejection returns to idle without mutation", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("MIRROR: vali objektid, seejärel kinnita valik ja peegeldusjoon")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MIRROR esimene punkt").fill("5,5");
  await page.getByLabel("MIRROR teine punkt").fill("5,5");
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("MIRROR viga: Mirror line points must not coincide and must define a finite line.")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(1);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("1 objekti valitud", { exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("F-020 MIRROR standard 12-family matrix persists and undoes in one operation", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MIRROR esimene punkt").fill(`${f020AxisStart.x},${f020AxisStart.y}`);
  await page.getByLabel("MIRROR teine punkt").fill(`${f020AxisEnd.x},${f020AxisEnd.y}`);
  await expect(page.getByTestId("mirror-preview")).toHaveText("MIRROR eelvaade: 12 · lähteobjektid säilivad");
  await page.getByRole("button", { name: "MIRROR", exact: true }).click();
  await expect(page.getByText("12 objekti peegeldatud; lähteobjektid säilitatud; 2 jäi muutmata")).toBeVisible();
  const rejected = JSON.parse((await page.getByTestId("mirror-rejected").getAttribute("data-rejected")) ?? "null");
  expect(rejected).toEqual(f020ExpectedRejected);
  const preserved = await readDocument(page);
  expect(preserved.revision).toBe(1);
  expect(preserved.entities).toEqual(f020ExpectedPreservedEntities);
  const operation = (await readOperations(page))[0]!;
  expect(operation).toMatchObject({
    commandId: "MIRROR",
    targetHandles: f020ExpectedSourceHandles,
    resultHandles: f020ExpectedCreatedHandles,
    args: { axisStart: f020AxisStart, axisEnd: f020AxisEnd, eraseSource: false, mirrtext: 0 },
  });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(f020StandardDocument.entities);
  await captureJson("F-020-browser-standard-matrix.json", {
    schemaVersion: 1,
    rowId: "F-020",
    source: "Chromium IndexedDB read-back after real MIRROR UI commit and one atomic UNDO",
    mirrored: { revision: preserved.revision, entities: preserved.entities, operation },
    rejected,
    restored: { revision: restored.revision, entities: restored.entities },
    status: "PASS",
  });
  expect(consoleErrors).toEqual([]);
});
