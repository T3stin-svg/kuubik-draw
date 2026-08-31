import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createControlVertexSpline, createEmptyDocument, createFitPointSpline, deserializeKDraw, splinePointAtParameter } from "@kuubik/cad-core";
import type { CadPolyline, CadSpline, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { modelWorldToScreen } from "./helpers/model-space.js";

type RecordedOperation = { commandId: string; args: Record<string, unknown>; resultHandles: string[]; targetHandles: string[] };

async function seedDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
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
  }, document);
  await page.reload();
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function seedEmptyDocument(page: Page): Promise<void> {
  await seedDocument(page, createEmptyDocument({ documentId: "local", now: "2026-08-31T03:20:00.000Z" }));
}

async function readState(page: Page): Promise<{ document: KDrawDocumentV1; operations: RecordedOperation[] }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const transaction = database.transaction(["documents", "operations"], "readonly");
    const documentRequest = transaction.objectStore("documents").get("local");
    const operationRequest = transaction.objectStore("operations").getAll();
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      documentRequest.onsuccess = () => resolveRead(documentRequest.result as KDrawDocumentV1);
      documentRequest.onerror = () => rejectRead(documentRequest.error);
    });
    const rows = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      operationRequest.onsuccess = () => resolveRead(operationRequest.result as Array<{ revision: number; operation: RecordedOperation }>);
      operationRequest.onerror = () => rejectRead(operationRequest.error);
    });
    database.close();
    return { document, operations: rows.sort((first, second) => first.revision - second.revision).map(({ operation }) => operation) };
  });
}

test("F-012 SPLINE Fit/CV registry commits atomically and roundtrips through production files", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await seedEmptyDocument(page);

  await page.getByLabel("SPLINE meetod").selectOption("fit");
  await page.getByLabel("SPLINE punktid").fill("0,0; 40,70; 100,0");
  await page.getByLabel("SPLINE knot").selectOption("sqrt-chord");
  await page.getByLabel("SPLINE tolerance").fill("0.125");
  await page.getByLabel("SPLINE start tangent").fill("180,0");
  await page.getByLabel("SPLINE end tangent").fill("120,-80");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  await expect(page.getByText(/SPLINE Fit salvestatud handle'iga/u)).toBeVisible();

  let state = await readState(page);
  expect(state.document.revision).toBe(1);
  const fit = state.document.entities[0] as CadSpline;
  expect(fit).toMatchObject({
    kind: "spline",
    definitionMethod: "fit-points",
    degree: 3,
    fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
    fitTolerance: 0.125,
    knotParameterization: "sqrt-chord",
    startTangent: { x: 1, y: 0 },
    endTangent: { x: expect.closeTo(0.8320502943, 8), y: expect.closeTo(-0.5547001962, 8) },
    closed: false,
    periodic: false,
  });
  expect(state.operations[0]).toMatchObject({ commandId: "SPLINE", args: { method: "fit" }, resultHandles: [fit.handle] });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  const parsed = new DxfParser().parseSync(dxfText);
  expect(parsed?.entities).toHaveLength(1);
  expect(parsed?.entities[0]).toMatchObject({ type: "SPLINE", handle: fit.handle, degreeOfSplineCurve: 3, numberOfFitPoints: 3 });
  expect(dxfText).toMatch(/\r?\n 74\r?\n3\r?\n/u);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const kdrawPath = await (await download).path();
  expect((await deserializeKDraw(await readFile(kdrawPath!))).document.entities[0]).toEqual(fit);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readState(page)).document.entities).toEqual([]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.entities[0]).toEqual(fit);

  await page.getByLabel("SPLINE meetod").selectOption("control-vertices");
  await page.getByLabel("SPLINE punktid").fill("0,100; 30,160; 70,140; 100,100");
  await page.getByLabel("SPLINE degree").fill("2");
  await page.getByLabel("SPLINE Close").check();
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities[1]).toMatchObject({ kind: "spline", definitionMethod: "control-vertices", degree: 2, closed: true, periodic: true });
  expect((state.document.entities[1] as CadSpline).controlPoints).toHaveLength(6);
  expect(state.operations.at(-1)).toMatchObject({ commandId: "SPLINE", args: { method: "control-vertices", degree: 2, closed: true } });
  expect(errors).toEqual([]);
});

test("F-012 SPLINE Object replaces one PEDIT spline-fit polyline atomically and roundtrips", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-31T04:50:40.894Z" });
  document.entities = [{
    kind: "polyline", handle: "7D", layerId: "0", closed: false,
    appearance: { color: "#00ff00" }, extensionData: { source: "PEDIT-spline-fit" },
    vertices: [{ x: 200, y: 0 }, { x: 230, y: 50 }, { x: 270, y: -20 }, { x: 320, y: 0 }],
  }];
  await seedDocument(page, document);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINE meetod").selectOption("object");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  await expect(page.getByText(/SPLINE Object salvestatud handle'iga/u)).toBeVisible();

  let state = await readState(page);
  expect(state.document.revision).toBe(1);
  expect(state.document.entities).toHaveLength(1);
  const converted = state.document.entities[0] as CadSpline;
  expect(converted).toMatchObject({
    kind: "spline", definitionMethod: "control-vertices", degree: 3,
    controlPoints: [{ x: 200, y: 0 }, { x: 230, y: 50 }, { x: 270, y: -20 }, { x: 320, y: 0 }],
    knots: [0, 0, 0, 0, 1, 1, 1, 1], appearance: { color: "#00ff00" },
  });
  expect(converted.handle).not.toBe("7D");
  expect(state.operations[0]).toMatchObject({ commandId: "SPLINE", args: { method: "object", sourceHandle: "7D" }, targetHandles: ["7D"], resultHandles: [converted.handle] });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  expect(new DxfParser().parseSync((await readFile(dxfPath!)).toString("utf8"))?.entities[0]).toMatchObject({
    type: "SPLINE", handle: converted.handle, degreeOfSplineCurve: 3, numberOfControlPoints: 4, numberOfFitPoints: 0,
  });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities).toEqual(document.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.entities[0]).toEqual(converted);
  expect(errors).toEqual([]);
});

test("F-012 SPLINE uses physical canvas points, live preview and command-local Undo before one commit", async ({ page }) => {
  await seedEmptyDocument(page);
  await page.getByLabel("Ribbon Spline command").click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const worldPoints = [{ x: 500, y: 500 }, { x: 800, y: 800 }, { x: 1100, y: 500 }];
  const screenPoints = await Promise.all(worldPoints.map((point) => modelWorldToScreen(canvas, point)));

  await page.mouse.click(screenPoints[0]!.x, screenPoints[0]!.y);
  await page.mouse.click(screenPoints[1]!.x, screenPoints[1]!.y);
  await expect(canvas).toHaveAttribute("data-spline-point-count", "2");
  await page.mouse.move(screenPoints[2]!.x, screenPoints[2]!.y);
  await expect(page.getByTestId("spline-preview")).toHaveAttribute("data-committed-point-count", "2");
  await expect(page.getByTestId("spline-preview")).toHaveAttribute("data-preview-point-count", "3");
  await page.mouse.click(screenPoints[2]!.x, screenPoints[2]!.y);
  await expect(canvas).toHaveAttribute("data-spline-point-count", "3");

  await page.getByRole("button", { name: "SPLINE Undo", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-spline-point-count", "2");
  expect((await readState(page)).document.revision).toBe(0);
  const restoredThirdPoint = await modelWorldToScreen(canvas, worldPoints[2]!);
  await page.mouse.move(restoredThirdPoint.x, restoredThirdPoint.y);
  await page.mouse.click(restoredThirdPoint.x, restoredThirdPoint.y);
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  await expect(page.getByText(/SPLINE Fit salvestatud handle'iga/u)).toBeVisible();

  const state = await readState(page);
  expect(state.document.revision).toBe(1);
  const committed = state.document.entities[0] as CadSpline;
  expect(committed).toMatchObject({ kind: "spline", definitionMethod: "fit-points" });
  committed.fitPoints?.forEach((point, index) => expect(point).toEqual({
    x: expect.closeTo(worldPoints[index]!.x, 3),
    y: expect.closeTo(worldPoints[index]!.y, 3),
  }));
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0]).toMatchObject({ commandId: "SPLINE", args: { points: committed.fitPoints }, resultHandles: [committed.handle] });
});

test("F-012 SPLINEDIT applies Reverse and Fit edits atomically through selection and IndexedDB", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await seedEmptyDocument(page);
  await page.getByLabel("SPLINE meetod").selectOption("fit");
  await page.getByLabel("SPLINE punktid").fill("0,0; 40,70; 100,0");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  let state = await readState(page);
  const handle = state.document.entities[0]!.handle;

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("reverse");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  await expect(page.getByText(/SPLINEDIT reverse salvestatud/u)).toBeVisible();
  state = await readState(page);
  expect(state.document.revision).toBe(2);
  expect((state.document.entities[0] as CadSpline).fitPoints).toEqual([{ x: 100, y: 0 }, { x: 40, y: 70 }, { x: 0, y: 0 }]);
  expect(state.operations.at(-1)).toMatchObject({ commandId: "SPLINEDIT", args: { targetHandle: handle, actions: [{ type: "reverse" }] } });

  await page.getByLabel("SPLINEDIT valik").selectOption("fit-add");
  await page.getByLabel("SPLINEDIT indeks").fill("1");
  await page.getByLabel("SPLINEDIT punkt").fill("75,45");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  state = await readState(page);
  expect(state.document.revision).toBe(3);
  expect((state.document.entities[0] as CadSpline).fitPoints).toEqual([{ x: 100, y: 0 }, { x: 75, y: 45 }, { x: 40, y: 70 }, { x: 0, y: 0 }]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.revision).toBe(4);
  expect((state.document.entities[0] as CadSpline).fitPoints).toEqual([{ x: 100, y: 0 }, { x: 40, y: 70 }, { x: 0, y: 0 }]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.revision).toBe(5);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  const parsed = new DxfParser().parseSync(dxfText);
  expect(parsed?.entities[0]).toMatchObject({ type: "SPLINE", handle, numberOfFitPoints: 4 });
  expect(errors).toEqual([]);
});

test("F-012 SPLINEDIT moves/weights CVs and preserves periodic duplicates through Close/Open", async ({ page }) => {
  await seedEmptyDocument(page);
  await page.getByLabel("SPLINE meetod").selectOption("control-vertices");
  await page.getByLabel("SPLINE punktid").fill("0,0; 30,70; 80,40; 120,0");
  await page.getByLabel("SPLINE degree").fill("3");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();

  await page.getByLabel("SPLINEDIT valik").selectOption("cv-move");
  await page.getByLabel("SPLINEDIT indeks").fill("1");
  await page.getByLabel("SPLINEDIT punkt").fill("35,90");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("cv-weight");
  await page.getByLabel("SPLINEDIT indeks").fill("1");
  await page.getByLabel("SPLINEDIT weight").fill("2.5");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("close");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();

  let state = await readState(page);
  let spline = state.document.entities[0] as CadSpline;
  expect(spline).toMatchObject({ definitionMethod: "control-vertices", closed: true, periodic: true });
  expect(spline.controlPoints).toHaveLength(7);
  expect(spline.controlPoints[1]).toEqual({ x: 35, y: 90 });
  expect(spline.controlPoints[5]).toEqual({ x: 35, y: 90 });
  expect(spline.weights).toEqual([1, 2.5, 1, 1, 1, 2.5, 1]);

  await page.getByLabel("SPLINEDIT valik").selectOption("open");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  state = await readState(page);
  spline = state.document.entities[0] as CadSpline;
  expect(spline).toMatchObject({ closed: false, periodic: false, controlPoints: [{ x: 0, y: 0 }, { x: 35, y: 90 }, { x: 80, y: 40 }, { x: 120, y: 0 }], weights: [1, 2.5, 1, 1] });
  expect(state.operations.slice(1).map(({ commandId }) => commandId).every((commandId) => commandId === "SPLINEDIT")).toBe(true);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  expect(new DxfParser().parseSync(dxfText)?.entities[0]).toMatchObject({ type: "SPLINE", handle: spline.handle, degreeOfSplineCurve: 3, numberOfControlPoints: 4 });
  expect(dxfText).toMatch(/\r?\n 41\r?\n2\.5\r?\n/u);
});

test("F-012 SPLINEDIT stages live preview, command-local Undo and one atomic Commit", async ({ page }) => {
  await seedEmptyDocument(page);
  await page.getByLabel("SPLINE meetod").selectOption("fit");
  await page.getByLabel("SPLINE punktid").fill("0,0; 40,70; 100,0");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  const source = (await readState(page)).document.entities[0] as CadSpline;
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByRole("button", { name: "SPLINEDIT Begin" }).click();

  await page.getByLabel("SPLINEDIT valik").selectOption("fit-add");
  await page.getByLabel("SPLINEDIT indeks").fill("1");
  await page.getByLabel("SPLINEDIT punkt").fill("20,45");
  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-preview-command", "SPLINEDIT");
  expect((await readState(page)).document.revision).toBe(1);

  await page.getByLabel("SPLINEDIT valik").selectOption("fit-move");
  await page.getByLabel("SPLINEDIT indeks").fill("2");
  await page.getByLabel("SPLINEDIT punkt").fill("45,85");
  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "2");
  expect((await readState(page)).document.revision).toBe(1);
  await page.getByRole("button", { name: "SPLINEDIT Undo" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  expect((await readState(page)).document.revision).toBe(1);

  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await page.getByRole("button", { name: "SPLINEDIT Commit" }).click();
  await expect(page.getByText(/2 tegevust ühe Undo-sammuna/u)).toBeVisible();
  let state = await readState(page);
  expect(state.document.revision).toBe(2);
  expect((state.document.entities[0] as CadSpline).fitPoints).toEqual([{ x: 0, y: 0 }, { x: 20, y: 45 }, { x: 45, y: 85 }, { x: 100, y: 0 }]);
  expect(state.operations.at(-1)).toMatchObject({ commandId: "SPLINEDIT", args: { actions: [{ type: "fit-add" }, { type: "fit-move" }] } });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.revision).toBe(3);
  expect(state.document.entities[0]).toEqual(source);
});

test("F-012 SPLINEDIT Convert to Polyline replaces the source, exports LWPOLYLINE and undoes atomically", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await seedEmptyDocument(page);
  await page.getByLabel("SPLINE meetod").selectOption("fit");
  await page.getByLabel("SPLINE punktid").fill("200,-300; 240,-220; 310,-330; 380,-250");
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();
  const source = (await readState(page)).document.entities[0] as CadSpline;
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("convert-polyline");
  await page.getByLabel("SPLINEDIT precision").fill("10");
  await page.getByRole("button", { name: "SPLINEDIT", exact: true }).click();
  await expect(page.getByText(/SPLINEDIT convert-polyline salvestatud/u)).toBeVisible();

  let state = await readState(page);
  expect(state.document.revision).toBe(2);
  expect(state.document.entities).toHaveLength(1);
  const polyline = state.document.entities[0] as CadPolyline;
  expect(polyline).toMatchObject({ kind: "polyline", closed: false });
  expect(polyline.handle).not.toBe(source.handle);
  expect(polyline.vertices.length).toBeGreaterThan(4);
  expect(polyline.vertices[0]).toEqual({ x: 200, y: -300 });
  expect(polyline.vertices.at(-1)).toEqual({ x: 380, y: -250 });
  expect(state.operations.at(-1)).toMatchObject({
    commandId: "SPLINEDIT",
    args: { targetHandle: source.handle, actions: [{ type: "convert-polyline", precision: 10 }] },
    targetHandles: [source.handle],
    resultHandles: [polyline.handle],
  });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  const parsed = new DxfParser().parseSync(dxfText);
  expect(parsed?.entities).toHaveLength(1);
  expect(parsed?.entities[0]).toMatchObject({ type: "LWPOLYLINE", handle: polyline.handle });
  expect((parsed?.entities[0] as { vertices?: unknown[] }).vertices).toHaveLength(polyline.vertices.length);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities).toEqual([source]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities).toEqual([polyline]);
  expect(errors).toEqual([]);
});

test("F-012 SPLINE captures start/end tangent points physically and command-undoes the first tangent", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await seedEmptyDocument(page);
  await page.getByLabel("SPLINE meetod").selectOption("fit");
  await page.getByLabel("SPLINE punktid").fill("0,0; 40,70; 100,0");
  await page.getByRole("button", { name: "SPLINE Tangents from canvas" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  await expect(canvas).toHaveAttribute("data-spline-tangent-phase", "start");

  const startDirectionPoint = await modelWorldToScreen(canvas, { x: 180, y: 0 });
  await page.mouse.click(startDirectionPoint.x, startDirectionPoint.y);
  await expect(canvas).toHaveAttribute("data-spline-tangent-phase", "end");
  await expect(page.getByLabel("SPLINE start tangent")).toHaveValue("-1,0");
  expect((await readState(page)).document.revision).toBe(0);

  await page.getByRole("button", { name: "SPLINE Undo", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-spline-tangent-phase", "start");
  await expect(page.getByLabel("SPLINE start tangent")).toHaveValue("");
  expect((await readState(page)).document.revision).toBe(0);
  await page.mouse.click(startDirectionPoint.x, startDirectionPoint.y);

  const endDirectionPoint = await modelWorldToScreen(canvas, { x: 220, y: -80 });
  await page.mouse.click(endDirectionPoint.x, endDirectionPoint.y);
  await expect(canvas).toHaveAttribute("data-spline-tangent-phase", "none");
  const endTangentInput = (await page.getByLabel("SPLINE end tangent").inputValue()).split(",").map(Number);
  expect(endTangentInput).toEqual([expect.closeTo(0.8320502943, 5), expect.closeTo(-0.5547001962, 5)]);
  await page.getByRole("button", { name: "SPLINE", exact: true }).click();

  const state = await readState(page);
  expect(state.document.revision).toBe(1);
  expect(state.document.entities[0]).toMatchObject({
    kind: "spline",
    definitionMethod: "fit-points",
    startTangent: { x: -1, y: 0 },
    endTangent: { x: expect.closeTo(0.8320502943, 5), y: expect.closeTo(-0.5547001962, 5) },
  });
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0]).toMatchObject({ commandId: "SPLINE", args: { startTangent: { x: -1, y: 0 } } });
  expect(state.operations[0]?.args.endTangent).toEqual({ x: expect.closeTo(0.8320502943, 5), y: expect.closeTo(-0.5547001962, 5) });
  expect(errors).toEqual([]);
});

test("F-012 SPLINEDIT Fit Kink physically picks the curve, previews, purges Fit data and preserves output geometry", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-31T08:50:00.000Z" });
  const source = createFitPointSpline({
    handle: "10",
    layerId: "0",
    fitPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 70, y: -60 }, { x: 110, y: 60 }, { x: 150, y: 0 }],
  });
  document.entities = [source];
  await seedDocument(page, document);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("fit-kink");
  await page.getByRole("button", { name: "SPLINEDIT Begin" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const targetPoint = splinePointAtParameter(source, 0.45)!;
  const targetScreen = await modelWorldToScreen(canvas, targetPoint);
  await page.mouse.click(targetScreen.x, targetScreen.y);
  const pickedPoint = (await page.getByLabel("SPLINEDIT punkt").inputValue()).split(",").map(Number);
  expect(pickedPoint).toEqual([expect.closeTo(targetPoint.x, 3), expect.closeTo(targetPoint.y, 3)]);

  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  expect((await readState(page)).document.revision).toBe(0);
  await page.getByRole("button", { name: "SPLINEDIT Undo" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "0");
  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await page.getByRole("button", { name: "SPLINEDIT Commit" }).click();

  let state = await readState(page);
  expect(state.document.revision).toBe(1);
  const kink = state.document.entities[0] as CadSpline;
  expect(kink).toMatchObject({ kind: "spline", handle: "10", definitionMethod: "control-vertices" });
  expect(kink).not.toHaveProperty("fitPoints");
  expect(kink.controlPoints).toHaveLength(source.controlPoints.length + source.degree);
  expect(kink.knots).toHaveLength(source.knots.length + source.degree);
  for (let index = 0; index <= 40; index += 1) {
    const parameter = index / 40;
    expect(splinePointAtParameter(kink, parameter)).toEqual({
      x: expect.closeTo(splinePointAtParameter(source, parameter)!.x, 7),
      y: expect.closeTo(splinePointAtParameter(source, parameter)!.y, 7),
    });
  }
  expect(state.operations[0]).toMatchObject({ commandId: "SPLINEDIT", args: { targetHandle: "10", actions: [{ type: "fit-kink" }] }, targetHandles: ["10"], resultHandles: ["10"] });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  const parsedKink = new DxfParser().parseSync(dxfText)?.entities[0];
  expect(parsedKink).toMatchObject({
    type: "SPLINE",
    handle: "10",
    degreeOfSplineCurve: 3,
    numberOfControlPoints: kink.controlPoints.length,
    numberOfFitPoints: 0,
  });
  expect(parsedKink?.knotValues).toHaveLength(kink.knots.length);
  kink.knots.forEach((value, index) => expect(parsedKink?.knotValues?.[index]).toBeCloseTo(value, 12));

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const kdrawPath = await (await download).path();
  expect((await deserializeKDraw(await readFile(kdrawPath!))).document.entities[0]).toEqual(kink);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities[0]).toEqual(source);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.entities[0]).toEqual(kink);
  expect(errors).toEqual([]);
});

test("F-012 SPLINEDIT CV Add and Elevate use a physical pick, staged preview and one atomic file-safe commit", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-31T09:25:00.000Z" });
  const source = createControlVertexSpline({
    handle: "80",
    layerId: "0",
    degree: 3,
    controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }],
  });
  document.entities = [source];
  await seedDocument(page, document);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("cv-add");
  await page.getByRole("button", { name: "SPLINEDIT Begin" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const target = splinePointAtParameter(source, 0.5)!;
  const targetScreen = await modelWorldToScreen(canvas, target);
  await page.mouse.click(targetScreen.x, targetScreen.y);
  const pickedPoint = (await page.getByLabel("SPLINEDIT punkt").inputValue()).split(",").map(Number);
  expect(pickedPoint).toEqual([expect.closeTo(target.x, 3), expect.closeTo(target.y, 3)]);

  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  expect((await readState(page)).document.revision).toBe(0);
  await page.getByLabel("SPLINEDIT valik").selectOption("cv-elevate");
  await page.getByLabel("SPLINEDIT order").fill("5");
  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "2");
  await page.getByRole("button", { name: "SPLINEDIT Undo" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await page.getByRole("button", { name: "SPLINEDIT Commit" }).click();
  await expect(page.getByText(/2 tegevust ühe Undo-sammuna/u)).toBeVisible();

  let state = await readState(page);
  expect(state.document.revision).toBe(1);
  const refined = state.document.entities[0] as CadSpline;
  expect(refined).toMatchObject({ kind: "spline", handle: "80", definitionMethod: "control-vertices", degree: 4, closed: false, periodic: false });
  expect(refined.controlPoints).toHaveLength(7);
  expect(refined.knots).toHaveLength(12);
  refined.knots.slice(0, 5).forEach((value) => expect(value).toBe(0));
  refined.knots.slice(5, 7).forEach((value) => expect(value).toBeCloseTo(0.5, 5));
  refined.knots.slice(7).forEach((value) => expect(value).toBe(1));
  for (let index = 0; index <= 80; index += 1) {
    const parameter = index / 80;
    expect(splinePointAtParameter(refined, parameter)).toEqual({
      x: expect.closeTo(splinePointAtParameter(source, parameter)!.x, 7),
      y: expect.closeTo(splinePointAtParameter(source, parameter)!.y, 7),
    });
  }
  expect(state.operations[0]).toMatchObject({
    commandId: "SPLINEDIT",
    args: { targetHandle: "80", actions: [{ type: "cv-add" }, { type: "cv-elevate", order: 5 }] },
    targetHandles: ["80"],
    resultHandles: ["80"],
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const dxfText = (await readFile(dxfPath!)).toString("utf8");
  const parsed = new DxfParser().parseSync(dxfText)?.entities[0];
  expect(parsed).toMatchObject({ type: "SPLINE", handle: "80", degreeOfSplineCurve: 4, numberOfControlPoints: 7, numberOfFitPoints: 0 });
  expect(parsed?.knotValues).toHaveLength(12);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const kdrawPath = await (await download).path();
  expect((await deserializeKDraw(await readFile(kdrawPath!))).document.entities[0]).toEqual(refined);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities).toEqual([source]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.entities).toEqual([refined]);
  expect(errors).toEqual([]);
});

test("F-012 SPLINEDIT CV Delete picks a visible grip and matches the AutoCAD open-knot result", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-31T09:55:00.000Z" });
  const source = createControlVertexSpline({
    handle: "90",
    layerId: "0",
    degree: 3,
    controlPoints: [{ x: 0, y: 0 }, { x: 15, y: 35 }, { x: 55, y: 25 }, { x: 100, y: -10 }, { x: 120, y: 0 }],
  });
  expect(source.knots).toEqual([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
  document.entities = [source];
  await seedDocument(page, document);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("SPLINEDIT valik").selectOption("cv-delete");
  await page.getByRole("button", { name: "SPLINEDIT Begin" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const controlVertexScreen = await modelWorldToScreen(canvas, source.controlPoints[2]!);
  await page.mouse.click(controlVertexScreen.x, controlVertexScreen.y);
  await expect(page.getByLabel("SPLINEDIT indeks")).toHaveValue("2");
  await expect(page.getByText(/CV 2 valitud/u)).toBeVisible();

  await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
  await expect(page.getByTestId("spline-edit-preview")).toHaveAttribute("data-action-count", "1");
  expect((await readState(page)).document.revision).toBe(0);
  await page.getByRole("button", { name: "SPLINEDIT Commit" }).click();
  await expect(page.getByText(/1 tegevust ühe Undo-sammuna/u)).toBeVisible();

  let state = await readState(page);
  expect(state.document.revision).toBe(1);
  const deleted = state.document.entities[0] as CadSpline;
  expect(deleted).toMatchObject({
    kind: "spline",
    handle: "90",
    degree: 3,
    controlPoints: [{ x: 0, y: 0 }, { x: 15, y: 35 }, { x: 100, y: -10 }, { x: 120, y: 0 }],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  });
  expect(state.operations[0]).toMatchObject({
    commandId: "SPLINEDIT",
    args: { targetHandle: "90", actions: [{ type: "cv-delete", index: 2 }] },
    targetHandles: ["90"],
    resultHandles: ["90"],
  });

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfPath = await (await download).path();
  const parsed = new DxfParser().parseSync((await readFile(dxfPath!)).toString("utf8"))?.entities[0];
  expect(parsed).toMatchObject({ type: "SPLINE", handle: "90", degreeOfSplineCurve: 3, numberOfControlPoints: 4, numberOfFitPoints: 0 });
  expect(parsed?.knotValues).toHaveLength(8);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const kdrawPath = await (await download).path();
  expect((await deserializeKDraw(await readFile(kdrawPath!))).document.entities[0]).toEqual(deleted);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  state = await readState(page);
  expect(state.document.entities).toEqual([source]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readState(page)).document.entities).toEqual([deleted]);
  expect(errors).toEqual([]);
});

test("F-012 SPLINEDIT CV Delete wires minimum, quadratic and periodic AutoCAD variants through physical grips", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const fixtures: Array<{ source: CadSpline; assertResult: (result: CadSpline) => void }> = [
    {
      source: createControlVertexSpline({
        handle: "92", layerId: "0", degree: 3,
        controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }],
        weights: [1, 1.25, 0.8, 1],
      }),
      assertResult: (result) => expect(result).toMatchObject({
        degree: 2,
        controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 120, y: 0 }],
        weights: [1, 1.25, 1],
        knots: [0, 0, 0, 1, 1, 1],
      }),
    },
    {
      source: createControlVertexSpline({
        handle: "94", layerId: "0", degree: 2,
        controlPoints: [{ x: 0, y: 0 }, { x: 25, y: 80 }, { x: 60, y: 30 }, { x: 95, y: -25 }, { x: 125, y: 0 }],
      }),
      assertResult: (result) => expect(result).toMatchObject({
        degree: 2,
        controlPoints: [{ x: 0, y: 0 }, { x: 25, y: 80 }, { x: 95, y: -25 }, { x: 125, y: 0 }],
        knots: [0, 0, 0, 1 / 3, 1, 1, 1],
      }),
    },
    {
      source: createControlVertexSpline({
        handle: "93", layerId: "0", degree: 3, closed: true,
        controlPoints: [{ x: 0, y: 0 }, { x: 25, y: 80 }, { x: 60, y: 35 }, { x: 120, y: 0 }, { x: 80, y: -60 }, { x: 15, y: -45 }],
      }),
      assertResult: (result) => {
        expect(result).toMatchObject({ closed: true, periodic: true, degree: 3 });
        expect(result.controlPoints.slice(0, 5)).toEqual([{ x: 0, y: 0 }, { x: 25, y: 80 }, { x: 120, y: 0 }, { x: 80, y: -60 }, { x: 15, y: -45 }]);
        expect(result.controlPoints.slice(5)).toEqual(result.controlPoints.slice(0, 3));
        const start = splinePointAtParameter(result, result.knots[result.degree]!)!;
        const end = splinePointAtParameter(result, result.knots[result.controlPoints.length]!)!;
        expect(start).toEqual({ x: expect.closeTo(end.x, 9), y: expect.closeTo(end.y, 9) });
      },
    },
  ];

  for (const fixture of fixtures) {
    const document = createEmptyDocument({ documentId: "local", now: "2026-08-31T10:30:00.000Z" });
    document.entities = [fixture.source];
    await seedDocument(page, document);
    await page.getByRole("button", { name: "Vali kõik" }).click();
    await page.getByLabel("SPLINEDIT valik").selectOption("cv-delete");
    await page.getByRole("button", { name: "SPLINEDIT Begin" }).click();
    const canvas = page.getByLabel("Kuubik Draw joonestusala");
    const grip = await modelWorldToScreen(canvas, fixture.source.controlPoints[2]!);
    await page.mouse.click(grip.x, grip.y);
    await expect(page.getByLabel("SPLINEDIT indeks")).toHaveValue("2");
    await page.getByRole("button", { name: "SPLINEDIT Stage" }).click();
    expect((await readState(page)).document.revision).toBe(0);
    await page.getByRole("button", { name: "SPLINEDIT Commit" }).click();
    let state = await readState(page);
    expect(state.document.revision).toBe(1);
    const result = state.document.entities[0] as CadSpline;
    fixture.assertResult(result);
    expect(state.operations[0]).toMatchObject({ commandId: "SPLINEDIT", args: { targetHandle: fixture.source.handle, actions: [{ type: "cv-delete", index: 2 }] } });

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "DXF eksport" }).click();
    const dxfPath = await (await download).path();
    const parsed = new DxfParser().parseSync((await readFile(dxfPath!)).toString("utf8"))?.entities[0];
    expect(parsed).toMatchObject({ type: "SPLINE", handle: fixture.source.handle, degreeOfSplineCurve: result.degree, numberOfControlPoints: result.controlPoints.length });
    expect(parsed?.knotValues).toHaveLength(result.knots.length);

    await page.getByRole("button", { name: "UNDO", exact: true }).click();
    state = await readState(page);
    expect(state.document.entities).toEqual([fixture.source]);
    await page.getByRole("button", { name: "REDO", exact: true }).click();
    expect((await readState(page)).document.entities).toEqual([result]);
  }
  expect(errors).toEqual([]);
});
