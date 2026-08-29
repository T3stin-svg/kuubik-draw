import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument } from "@kuubik/cad-core";
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

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function trimDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T09:00:00.000Z" });
  document.entities = [
    {
      kind: "line", handle: "10", layerId: "0",
      appearance: { color: "#ff4040", lineweightMm: 0.5 }, extensionData: { rowId: "F-022" },
      start: { x: 0, y: 0 }, end: { x: 1000, y: 0 },
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: 250, y: -100 }, end: { x: 250, y: 100 } },
    { kind: "line", handle: "21", layerId: "0", start: { x: 750, y: -100 }, end: { x: 750, y: 100 } },
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
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result as KDrawDocumentV1);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document;
  });
}

async function readOperation(page: Page): Promise<RecordedOperation> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
    const records = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result as Array<{ revision: number; operation: RecordedOperation }>);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return records.sort((first, second) => first.revision - second.revision)[0]!.operation;
  });
}

test("F-022 TRIM Standard previews, command-undoes, commits, reads DXF back and globally undoes", async ({ page }) => {
  const errors = collectErrors(page);
  const seeded = trimDocument();
  await seedLocalDocument(page, seeded);
  await page.getByLabel("TRIM režiim").selectOption("standard");
  await page.getByLabel("TRIM cutting edges").fill("20,21");
  await page.getByLabel("TRIM valik", { exact: true }).selectOption("fence");
  await page.getByLabel("TRIM valikutee").fill("500,-50; 500,50");
  await page.getByRole("button", { name: "TRIM Fence/Crossing vali" }).click();
  await expect(page.getByText("TRIM Fence: 1 sihtmärki valitud")).toBeVisible();
  await expect(page.getByLabel("TRIM sihid")).toHaveValue("10@500,0");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 2 tulemust · 1 sammu");
  await expect(page.getByTestId("trim-preview")).toHaveAttribute("data-hidden-source-count", "1");

  await page.getByRole("button", { name: "TRIM Undo" }).click();
  await expect(page.getByText("TRIM Undo: kõik sihid eemaldatud; globaalset UNDO sammu ei loodud")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("TRIM valik", { exact: true }).selectOption("crossing");
  await page.getByLabel("TRIM valikutee").fill("400,-50; 600,50");
  await page.getByRole("button", { name: "TRIM Fence/Crossing vali" }).click();
  await expect(page.getByText("TRIM Crossing: 1 sihtmärki valitud")).toBeVisible();
  await expect(page.getByLabel("TRIM sihid")).toHaveValue("10@600,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  await expect(page.getByText("1 TRIM sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 250, y: 0 }, appearance: seeded.entities[0]!.appearance, extensionData: seeded.entities[0]!.extensionData },
    { kind: "line", handle: "20" },
    { kind: "line", handle: "21" },
    { kind: "line", handle: "22", start: { x: 750, y: 0 }, end: { x: 1000, y: 0 }, appearance: seeded.entities[0]!.appearance, extensionData: seeded.entities[0]!.extensionData },
  ]);
  const operation = await readOperation(page);
  expect(operation).toMatchObject({
    commandId: "TRIM",
    targetHandles: ["10"],
    resultHandles: ["10", "22"],
    args: { mode: "standard", cuttingEdgeHandles: ["20", "21"], edgeMode: "no-extend", projectMode: "none" },
  });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfBytes = await readFile(dxfPath!);
  const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(dxf?.entities.filter((entity) => entity.type === "LINE").map((entity) => entity.handle)).toEqual(["10", "20", "21", "22"]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(seeded.entities);
  expect(errors).toEqual([]);
  await capture("F-022-browser-standard.dxf", dxfBytes);
  await capture("F-022-browser-standard.json", { rowId: "F-022", workflow: "Standard + Fence + command Undo + Crossing + global Undo", committed, operation, restored, consoleErrors: errors, status: "PASS" });
});

test("F-022 TRIM Quick uses all objects as boundaries and erases a no-intersection target", async ({ page }) => {
  const errors = collectErrors(page);
  const trimSeed = trimDocument();
  await seedLocalDocument(page, trimSeed);
  await page.getByLabel("TRIM cutting edges").fill("");
  await page.getByLabel("TRIM režiim").selectOption("quick");
  await page.getByLabel("TRIM sihid").fill("10@500,0");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 2 tulemust · 1 sammu");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const trimmed = await readDocument(page);
  const trimOperation = await readOperation(page);
  expect(trimmed.entities).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 250, y: 0 } },
    { kind: "line", handle: "20" },
    { kind: "line", handle: "21" },
    { kind: "line", handle: "22", start: { x: 750, y: 0 }, end: { x: 1000, y: 0 } },
  ]);
  expect(trimOperation).toMatchObject({ commandId: "TRIM", args: { mode: "quick", cuttingEdgeHandles: [] }, resultHandles: ["10", "22"] });

  const eraseSeed = trimDocument();
  eraseSeed.entities = eraseSeed.entities.slice(0, 2);
  eraseSeed.entities[1] = { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 100 }, end: { x: 1000, y: 100 } };
  await seedLocalDocument(page, eraseSeed);
  await page.getByLabel("TRIM režiim").selectOption("quick");
  await page.getByLabel("TRIM sihid").fill("10@500,0");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 0 tulemust · 1 sammu");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  await expect(page.getByText("1 TRIM sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const erased = await readDocument(page);
  expect(erased.entities.map((entity) => entity.handle)).toEqual(["20"]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(eraseSeed.entities);
  expect(errors).toEqual([]);
  await capture("F-022-browser-quick.json", {
    rowId: "F-022",
    workflow: "Quick all-object boundary trim plus no-intersection erase",
    trimmed,
    trimOperation,
    committed: erased,
    restored,
    status: "PASS",
    consoleErrors: errors,
  });
});

test("F-022 TRIM physical Shift-click uses the same preview and atomic commit predicate", async ({ page }) => {
  const errors = collectErrors(page);
  const seeded = trimDocument();
  seeded.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: -20 }, end: { x: 100, y: 20 } },
  ];
  await seedLocalDocument(page, seeded);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").focus();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const screen = {
    x: box!.x + box!.width / 2 + (80 - 1000) * pixelsPerWorldUnit,
    y: box!.y + box!.height / 2 - (0 - 1000) * pixelsPerWorldUnit,
  };
  await page.keyboard.down("Shift");
  await page.mouse.click(screen.x, screen.y);
  await page.keyboard.up("Shift");
  await expect(page.getByText("TRIM Shift-valik: 10 pikendatakse")).toBeVisible();
  await expect(page.getByLabel("TRIM sihid")).toHaveValue("10@80,0");
  await expect(page.getByLabel("TRIM tegevus")).toHaveValue("extend");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const committed = await readDocument(page);
  const operation = await readOperation(page);
  expect(committed.entities[0]).toMatchObject({ kind: "line", handle: "10", start: { x: 20, y: 0 }, end: { x: 100, y: 0 } });
  expect(operation).toMatchObject({ commandId: "TRIM", args: { targets: [{ handle: "10", pickPoint: { x: 80, y: 0 }, action: "extend" }] } });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(seeded.entities);
  expect(errors).toEqual([]);
  await capture("F-022-browser-shift-extend.json", { rowId: "F-022", workflow: "Physical Shift-click Extend shared preview and atomic commit", physicalInput: { modifier: "Shift", pointer: screen }, committed, operation, restored, status: "PASS", consoleErrors: errors });
});

test("F-022 TRIM Edge, Project, Erase and layer-refusal options complete visible workflows", async ({ page }) => {
  const errors = collectErrors(page);
  const optionDocument = trimDocument();
  optionDocument.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 50, y: 10 }, end: { x: 50, y: 20 } },
  ];
  await seedLocalDocument(page, optionDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@10,0");
  await page.getByLabel("TRIM Edge").selectOption("no-extend");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  await expect(page.getByText("TRIM ei muutnud geomeetriat; 1 lukus, peidetud, puudu või sobimatu")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);

  const projects: Record<string, KDrawDocumentV1> = {};
  for (const projectMode of ["none", "ucs", "view"] as const) {
    await seedLocalDocument(page, optionDocument);
    await page.getByLabel("TRIM cutting edges").fill("20");
    await page.getByLabel("TRIM sihid").fill("10@10,0");
    await page.getByLabel("TRIM Edge").selectOption("extend");
    await page.getByLabel("TRIM Project").selectOption(projectMode);
    await page.getByRole("button", { name: "TRIM", exact: true }).click();
    const committed = await readDocument(page);
    expect(committed.entities[0]).toMatchObject({ kind: "line", start: { x: 50, y: 0 }, end: { x: 100, y: 0 } });
    projects[projectMode] = committed;
  }

  const eraseDocument = trimDocument();
  eraseDocument.entities = eraseDocument.entities.slice(0, 2);
  await seedLocalDocument(page, eraseDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@50,0");
  await page.getByLabel("TRIM tegevus").selectOption("erase");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const erased = await readDocument(page);
  expect(erased.entities.map((entity) => entity.handle)).toEqual(["20"]);

  const refusedDocument = trimDocument();
  refusedDocument.layers.push(
    { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
  );
  refusedDocument.entities = [
    { kind: "line", handle: "10", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "11", layerId: "hidden", start: { x: 0, y: 20 }, end: { x: 100, y: 20 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 50, y: -20 }, end: { x: 50, y: 40 } },
  ];
  await seedLocalDocument(page, refusedDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@10,0;11@10,20");
  await page.getByLabel("TRIM tegevus").selectOption("trim");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  await expect(page.getByTestId("trim-rejected")).toHaveAttribute("data-rejected", JSON.stringify([
    { handle: "10", targetIndex: 0, reason: "locked-layer" },
    { handle: "11", targetIndex: 1, reason: "hidden-layer" },
  ]));
  const refused = await readDocument(page);
  expect(refused.revision).toBe(0);
  expect(refused.entities).toEqual(refusedDocument.entities);
  expect(errors).toEqual([]);
  await capture("F-022-browser-options.json", {
    rowId: "F-022",
    workflow: "Edge No extend refusal; Edge Extend with Project None/UCS/View; explicit Erase; locked and hidden target refusal",
    noExtendRevision: 0,
    projects,
    erased,
    refused,
    rejected: [
      { handle: "10", targetIndex: 0, reason: "locked-layer" },
      { handle: "11", targetIndex: 1, reason: "hidden-layer" },
    ],
    status: "PASS",
    consoleErrors: errors,
  });
});

test("F-022 TRIM preserves closed bulged widths, ignores HATCH loops and expands nested transformed blocks", async ({ page }) => {
  const errors = collectErrors(page);

  const polylineDocument = trimDocument();
  polylineDocument.entities = [
    {
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 6 },
        { x: 100, y: 0, bulge: 1, startWidth: 3, endWidth: 5 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: 25, y: -20 }, end: { x: 25, y: 120 } },
    { kind: "line", handle: "21", layerId: "0", start: { x: 75, y: -20 }, end: { x: 75, y: 120 } },
  ];
  await seedLocalDocument(page, polylineDocument);
  await page.getByLabel("TRIM cutting edges").fill("20,21");
  await page.getByLabel("TRIM sihid").fill("10@50,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const polyline = await readDocument(page);
  const polylineResult = polyline.entities.find((entity) => entity.handle === "10");
  expect(polylineResult).toEqual({
    kind: "polyline",
    handle: "10",
    layerId: "0",
    closed: false,
    vertices: [
      { x: 75, y: 0, startWidth: 5, endWidth: 6 },
      { x: 100, y: 0, bulge: 1, startWidth: 3, endWidth: 5 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0, startWidth: 2, endWidth: 3 },
      { x: 25, y: 0, startWidth: 2, endWidth: 3 },
    ],
  });

  const hatchDocument = trimDocument();
  hatchDocument.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
    {
      kind: "hatch", handle: "20", layerId: "0", pattern: "SOLID", associative: false,
      loops: [{ isHole: false, vertices: [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }] }],
    },
  ];
  await seedLocalDocument(page, hatchDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@50,50");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const hatch = await readDocument(page);
  expect(hatch.revision).toBe(0);
  expect(hatch.entities.filter((entity) => entity.kind === "line")).toMatchObject([
    { handle: "10", start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
  ]);
  await expect(page.getByTestId("trim-rejected")).toHaveAttribute("data-rejected", JSON.stringify([{ handle: "10", targetIndex: 0, reason: "no-intersection" }]));

  const blockDocument = trimDocument();
  blockDocument.blocks = [
    { id: "inner", name: "INNER", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "inner-line", layerId: "0", start: { x: 0, y: -10 }, end: { x: 0, y: 10 } }] },
    { id: "outer", name: "OUTER", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "nested", layerId: "0", blockId: "inner", insertion: { x: 5, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
    { id: "cycle", name: "CYCLE", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "cycle-child", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
  ];
  blockDocument.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "blockRef", handle: "20", layerId: "0", blockId: "outer", insertion: { x: 50, y: 0 }, scale: { x: 2, y: 3 }, rotationRad: 0 },
    { kind: "blockRef", handle: "21", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 },
  ];
  await seedLocalDocument(page, blockDocument);
  await page.getByLabel("TRIM cutting edges").fill("20,21");
  await page.getByLabel("TRIM sihid").fill("10@10,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const block = await readDocument(page);
  expect(block.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 60, y: 0 }, end: { x: 100, y: 0 } });
  expect(block.entities.find((entity) => entity.handle === "21")).toEqual(blockDocument.entities[2]);

  const cycleOnly = structuredClone(blockDocument);
  cycleOnly.documentId = "local";
  cycleOnly.revision = 0;
  cycleOnly.entities = [structuredClone(blockDocument.entities[0]!), structuredClone(blockDocument.entities[2]!)];
  await seedLocalDocument(page, cycleOnly);
  await page.getByLabel("TRIM cutting edges").fill("21");
  await page.getByLabel("TRIM sihid").fill("10@10,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const cycle = await readDocument(page);
  expect(cycle.revision).toBe(0);
  expect(cycle.entities).toEqual(cycleOnly.entities);
  await expect(page.getByTestId("trim-rejected")).toHaveAttribute("data-rejected", JSON.stringify([{ handle: "10", targetIndex: 0, reason: "no-intersection" }]));

  const layeredBlockDocument = trimDocument();
  layeredBlockDocument.layers.push(
    { id: "insert", name: "INSERT", visible: true, frozen: false, locked: false, plottable: true },
    { id: "hidden-child", name: "HIDDEN_CHILD", visible: false, frozen: false, locked: false, plottable: true },
    { id: "frozen-child", name: "FROZEN_CHILD", visible: true, frozen: true, locked: false, plottable: true },
  );
  layeredBlockDocument.blocks = [{
    id: "layered-cut",
    name: "LAYERED_CUT",
    basePoint: { x: 0, y: 0 },
    entities: [
      { kind: "line", handle: "inherited", layerId: "0", start: { x: 25, y: -10 }, end: { x: 25, y: 10 } },
      { kind: "line", handle: "hidden", layerId: "hidden-child", start: { x: 50, y: 10 }, end: { x: 50, y: 30 } },
      { kind: "line", handle: "frozen", layerId: "frozen-child", start: { x: 75, y: 30 }, end: { x: 75, y: 50 } },
    ],
  }];
  layeredBlockDocument.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 20 }, end: { x: 100, y: 20 } },
    { kind: "line", handle: "12", layerId: "0", start: { x: 0, y: 40 }, end: { x: 100, y: 40 } },
    { kind: "blockRef", handle: "20", layerId: "insert", blockId: "layered-cut", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 },
  ];
  await seedLocalDocument(page, layeredBlockDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@10,0;11@10,20;12@10,40");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const layeredBlock = await readDocument(page);
  expect(layeredBlock.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 25, y: 0 }, end: { x: 100, y: 0 } });
  expect(layeredBlock.entities.find((entity) => entity.handle === "11")).toEqual(layeredBlockDocument.entities[1]);
  expect(layeredBlock.entities.find((entity) => entity.handle === "12")).toEqual(layeredBlockDocument.entities[2]);
  await expect(page.getByTestId("trim-rejected")).toHaveAttribute("data-rejected", JSON.stringify([
    { handle: "11", targetIndex: 1, reason: "no-intersection" },
    { handle: "12", targetIndex: 2, reason: "no-intersection" },
  ]));

  expect(errors).toEqual([]);
  await capture("F-022-browser-composite.json", {
    rowId: "F-022",
    workflow: "Closed bulged width polyline + HATCH boundary ignored + nested transformed block + cycle fail-closed + effective hidden/frozen child-layer filtering",
    polyline,
    hatch,
    block,
    cycle,
    layeredBlock,
    status: "PASS",
    consoleErrors: errors,
  });
});

test("F-022 TRIM closed CIRCLE and ELLIPSE outputs survive visible DXF download", async ({ page }) => {
  const errors = collectErrors(page);
  const circleDocument = trimDocument();
  circleDocument.entities = [
    { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
    { kind: "line", handle: "20", layerId: "0", start: { x: 5, y: -20 }, end: { x: 5, y: 20 } },
  ];
  await seedLocalDocument(page, circleDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@10,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  expect((await readDocument(page)).entities[0]).toMatchObject({ kind: "arc", handle: "10", radius: 10 });
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const circleDxfBytes = await readFile(path!);
  let parsed = new DxfParser().parseSync(circleDxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => entity.type)).toEqual(["ARC", "LINE"]);
  const circleCommitted = await readDocument(page);

  const ellipseDocument = trimDocument();
  ellipseDocument.entities = [
    { kind: "ellipse", handle: "10", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: -20 }, end: { x: 0, y: 20 } },
  ];
  await seedLocalDocument(page, ellipseDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@10,0");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  expect((await readDocument(page)).entities[0]).toMatchObject({ kind: "ellipse", handle: "10", ratio: 0.5 });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  path = await (await download).path();
  const ellipseDxfBytes = await readFile(path!);
  parsed = new DxfParser().parseSync(ellipseDxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => entity.type)).toEqual(["ELLIPSE", "LINE"]);
  expect(errors).toEqual([]);
  await capture("F-022-browser-circle.dxf", circleDxfBytes);
  await capture("F-022-browser-ellipse.dxf", ellipseDxfBytes);
  await capture("F-022-browser-closed-curves.json", { rowId: "F-022", circle: circleCommitted.entities, ellipse: (await readDocument(page)).entities, consoleErrors: errors, status: "PASS" });
});

test("F-022 TRIM rational SPLINE preserves exact split knots and survives visible DXF download", async ({ page }) => {
  const errors = collectErrors(page);
  const document = trimDocument();
  document.entities = [
    {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 100 }, { x: 200 / 3, y: -100 }, { x: 100, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: 25, y: -100 }, end: { x: 25, y: 100 } },
    { kind: "line", handle: "21", layerId: "0", start: { x: 75, y: -100 }, end: { x: 75, y: 100 } },
  ];
  await seedLocalDocument(page, document);
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const splineSourceDxfBytes = await readFile(path!);
  const sourceParsed = new DxfParser().parseSync(splineSourceDxfBytes.toString("utf8"));
  expect(sourceParsed?.entities.map((entity) => entity.type)).toEqual(["SPLINE", "LINE", "LINE"]);
  await page.getByLabel("TRIM cutting edges").fill("20,21");
  await page.getByLabel("TRIM sihid").fill("10@50,0");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 2 tulemust · 1 sammu");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const committed = await readDocument(page);
  const pieces = committed.entities.filter((entity) => entity.kind === "spline");
  expect(pieces).toMatchObject([
    { kind: "spline", handle: "10", knots: [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25], weights: [2, 2, 2, 2] },
    { kind: "spline", handle: "22", knots: [0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1], weights: [2, 2, 2, 2] },
  ]);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  path = await (await download).path();
  const splineDxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(splineDxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => entity.type)).toEqual(["SPLINE", "LINE", "LINE", "SPLINE"]);
  expect(parsed?.entities.filter((entity) => entity.type === "SPLINE").map((entity) => ({
    handle: entity.handle, degree: entity.degreeOfSplineCurve, controls: entity.controlPoints?.length, knots: entity.knotValues?.length,
  }))).toEqual([
    { handle: "10", degree: 3, controls: 4, knots: 8 },
    { handle: "22", degree: 3, controls: 4, knots: 8 },
  ]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);

  const tangentParameter = 0.37;
  const tangentDocument = trimDocument();
  tangentDocument.entities = [
    {
      kind: "spline", handle: "10", layerId: "0", degree: 2,
      controlPoints: [
        { x: 0, y: tangentParameter ** 2 },
        { x: 0.5, y: tangentParameter ** 2 - tangentParameter },
        { x: 1, y: (1 - tangentParameter) ** 2 },
      ],
      knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false,
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: -1, y: 0 }, end: { x: 2, y: 0 } },
  ];
  await seedLocalDocument(page, tangentDocument);
  await page.getByLabel("TRIM cutting edges").fill("20");
  await page.getByLabel("TRIM sihid").fill("10@0.1,0.08");
  await expect(page.getByTestId("trim-preview")).toHaveText("TRIM eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "TRIM", exact: true }).click();
  const tangentCommitted = await readDocument(page);
  const tangentPiece = tangentCommitted.entities.find((entity) => entity.kind === "spline");
  expect(tangentPiece?.kind).toBe("spline");
  if (tangentPiece?.kind === "spline") {
    expect(tangentPiece.controlPoints[0]?.x).toBeCloseTo(tangentParameter, 7);
    expect(tangentPiece.controlPoints[0]?.y).toBeCloseTo(0, 8);
  }
  expect(errors).toEqual([]);
  await capture("F-022-browser-spline-source.dxf", splineSourceDxfBytes);
  await capture("F-022-browser-spline.dxf", splineDxfBytes);
  await capture("F-022-browser-spline.json", { rowId: "F-022", committed, tangentCommitted, consoleErrors: errors, status: "PASS" });
});
