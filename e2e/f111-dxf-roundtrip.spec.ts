import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "../packages/cad-core/src/index.js";
import { exportDxf } from "../packages/cad-dxf/src/index.js";
import { createF109Document } from "../parity/fixtures/f109-document.js";

const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function paperAwareDocument() {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T08:00:00.000Z" });
  document.linetypes.push({ id: "paper-lt", name: "PAPER DASH", pattern: [2, -1] });
  document.layers.push({ id: "dxf-layer:JOONED", name: "PAPER TITLE", visible: true, frozen: false, locked: false, plottable: true, appearance: { linetypeId: "paper-lt" } });
  document.blocks.push({ id: "title-block", name: "TITLE BLOCK", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "1001", layerId: "dxf-layer:JOONED", start: { x: 10, y: 10 }, end: { x: 80, y: 10 } }] });
  document.layouts.push({
    id: "sheet",
    name: "Sheet",
    kind: "paper",
    paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [{ id: "vp", center: { x: 100, y: 80 }, width: 180, height: 120, viewCenter: { x: 2500, y: 2000 }, viewHeight: 5000, twistAngleRad: 0, locked: true, layerOverrides: { "dxf-layer:JOONED": { frozen: true, linetypeId: "paper-lt" } } }],
    entities: [{ kind: "blockRef", handle: "1000", layerId: "dxf-layer:JOONED", blockId: "title-block", insertion: { x: 10, y: 10 }, scale: { x: 1, y: 1 }, rotationRad: 0 }],
  });
  return document;
}

async function seedLocalDocument(page: Page, document = createEmptyDocument({ documentId: "local", now: "2026-08-29T08:00:00.000Z" })): Promise<void> {
  await page.goto("/d/local");
  await page.evaluate(async (value) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains("documents")) next.createObjectStore("documents", { keyPath: "documentId" });
        if (!next.objectStoreNames.contains("operations")) {
          const store = next.createObjectStore("operations", { keyPath: "opId" });
          store.createIndex("byDocument", "documentId");
        }
        if (!next.objectStoreNames.contains("snapshots")) next.createObjectStore("snapshots", { keyPath: "key" });
        if (!next.objectStoreNames.contains("attachments")) next.createObjectStore("attachments", { keyPath: "id" });
      };
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
  }, document);
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function storedDocument(page: Page): Promise<{ revision: number; entities: Array<{ handle: string }>; layers: Array<{ id: string; name: string }>; units: { linear: string }; layouts: Array<{ id: string; entities?: Array<{ handle: string; layerId: string; blockId?: string }>; viewports: Array<{ layerOverrides?: Record<string, unknown> }> }>; blocks: Array<{ id: string; entities: Array<{ handle: string }> }> }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const result = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return result as { revision: number; entities: Array<{ handle: string }>; layers: Array<{ id: string; name: string }>; units: { linear: string }; layouts: Array<{ id: string; entities?: Array<{ handle: string; layerId: string; blockId?: string }>; viewports: Array<{ layerOverrides?: Record<string, unknown> }> }>; blocks: Array<{ id: string; entities: Array<{ handle: string }> }> };
  });
}

test("F-111 imports, edits, atomically undoes/redoes, persists and re-exports the exact production DXF", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-29T08:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page);
  const source = Buffer.from(exportDxf(createF109Document("F-111-source")).bytes);

  await page.getByLabel("DXF import").setInputFiles({ name: "F-111-source.dxf", mimeType: "application/dxf", buffer: source });
  await expect(page.getByText("DXF imporditud: 40 objekti · 5 kihti · mm")).toBeVisible();
  await expect(page.getByText(/40 objekti · 0 valitud · JOONED/u)).toBeVisible();
  expect(await storedDocument(page)).toMatchObject({ revision: 1, units: { linear: "mm" }, entities: { length: 40 }, layers: { length: 5 } });

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MOVE baaspunkt").fill("0,0");
  await page.getByLabel("MOVE sihtpunkt").fill("100,200");
  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("40 objekti nihutatud Δ100,200")).toBeVisible();
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 3")).toBeVisible();
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("0 objekti · 0 valitud · 0")).toBeVisible();
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(page.getByText("40 objekti · 0 valitud · JOONED")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();
  await expect(page.getByText("40 objekti · 0 valitud · JOONED")).toBeVisible();
  const persisted = await storedDocument(page);
  expect(persisted.revision).toBe(5);
  expect(persisted.entities).toHaveLength(40);
  expect(persisted.layers.map((layer) => layer.name)).toEqual(["0", "JOONED", "TELJED", "SEINAD", "VIIRUTUS"]);

  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const download = await pendingDownload;
  const path = await download.path();
  expect(path).not.toBeNull();
  const secondGeneration = await readFile(path!);
  expect(secondGeneration.equals(source)).toBe(true);
  expect(errors).toEqual([]);

  await page.getByLabel("DXF import").setInputFiles({ name: "F-111-source.dxf", mimeType: "application/dxf", buffer: source });
  await expect(page.getByText("DXF import muutusteta: sama joonis on juba avatud")).toBeVisible();
  expect((await storedDocument(page)).revision).toBe(5);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await writeFile(resolve(captureDir, "F-111-browser-roundtrip.dxf"), secondGeneration);
    await page.screenshot({ path: resolve(captureDir, "F-111-browser-roundtrip.png"), fullPage: true });
    await writeFile(resolve(captureDir, "F-111-browser-matrix.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-111",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      workflow: "Visible DXF import -> editable MOVE -> undo MOVE -> atomic undo import -> redo import -> reload -> visible second-generation DXF export",
      source: { bytes: source.byteLength, sha256: sha256(source) },
      roundtrip: { bytes: secondGeneration.byteLength, sha256: sha256(secondGeneration), exactProductionBytes: secondGeneration.equals(source) },
      revision: persisted.revision,
      entityCount: persisted.entities.length,
      layers: persisted.layers.map((layer) => layer.name),
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});

test("F-111 refuses an unsupported partial DXF without changing revision or model content", async ({ page }) => {
  const errors = collectErrors(page);
  await seedLocalDocument(page);
  const source = Buffer.from(exportDxf(createF109Document()).bytes);
  const unsupported = Buffer.from(source.toString("latin1").replace(
    "  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS",
    "  0\r\nSPLINE\r\n  5\r\nABC\r\n  8\r\nJOONED\r\n  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS",
  ), "latin1");
  await page.getByLabel("DXF import").setInputFiles({ name: "partial.dxf", mimeType: "application/dxf", buffer: unsupported });
  await expect(page.getByText(/DXF import peatatud: 1 toetamata objekti; esimene SPLINE ABC/u)).toBeVisible();
  expect(await storedDocument(page)).toMatchObject({ revision: 0, entities: [], layers: [{ name: "0" }] });
  expect(errors).toEqual([]);
});

test("F-111 preserves paper-space entities, blocks, layer overrides and colliding handles atomically", async ({ page }) => {
  const errors = collectErrors(page);
  await seedLocalDocument(page, paperAwareDocument());
  const source = Buffer.from(exportDxf(createF109Document()).bytes);
  await page.getByLabel("DXF import").setInputFiles({ name: "with-paper.dxf", mimeType: "application/dxf", buffer: source });
  await expect(page.getByText("DXF imporditud: 40 objekti · 5 kihti · mm")).toBeVisible();
  const imported = await storedDocument(page);
  const retainedPaper = imported.layouts.find((layout) => layout.id === "sheet")!;
  expect(imported.revision).toBe(1);
  expect(retainedPaper.entities).toHaveLength(1);
  expect(retainedPaper.entities![0]!.handle).not.toBe("1000");
  expect(imported.layers.find((layer) => layer.id === retainedPaper.entities![0]!.layerId)?.name).toBe("PAPER TITLE");
  expect(imported.blocks.find((block) => block.id === retainedPaper.entities![0]!.blockId)?.entities).toHaveLength(1);
  expect(Object.keys(retainedPaper.viewports[0]!.layerOverrides ?? {})).toEqual([retainedPaper.entities![0]!.layerId]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect(await storedDocument(page)).toMatchObject({ revision: 2, entities: [], layouts: { length: 2 } });
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await storedDocument(page)).layouts.find((layout) => layout.id === "sheet")).toEqual(retainedPaper);
  expect(errors).toEqual([]);
});

test("F-111 refuses a unit change that would invalidate retained paper-space view semantics", async ({ page }) => {
  const errors = collectErrors(page);
  await seedLocalDocument(page, paperAwareDocument());
  const source = Buffer.from(exportDxf(createF109Document()).bytes);
  const metres = Buffer.from(source.toString("latin1").replace("$INSUNITS\r\n 70\r\n4", "$INSUNITS\r\n 70\r\n6"), "latin1");
  await page.getByLabel("DXF import").setInputFiles({ name: "metres.dxf", mimeType: "application/dxf", buffer: metres });
  await expect(page.getByText(/DXF impordi viga: DXF units m cannot replace mm model units while unit-sensitive layout state exists/u)).toBeVisible();
  expect(await storedDocument(page)).toMatchObject({ revision: 0, entities: [], units: { linear: "mm" }, layouts: { length: 2 } });
  expect(errors).toEqual([]);
});

test("F-111 refuses a unit change that would invalidate an explicit Model Window page setup", async ({ page }) => {
  const errors = collectErrors(page);
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T08:00:00.000Z" });
  document.layouts[0]!.pageSetup = {
    mediaName: "ISO_A4",
    orientation: "portrait",
    plotArea: { kind: "window", window: { x: 10, y: 20, width: 100, height: 200 } },
    plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 50 },
    centerPlot: false,
    plotOriginMm: { x: 5, y: 6 },
  };
  await seedLocalDocument(page, document);
  const source = Buffer.from(exportDxf(createF109Document()).bytes);
  const metres = Buffer.from(source.toString("latin1").replace("$INSUNITS\r\n 70\r\n4", "$INSUNITS\r\n 70\r\n6"), "latin1");
  await page.getByLabel("DXF import").setInputFiles({ name: "model-metres.dxf", mimeType: "application/dxf", buffer: metres });
  await expect(page.getByText(/DXF impordi viga: DXF units m cannot replace mm model units while unit-sensitive layout state exists/u)).toBeVisible();
  expect(await storedDocument(page)).toMatchObject({ revision: 0, entities: [], units: { linear: "mm" }, layouts: { length: 1 } });
  expect(errors).toEqual([]);
});
