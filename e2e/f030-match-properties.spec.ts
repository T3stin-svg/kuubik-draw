import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { modelWorldToScreen } from "./helpers/model-space.js";
import { openLayoutTools } from "./helpers/layout-tools.js";
import { checkpointKDrawDocument, seedKDrawDocument } from "./helpers/indexed-db.js";

type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: Record<string, unknown> };

async function seedLocalDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
  await seedKDrawDocument(page, document, { clearLocalStorageKeys: ["kuubik-draw.match-properties-settings.v1"] });
}

async function readState(page: Page): Promise<{ document: KDrawDocumentV1; operations: RecordedOperation[] }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const transaction = database.transaction(["documents", "operations"], "readonly");
    const documentRequest = transaction.objectStore("documents").get("local");
    const operationsRequest = transaction.objectStore("operations").getAll();
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      documentRequest.onsuccess = () => resolveRead(documentRequest.result as KDrawDocumentV1);
      documentRequest.onerror = () => rejectRead(documentRequest.error);
    });
    const rows = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      operationsRequest.onsuccess = () => resolveRead(operationsRequest.result as Array<{ revision: number; operation: RecordedOperation }>);
      operationsRequest.onerror = () => rejectRead(operationsRequest.error);
    });
    database.close();
    return { document, operations: rows.sort((a, b) => a.revision - b.revision).map(({ operation }) => operation) };
  });
}

test("F-030 MATCHPROP candidate previews, persists settings, commits atomically and roundtrips outputs", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T14:40:00.000Z" });
  source.layers.push({ id: "source", name: "SOURCE", visible: true, frozen: false, locked: false, plottable: true });
  source.linetypes = [{ id: "hidden", name: "HIDDEN", description: "F-030", pattern: [5, -2] }];
  source.entities = [
    {
      kind: "line", handle: "10", layerId: "source", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 },
      appearance: { color: "#ff0000", colorMethod: "trueColor", linetypeId: "hidden", linetypeScale: 2.5, lineweightMm: 0.5, transparency: 40, thickness: -3.25 },
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 200 }, end: { x: 1000, y: 200 }, appearance: { color: "#00ff00", linetypeScale: 0.5 } },
    { kind: "circle", handle: "30", layerId: "0", center: { x: 500, y: 500 }, radius: 100, appearance: { color: "#0000ff" } },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("MATCHPROP lähteobjekt").fill("10");
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByTestId("match-properties-preview")).toHaveText("MATCHPROP eelvaade: 2 tulemust · 1 muutmata");
  await expect(page.getByTestId("match-properties-preview")).toHaveAttribute("data-hidden-source-count", "2");

  await page.getByText("MATCHPROP seaded").click();
  await expect(page.getByLabel("MATCHPROP Kiht")).toBeChecked();
  await page.getByLabel("MATCHPROP Kiht").uncheck();
  await page.reload();
  await expect(page.getByLabel("MATCHPROP Kiht")).not.toBeChecked();
  await page.getByLabel("MATCHPROP lähteobjekt").fill("10");
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByRole("button", { name: "MATCHPROP", exact: true }).click();
  await expect(page.getByText(/2 objekti omadused sobitatud ühe Undo-operatsioonina/u)).toBeVisible();

  const committed = await readState(page);
  expect(committed.document.revision).toBe(1);
  expect(committed.document.entities.find(({ handle }) => handle === "20")).toMatchObject({
    layerId: "0", start: { x: 0, y: 200 }, end: { x: 1000, y: 200 }, appearance: source.entities[0]!.appearance,
  });
  expect(committed.document.entities.find(({ handle }) => handle === "30")).toMatchObject({
    layerId: "0", center: { x: 500, y: 500 }, radius: 100,
    appearance: { color: "#ff0000", colorMethod: "trueColor", linetypeId: "hidden", linetypeScale: 2.5, lineweightMm: 0.5, transparency: 40 },
  });
  expect(committed.operations.map((operation) => operation.commandId)).toEqual(["MATCHPROP"]);
  expect(committed.operations[0]).toMatchObject({
    commandId: "MATCHPROP", targetHandles: ["20", "30"], resultHandles: ["20", "30"],
    args: { sourceHandle: "10", targetHandles: ["10", "20", "30"], settings: { layer: false } },
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const dxfText = dxfBytes.toString("utf8");
  const parsed = new DxfParser().parseSync(dxfText);
  expect(parsed?.entities.find(({ handle }) => handle === "20")).toMatchObject({ layer: "0", lineType: "HIDDEN", lineTypeScale: 2.5 });
  expect(dxfText).toMatch(/\r?\n 39\r?\n-3\.25\r?\n/u);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restored = await deserializeKDraw(kdrawBytes);
  expect(restored.document.entities).toEqual(committed.document.entities);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const undoRestored = await readState(page);
  expect(undoRestored.document.entities).toEqual(source.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readState(page);
  expect(redone.document.entities).toEqual(committed.document.entities);
  expect(consoleErrors).toEqual([]);
  if (process.env.PARITY_CAPTURE_DIR) {
    await writeFile(`${process.env.PARITY_CAPTURE_DIR}/F-030-browser-matrix.json`, `${JSON.stringify({ schemaVersion: 1, rowId: "F-030", status: "PASS", source, committed: committed.document, operation: committed.operations[0], undoRestored: undoRestored.document, redone: redone.document, consoleErrors }, null, 2)}\n`);
    await writeFile(`${process.env.PARITY_CAPTURE_DIR}/F-030-browser.dxf`, dxfBytes);
    await writeFile(`${process.env.PARITY_CAPTURE_DIR}/F-030-browser.kdraw`, kdrawBytes);
  }
});

test("F-030 MATCHPROP physically picks source and multiple destinations on the canvas", async ({ page }) => {
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T14:50:00.000Z" });
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, appearance: { color: "#ff0000" } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 200 }, end: { x: 1000, y: 200 }, appearance: { color: "#00ff00" } },
    { kind: "circle", handle: "30", layerId: "0", center: { x: 500, y: 500 }, radius: 100, appearance: { color: "#0000ff" } },
  ];
  await seedLocalDocument(page, source);
  await page.getByRole("button", { name: "MATCHPROP vali lähteobjekt" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  for (const point of [[500, 0], [500, 200], [600, 500]] as const) {
    const pixel = await modelWorldToScreen(canvas, { x: point[0], y: point[1] });
    await page.mouse.click(pixel.x, pixel.y);
  }
  await expect(page.getByLabel("MATCHPROP lähteobjekt")).toHaveValue("10");
  await expect(page.getByTestId("match-properties-preview")).toHaveText("MATCHPROP eelvaade: 2 tulemust · 0 muutmata");
  await expect(page.getByText("3 objekti · 2 valitud · 0")).toBeVisible();
  if (process.env.PARITY_CAPTURE_DIR) {
    await writeFile(`${process.env.PARITY_CAPTURE_DIR}/F-030-browser-physical.json`, `${JSON.stringify({ schemaVersion: 1, rowId: "F-030", status: "PASS", sourceHandle: await page.getByLabel("MATCHPROP lähteobjekt").inputValue(), preview: await page.getByTestId("match-properties-preview").textContent(), selectionSummary: await page.getByText("3 objekti · 2 valitud · 0").textContent() }, null, 2)}\n`);
  }
});

test("F-030 MATCHPROP copies viewport special properties while preserving target paper ownership", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-30T15:55:00.000Z" });
  source.entities = [
    { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 100, appearance: {} },
  ];
  const sourceViewport = {
    id: "match-source",
    center: { x: 80, y: 90 }, width: 100, height: 60,
    viewCenter: { x: 0, y: 0 }, viewHeight: 1200, twistAngleRad: 0.1,
    locked: true, on: false, shadePlot: "wireframe" as const, snapEnabled: true, gridEnabled: true,
    ucsIconVisible: false, ucsIconAtOrigin: false,
    clipBoundary: [{ x: 30, y: 60 }, { x: 130, y: 60 }, { x: 80, y: 120 }],
    layerOverrides: { "0": { frozen: true, color: "#ff0000" } },
  };
  const targetViewport = {
    id: "match-target",
    center: { x: 280, y: 120 }, width: 120, height: 80,
    viewCenter: { x: 2000, y: -500 }, viewHeight: 800, twistAngleRad: 0.5,
    locked: false, on: true, shadePlot: "hidden" as const, snapEnabled: false, gridEnabled: false,
    ucsIconVisible: true, ucsIconAtOrigin: true,
    clipBoundary: [{ x: 220, y: 80 }, { x: 340, y: 80 }, { x: 340, y: 160 }, { x: 220, y: 160 }],
    layerOverrides: { "0": { frozen: false, color: "#00ff00" } },
  };
  source.layouts.push({
    id: "layout-f030-viewports",
    name: "F030 VIEWPORTS",
    kind: "paper",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [sourceViewport, targetViewport],
    entities: [],
  });
  await seedLocalDocument(page, source);
  await page.getByRole("tab", { name: "F030 VIEWPORTS", exact: true }).click();
  await openLayoutTools(page);

  await page.getByRole("button", { name: "MATCHPROP viewport alusta" }).click();
  await page.getByLabel("Layout tools").click();
  await page.locator('[data-viewport-id="match-source"]').click();
  await page.locator('[data-viewport-id="match-target"]').click();
  await expect(page.locator('[data-viewport-id="match-source"]')).toHaveAttribute("data-match-role", "source");
  await expect(page.locator('[data-viewport-id="match-target"]')).toHaveAttribute("data-match-role", "target");
  await openLayoutTools(page);
  await expect(page.getByTestId("match-viewport-source")).toHaveText("Allikas: layout-f030-viewports/match-source");
  await expect(page.getByTestId("match-viewport-targets")).toHaveText("Siht: 1");
  await page.getByRole("button", { name: "Rakenda MATCHPROP viewportidele" }).click();
  await expect(page.getByText("1 viewporti omadused sobitatud ühe Undo-operatsioonina")).toBeVisible();

  const committed = await readState(page);
  const committedLayout = committed.document.layouts.find(({ id }) => id === "layout-f030-viewports")!;
  expect(committedLayout.viewports.find(({ id }) => id === "match-source")).toEqual(sourceViewport);
  expect(committedLayout.viewports.find(({ id }) => id === "match-target")).toEqual({
    ...targetViewport,
    viewHeight: 1600,
    locked: true,
    on: false,
    shadePlot: "wireframe",
    snapEnabled: true,
    gridEnabled: true,
    ucsIconVisible: false,
    ucsIconAtOrigin: false,
  });
  expect(committed.operations.map((operation) => operation.commandId)).toEqual(["LAYOUT_ACTIVATE", "MATCHPROP"]);
  expect(committed.operations[1]).toMatchObject({
    commandId: "MATCHPROP",
    targetHandles: [],
    resultHandles: [],
    args: {
      kind: "viewport",
      source: { layoutId: "layout-f030-viewports", viewportId: "match-source" },
      targets: [{ layoutId: "layout-f030-viewports", viewportId: "match-target" }],
      settings: { viewport: true },
    },
  });
  await expect(page.locator('[data-viewport-id="match-target"]')).toHaveAttribute("data-viewport-on", "false");
  await expect(page.locator('[data-viewport-id="match-target"]')).toHaveAttribute("data-scale-denominator", "20");

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const viewportUndone = await readState(page);
  expect(viewportUndone.document.layouts.find(({ id }) => id === "layout-f030-viewports")!.viewports[1]).toEqual(targetViewport);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const viewportRedone = await readState(page);
  expect(viewportRedone.document.layouts.find(({ id }) => id === "layout-f030-viewports")!.viewports[1]).toEqual(committedLayout.viewports[1]);

  expect(await checkpointKDrawDocument(page, { suspendApp: true })).toEqual({ revision: 4, layoutRepairs: [] });
  await page.goto("/d/local");
  await expect(page.getByTestId("recovery-panel").getByText("Pärast katkestust taastati revisjon 4.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "F030 VIEWPORTS", exact: true }).click();
  await expect(page.locator('[data-viewport-id="match-target"]')).toHaveAttribute("data-viewport-on", "false");
  await expect(page.locator('[data-viewport-id="match-target"]')).toHaveAttribute("data-scale-denominator", "20");
  expect(consoleErrors).toEqual([]);
  if (process.env.PARITY_CAPTURE_DIR) {
    await writeFile(`${process.env.PARITY_CAPTURE_DIR}/F-030-browser-viewport.json`, `${JSON.stringify({ schemaVersion: 1, rowId: "F-030", status: "PASS", source: { sourceViewport, targetViewport }, committed: committedLayout.viewports[1], operation: committed.operations[0], undoRestored: viewportUndone.document.layouts.find(({ id }) => id === "layout-f030-viewports")!.viewports[1], redone: viewportRedone.document.layouts.find(({ id }) => id === "layout-f030-viewports")!.viewports[1], consoleErrors }, null, 2)}\n`);
  }
});
