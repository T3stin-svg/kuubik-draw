import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import { f016StandardDocument } from "../parity/fixtures/f016-standard-fixture.mjs";
import { seedKDrawDocument } from "./helpers/indexed-db.js";

type StoredDocument = typeof f016StandardDocument;
type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: Record<string, unknown> };

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function seedLocalDocument(page: import("@playwright/test").Page, document: unknown): Promise<void> {
  await seedKDrawDocument(page, document as { documentId: string; revision: number });
}

async function readDocument(page: import("@playwright/test").Page): Promise<StoredDocument> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document as StoredDocument;
  });
}

async function readOperations(page: import("@playwright/test").Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
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

function lineDocument() {
  const document = structuredClone(f016StandardDocument);
  document.entities = [{
    kind: "line", handle: "10", layerId: "0",
    appearance: { color: "#ff4040", lineweightMm: 0.5 }, extensionData: { rowId: "F-021" },
    start: { x: 0, y: 0 }, end: { x: 1000, y: 0 },
  }];
  document.layers = [
    { id: "0", name: "F021_SOURCE", visible: true, frozen: false, locked: false, plottable: true },
    { id: "current", name: "F021_CURRENT", visible: true, frozen: false, locked: false, plottable: true },
  ];
  document.currentLayerId = "0";
  return document;
}

function familyDocument() {
  const document = structuredClone(f016StandardDocument);
  document.entities = document.entities.filter((entity) => ["10", "11", "12", "13", "14", "1C", "1D"].includes(entity.handle));
  document.metadata = { ...document.metadata, title: "F-021 five-family OFFSET matrix" };
  return document;
}

function singleEntityDocument(entity: StoredDocument["entities"][number]) {
  const document = structuredClone(f016StandardDocument);
  document.entities = [structuredClone(entity)];
  document.layers = [{ id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true }];
  document.currentLayerId = "0";
  document.metadata = { ...document.metadata, title: "F-021 edge matrix" };
  return document;
}

test("F-021 OFFSET Distance Multiple previews, commits once, exports and undoes atomically", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page, lineDocument());
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("100");
  await page.getByLabel("OFFSET punktid").fill("500,100; 500,250");
  await page.getByLabel("OFFSET Multiple").check();
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 2 · 2 sammu · lähteobjektid säilivad");
  await page.getByRole("button", { name: "OFFSET Undo" }).click();
  await expect(page.getByLabel("OFFSET punktid")).toHaveValue("500,100");
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 1 · 1 sammu · lähteobjektid säilivad");
  await page.getByRole("button", { name: "OFFSET Undo" }).click();
  await expect(page.getByText("OFFSET Undo: kõik paigutused eemaldatud; globaalset UNDO sammu ei loodud")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);
  await page.getByLabel("OFFSET punktid").fill("500,100; 500,250");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("2 OFFSET tulemust loodud (Multiple); lähteobjektid säilitatud")).toBeVisible();
  const dxf = await downloadedDxf(page, "F-021-browser-distance-multiple.dxf");
  expect(dxf?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "F021_SOURCE", vertices: [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }] },
    { handle: "11", layer: "F021_SOURCE", vertices: [{ x: 0, y: 100, z: 0 }, { x: 1000, y: 100, z: 0 }] },
    { handle: "12", layer: "F021_SOURCE", vertices: [{ x: 0, y: 200, z: 0 }, { x: 1000, y: 200, z: 0 }] },
  ]);
  const operation = (await readOperations(page))[0]!;
  expect(operation).toMatchObject({ commandId: "OFFSET", targetHandles: ["10"], resultHandles: ["11", "12"], args: { mode: "distance", distance: 100, multiple: true, eraseSource: false, layerMode: "source" } });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(lineDocument().entities);
  await captureJson("F-021-browser-distance-multiple.json", { rowId: "F-021", operation, restored, status: "PASS" });
  expect(consoleErrors).toEqual([]);
});

test("F-021 OFFSET Through supports postselection, Erase Yes and Layer Current", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  const seeded = lineDocument();
  seeded.currentLayerId = "current";
  await seedLocalDocument(page, seeded);
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("OFFSET: vali objektid, seejärel kinnita valik, režiim ja külje-/Through-punkt")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET režiim").selectOption("through");
  await page.getByLabel("OFFSET punktid").fill("1500,375");
  await page.getByLabel("OFFSET kustuta lähteobjektid").check();
  await page.getByLabel("OFFSET kiht").selectOption("current");
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 1 · 1 sammu · lähteobjektid kustutatakse");
  await expect(page.getByTestId("offset-preview")).toHaveAttribute("data-hidden-source-count", "1");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("1 OFFSET tulemust loodud; lähteobjektid kustutatud")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([{ kind: "line", handle: "11", layerId: "current", start: { x: 0, y: 375 }, end: { x: 1000, y: 375 }, appearance: { color: "#ff4040", lineweightMm: 0.5 }, extensionData: { rowId: "F-021" } }]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(seeded.entities);
  expect(consoleErrors).toEqual([]);
});

test("F-021 OFFSET five-family browser matrix uses one kernel and reports locked/proxy refusals", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  const seeded = familyDocument();
  await seedLocalDocument(page, seeded);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("20");
  await page.getByLabel("OFFSET punktid").fill("700,200");
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 5 · 5 sammu · lähteobjektid säilivad");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("5 OFFSET tulemust loodud; lähteobjektid säilitatud; 2 jäi muutmata")).toBeVisible();
  expect(JSON.parse((await page.getByTestId("offset-rejected").getAttribute("data-rejected")) ?? "null")).toEqual([
    { handle: "1C", placementIndex: null, reason: "locked-layer" },
    { handle: "1D", placementIndex: 0, reason: "unsupported-entity" },
  ]);
  const committed = await readDocument(page);
  const created = committed.entities.filter((entity) => ["1E", "1F", "20", "21", "22"].includes(entity.handle));
  expect(created.map((entity) => entity.kind)).toEqual(["line", "polyline", "circle", "arc", "spline"]);
  expect(created[0]).toMatchObject({ layerId: "0", appearance: { color: "#ff4040", lineweightMm: 0.5 } });
  expect(created[1]).toMatchObject({
    kind: "polyline",
    appearance: { linetypeId: "DASHED" },
    closed: false,
    vertices: [
      { x: 100.52613364176466, y: 19.993078387056954, bulge: 0.3690621263778009, startWidth: 2 },
      { x: 140.30104458844787, y: 52.21015748077396, bulge: 0 },
      { x: 208.94427190999915, y: 17.88854381999832, endWidth: 3 },
    ],
  });
  const operation = (await readOperations(page))[0]!;
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const restored = await readDocument(page);
  expect(restored.entities).toEqual(seeded.entities);
  await captureJson("F-021-browser-five-family-matrix.json", { rowId: "F-021", operation, created, restored: restored.entities, status: "PASS" });
  expect(consoleErrors).toEqual([]);
});

test("F-021 OFFSET closed/bulged and invalid-collapse matrix matches the browser commit predicate", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  const observations: Record<string, unknown> = {};

  const closedSource = singleEntityDocument({
    kind: "polyline", handle: "10", layerId: "0", closed: true,
    vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }],
  });
  await seedLocalDocument(page, closedSource);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("20");
  await page.getByLabel("OFFSET punktid").fill("100,100");
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 1 · 1 sammu · lähteobjektid säilivad");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("1 OFFSET tulemust loodud; lähteobjektid säilitatud")).toBeVisible();
  const closedCommitted = await readDocument(page);
  const closedCreated = closedCommitted.entities.find((entity) => entity.handle !== "10");
  expect(closedCreated).toMatchObject({
    kind: "polyline", closed: true,
    vertices: [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 180 }, { x: 20, y: 180 }],
  });
  observations.closed = closedCreated;

  const bulgedSource = singleEntityDocument({
    kind: "polyline", handle: "10", layerId: "0", closed: false,
    vertices: [{ x: -100, y: 0, bulge: 1 }, { x: 100, y: 0 }],
  });
  await seedLocalDocument(page, bulgedSource);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("20");
  await page.getByLabel("OFFSET punktid").fill("0,-150");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("1 OFFSET tulemust loodud; lähteobjektid säilitatud")).toBeVisible();
  const bulgedCommitted = await readDocument(page);
  const bulgedCreated = bulgedCommitted.entities.find((entity) => entity.handle !== "10");
  expect(bulgedCreated).toMatchObject({
    kind: "polyline", closed: false,
    vertices: [{ x: -120, y: 0, bulge: 1 }, { x: 120, y: 0 }],
  });
  observations.bulged = bulgedCreated;

  const concaveSource = singleEntityDocument({
    kind: "polyline", handle: "10", layerId: "0", closed: true,
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }],
  });
  await seedLocalDocument(page, concaveSource);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("60");
  await page.getByLabel("OFFSET punktid").fill("10,10");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("OFFSET ei loonud geomeetriat; 1 lukus, peidetud, puudu või sobimatu")).toBeVisible();
  const concaveRejected = JSON.parse((await page.getByTestId("offset-rejected").getAttribute("data-rejected")) ?? "null");
  expect(concaveRejected).toEqual([{ handle: "10", placementIndex: 0, reason: "self-intersection" }]);
  expect((await readDocument(page)).revision).toBe(0);
  observations.concave = { rejected: concaveRejected, revision: 0 };

  const ellipseSource = singleEntityDocument({
    kind: "ellipse", handle: "10", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 200, y: 0 }, ratio: 0.5,
    startParameter: 0, endParameter: Math.PI * 2,
  });
  await seedLocalDocument(page, ellipseSource);
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("OFFSET distants").fill("60");
  await page.getByLabel("OFFSET punktid").fill("0,0");
  await expect(page.getByTestId("offset-preview")).toHaveText("OFFSET eelvaade: 2 · 2 sammu · lähteobjektid säilivad");
  await page.getByRole("button", { name: "OFFSET", exact: true }).click();
  await expect(page.getByText("2 OFFSET tulemust loodud; lähteobjektid säilitatud")).toBeVisible();
  const ellipseCommitted = await readDocument(page);
  const ellipseCreated = ellipseCommitted.entities.filter((entity) => entity.handle !== "10");
  expect(ellipseCreated).toHaveLength(2);
  expect(ellipseCreated).toMatchObject([
    { kind: "spline", closed: false },
    { kind: "spline", closed: false },
  ]);
  const splineBounds = ellipseCreated.map((entity) => {
    if (entity.kind !== "spline") throw new Error("Expected split spline.");
    return {
      min: { x: Math.min(...entity.controlPoints.map((point) => point.x)), y: Math.min(...entity.controlPoints.map((point) => point.y)) },
      max: { x: Math.max(...entity.controlPoints.map((point) => point.x)), y: Math.max(...entity.controlPoints.map((point) => point.y)) },
    };
  });
  expect(splineBounds[0]!.min.x).toBeCloseTo(-138.56406460551017, 9);
  expect(splineBounds[0]!.min.y).toBeCloseTo(-40, 9);
  expect(splineBounds[0]!.max.x).toBeCloseTo(138.56406460551017, 9);
  expect(splineBounds[0]!.max.y).toBeCloseTo(0, 9);
  expect(splineBounds[1]!.min.x).toBeCloseTo(-138.56406460551017, 9);
  expect(splineBounds[1]!.min.y).toBeCloseTo(0, 9);
  expect(splineBounds[1]!.max.x).toBeCloseTo(138.56406460551017, 9);
  expect(splineBounds[1]!.max.y).toBeCloseTo(40, 9);
  observations.ellipseInwardSplit = { created: ellipseCreated, splineBounds };

  await captureJson("F-021-browser-edge-matrix.json", { rowId: "F-021", observations, status: "PASS" });
  expect(consoleErrors).toEqual([]);
});
