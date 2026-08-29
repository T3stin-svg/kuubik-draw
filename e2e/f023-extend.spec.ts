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

function extendDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T12:00:00.000Z" });
  document.entities = [
    {
      kind: "line", handle: "10", layerId: "0",
      appearance: { color: "#40a0ff", lineweightMm: 0.5 }, extensionData: { rowId: "F-023" },
      start: { x: 200, y: 0 }, end: { x: 800, y: 0 },
    },
    { kind: "line", handle: "11", layerId: "0", start: { x: 200, y: 200 }, end: { x: 800, y: 200 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: -100 }, end: { x: 1000, y: 300 } },
  ];
  return document;
}

function shiftTrimDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T12:10:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 250, y: -100 }, end: { x: 250, y: 100 } },
    { kind: "line", handle: "21", layerId: "0", start: { x: 750, y: -100 }, end: { x: 750, y: 100 } },
  ];
  return document;
}

function edgeModeDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T12:20:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: 50 }, end: { x: 100, y: 100 } },
  ];
  return document;
}

function refusalDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T12:25:00.000Z" });
  document.layers.push(
    { id: "locked", name: "F023 LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "hidden", name: "F023 HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
  );
  document.entities = [
    { kind: "line", handle: "10", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
    { kind: "line", handle: "11", layerId: "hidden", start: { x: 0, y: 20 }, end: { x: 80, y: 20 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: -20 }, end: { x: 100, y: 40 } },
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

async function readOperation(page: Page): Promise<RecordedOperation> {
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
    return rows.sort((first, second) => first.revision - second.revision)[0]!.operation;
  });
}

async function readOperationCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const request = database.transaction("operations", "readonly").objectStore("operations").count();
    const count = await new Promise<number>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return count;
  });
}

test("F-023 EXTEND Standard Fence, command Undo, atomic commit and global Undo", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const seeded = extendDocument();
  await seedLocalDocument(page, seeded);

  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20");
  await page.getByLabel("EXTEND valik", { exact: true }).selectOption("fence");
  await page.getByLabel("EXTEND valikutee").fill("800,-50; 800,50");
  await page.getByRole("button", { name: "EXTEND Fence/Crossing vali" }).click();
  await expect(page.getByText("EXTEND Fence: 1 sihtmärki valitud")).toBeVisible();
  await expect(page.getByLabel("EXTEND sihid")).toHaveValue("10@800,0");
  await expect(page.getByTestId("extend-preview")).toHaveText("EXTEND eelvaade: 1 tulemust · 1 sammu");

  await page.getByRole("button", { name: "EXTEND Undo" }).click();
  await expect(page.getByText("EXTEND Undo: kõik sihid eemaldatud; globaalset UNDO sammu ei loodud")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("EXTEND sihid").fill("10@800,0; 11@800,200");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  await expect(page.getByText("2 EXTEND sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities).toMatchObject([
    { handle: "10", end: { x: 1000, y: 0 }, appearance: seeded.entities[0]!.appearance, extensionData: seeded.entities[0]!.extensionData },
    { handle: "11", end: { x: 1000, y: 200 } },
    { handle: "20" },
  ]);
  const operation = await readOperation(page);
  expect(operation).toMatchObject({
    commandId: "EXTEND", targetHandles: ["10", "11"], resultHandles: ["10", "11"],
    args: { mode: "standard", boundaryEdgeHandles: ["20"], edgeMode: "no-extend", projectMode: "none" },
  });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.revision).toBe(2);
  expect(restored.entities).toEqual(seeded.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readDocument(page);
  expect(redone.revision).toBe(3);
  expect(redone.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);
  await capture("F-023-browser-standard.json", {
    rowId: "F-023", workflow: "Standard + Fence + command Undo + atomic commit + one-step global Undo/Redo",
    committed, operation, restored, redone, consoleErrors, status: "PASS",
  });
});

test("F-023 EXTEND Quick uses all objects and Shift-Trim uses the same preview/commit path", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const seeded = extendDocument();
  await seedLocalDocument(page, seeded);
  await page.getByLabel("EXTEND režiim").selectOption("quick");
  await page.getByLabel("EXTEND sihid").fill("10@800,0");
  await expect(page.getByTestId("extend-preview")).toHaveText("EXTEND eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const quickCommitted = await readDocument(page);
  const quickOperation = await readOperation(page);
  expect(quickCommitted.entities[0]).toMatchObject({ end: { x: 1000, y: 0 } });
  expect(quickOperation).toMatchObject({ commandId: "EXTEND", args: { mode: "quick", boundaryEdgeHandles: [] } });

  const shiftSeeded = shiftTrimDocument();
  await seedLocalDocument(page, shiftSeeded);
  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20,21");
  await page.getByLabel("EXTEND sihid").focus();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const pointer = {
    x: box!.x + box!.width / 2 + (500 - 1000) * pixelsPerWorldUnit,
    y: box!.y + box!.height / 2 - (0 - 1000) * pixelsPerWorldUnit,
  };
  await page.keyboard.down("Shift");
  await page.mouse.click(pointer.x, pointer.y);
  await page.keyboard.up("Shift");
  await expect(page.getByText("EXTEND Shift-valik: 10 kärbitakse")).toBeVisible();
  const physicalTarget = await page.getByLabel("EXTEND sihid").inputValue();
  expect(physicalTarget).toMatch(/^10@[-+]?\d+(?:\.\d+)?,-?0(?:\.0+)?$/u);
  expect(Number(physicalTarget.slice(3).split(",")[0])).toBeCloseTo(500, 3);
  await expect(page.getByLabel("EXTEND tegevus")).toHaveValue("trim");
  await expect(page.getByTestId("extend-preview")).toHaveText("EXTEND eelvaade: 2 tulemust · 1 sammu");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const shiftTrimCommitted = await readDocument(page);
  const shiftTrimOperation = await readOperation(page);
  expect(shiftTrimOperation).toMatchObject({
    commandId: "EXTEND", targetHandles: ["10"], resultHandles: ["10", "22"],
    args: { boundaryEdgeHandles: ["20", "21"], targets: [{ action: "trim" }] },
  });
  expect((shiftTrimOperation.args.targets as Array<{ pickPoint: { x: number; y: number } }>)[0]!.pickPoint.x).toBeCloseTo(500, 3);
  expect((shiftTrimOperation.args.targets as Array<{ pickPoint: { x: number; y: number } }>)[0]!.pickPoint.y).toBeCloseTo(0, 9);
  expect(shiftTrimOperation.resultHandles.map((handle) => shiftTrimCommitted.entities.find((entity) => entity.handle === handle))).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 250, y: 0 } },
    { kind: "line", handle: "22", start: { x: 750, y: 0 }, end: { x: 1000, y: 0 } },
  ]);
  expect(consoleErrors).toEqual([]);
  await capture("F-023-browser-quick-shift.json", {
    rowId: "F-023", workflow: "Quick all-object boundary + Shift-Trim shared preview/commit",
    quick: { committed: quickCommitted, operation: quickOperation },
    shiftTrim: { source: shiftSeeded, committed: shiftTrimCommitted, operation: shiftTrimOperation },
    physicalInput: { modifier: "Shift", action: "trim", pointer }, consoleErrors, status: "PASS",
  });
});

test("F-023 EXTEND wires Crossing, Edge, Project and layer refusals through the visible UI", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await seedLocalDocument(page, extendDocument());
  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20");
  await page.getByLabel("EXTEND valik", { exact: true }).selectOption("crossing");
  await page.getByLabel("EXTEND valikutee").fill("750,-50; 850,-50; 850,250; 750,250");
  await page.getByRole("button", { name: "EXTEND Fence/Crossing vali" }).click();
  await expect(page.getByText("EXTEND Crossing: 2 sihtmärki valitud")).toBeVisible();
  await expect(page.getByLabel("EXTEND sihid")).toHaveValue(/10@.*; 11@/u);
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const crossing = { document: await readDocument(page), operation: await readOperation(page) };
  expect(crossing.document.entities.slice(0, 2)).toMatchObject([
    { handle: "10", end: { x: 1000, y: 0 } },
    { handle: "11", end: { x: 1000, y: 200 } },
  ]);
  expect(crossing.operation).toMatchObject({ args: { mode: "standard", edgeMode: "no-extend", projectMode: "none" } });

  await seedLocalDocument(page, edgeModeDocument());
  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20");
  await page.getByLabel("EXTEND sihid").fill("10@80,0");
  await page.getByLabel("EXTEND Edge").selectOption("no-extend");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const noExtend = await readDocument(page);
  expect(noExtend.revision).toBe(0);
  expect(noExtend.entities[0]).toMatchObject({ end: { x: 80, y: 0 } });
  await expect(page.getByTestId("extend-rejected")).toHaveAttribute("data-rejected", /no-intersection/u);
  expect(await readOperationCount(page)).toBe(0);

  await page.getByLabel("EXTEND Edge").selectOption("extend");
  await expect(page.getByTestId("extend-preview")).toHaveText("EXTEND eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const edgeExtend = { document: await readDocument(page), operation: await readOperation(page) };
  expect(edgeExtend.document.entities[0]).toMatchObject({ end: { x: 100, y: 0 } });
  expect(edgeExtend.operation).toMatchObject({ args: { edgeMode: "extend" } });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const edgeRestored = await readDocument(page);
  expect(edgeRestored.entities).toEqual(edgeModeDocument().entities);

  const projects: Record<string, { document: KDrawDocumentV1; operation: RecordedOperation }> = {};
  for (const projectMode of ["none", "ucs", "view"] as const) {
    await seedLocalDocument(page, extendDocument());
    await page.getByLabel("EXTEND režiim").selectOption("standard");
    await page.getByLabel("EXTEND boundary edges").fill("20");
    await page.getByLabel("EXTEND sihid").fill("10@800,0");
    await page.getByLabel("EXTEND Project").selectOption(projectMode);
    await page.getByRole("button", { name: "EXTEND", exact: true }).click();
    projects[projectMode] = { document: await readDocument(page), operation: await readOperation(page) };
    expect(projects[projectMode].document.entities[0]).toMatchObject({ end: { x: 1000, y: 0 } });
    expect(projects[projectMode].operation).toMatchObject({ args: { projectMode } });
  }

  const refusalSource = refusalDocument();
  await seedLocalDocument(page, refusalSource);
  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20");
  await page.getByLabel("EXTEND sihid").fill("10@80,0; 11@80,20");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const refusals = JSON.parse(await page.getByTestId("extend-rejected").getAttribute("data-rejected") ?? "[]");
  expect(refusals).toMatchObject([
    { handle: "10", reason: "locked-layer" },
    { handle: "11", reason: "hidden-layer" },
  ]);
  expect(await readDocument(page)).toEqual(refusalSource);
  expect(await readOperationCount(page)).toBe(0);
  expect(consoleErrors).toEqual([]);

  await capture("F-023-browser-options.json", {
    rowId: "F-023",
    workflow: "Crossing + Edge Extend/No extend + Project None/UCS/View + locked/hidden refusal",
    crossing,
    edge: { noExtend, extend: edgeExtend, restored: edgeRestored },
    projects,
    refusals: { source: refusalSource, rejected: refusals, operationCount: 0 },
    consoleErrors,
    status: "PASS",
  });
});

test("F-023 EXTEND open rational SPLINE matches AutoCAD C2 span, knots, weights and file outputs", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T12:30:00.000Z" });
  document.entities = [
    {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 2, 2], closed: false, periodic: false,
      appearance: { color: "#40a0ff", lineweightMm: 0.5 }, extensionData: { rowId: "F-023" },
    },
    { kind: "line", handle: "20", layerId: "0", start: { x: 6, y: -10 }, end: { x: 6, y: 10 } },
  ];
  await seedLocalDocument(page, document);
  const sourceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const sourcePath = await (await sourceDownload).path();
  const sourceDxfBytes = await readFile(sourcePath!);
  const sourceDxf = new DxfParser().parseSync(sourceDxfBytes.toString("utf8"));
  const sourceSpline = sourceDxf?.entities.find((entity) => entity.type === "SPLINE");
  expect(sourceDxf?.entities.map((entity) => entity.type)).toEqual(["SPLINE", "LINE"]);
  expect(sourceSpline).toMatchObject({ handle: "10", degreeOfSplineCurve: 3 });
  expect(sourceSpline?.controlPoints).toHaveLength(4);
  expect(sourceSpline?.knotValues).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);

  await page.getByLabel("EXTEND režiim").selectOption("standard");
  await page.getByLabel("EXTEND boundary edges").fill("20");
  await page.getByLabel("EXTEND sihid").fill("10@3,0");
  await expect(page.getByTestId("extend-preview")).toHaveText("EXTEND eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "EXTEND", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities[0]).toEqual({
    ...document.entities[0],
    controlPoints: [
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 },
      { x: 3.621334927543, y: -0.621334927543 },
      { x: 4.628726947271, y: -1.821755493363 },
      { x: 6.000000000002, y: -3.567997608689 },
    ],
    knots: [0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543], weights: [1, 1, 2, 2, 2, 2, 2],
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  const parsedSpline = parsed?.entities.find((entity) => entity.type === "SPLINE");
  expect(parsed?.entities.map((entity) => entity.type)).toEqual(["SPLINE", "LINE"]);
  expect(parsedSpline).toMatchObject({ handle: "10", degreeOfSplineCurve: 3 });
  expect(parsedSpline?.controlPoints).toHaveLength(7);
  expect(parsedSpline?.knotValues).toEqual([0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543]);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const envelope = JSON.parse(kdrawBytes.toString("utf8").slice("KDRAW1\n".length));
  const kdrawDocument = JSON.parse(Buffer.from(envelope.files["document.json"], "base64").toString("utf8"));
  expect(kdrawDocument.entities).toEqual(committed.entities);
  expect(await readOperation(page)).toMatchObject({ commandId: "EXTEND", targetHandles: ["10"], resultHandles: ["10"] });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);
  expect(consoleErrors).toEqual([]);

  await capture("F-023-browser-spline-source.dxf", sourceDxfBytes);
  await capture("F-023-browser-spline.dxf", dxfBytes);
  await capture("F-023-browser-spline.kdraw", kdrawBytes);
  await capture("F-023-browser-spline.json", {
    rowId: "F-023", commandId: "EXTEND", source: document.entities,
    committed: committed.entities, dxfTypes: parsed?.entities.map((entity) => entity.type),
    kdrawRestored: kdrawDocument.entities, consoleErrors, status: "PASS",
  });
});
