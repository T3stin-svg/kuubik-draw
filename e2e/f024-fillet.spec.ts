import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import DxfParser from "dxf-parser";
import { createEmptyDocument, deserializeKDraw } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { modelWorldToScreen } from "./helpers/model-space.js";
import { seedKDrawDocument } from "./helpers/indexed-db.js";

type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: Record<string, unknown> };

const captureRoot = process.env.PARITY_CAPTURE_DIR;
async function capture(name: string, value: unknown): Promise<void> {
  if (!captureRoot) return;
  await mkdir(captureRoot, { recursive: true });
  const path = resolve(captureRoot, name);
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) await writeFile(path, value);
  else await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pairDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T15:00:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#40a0ff" }, extensionData: { rowId: "F-024" }, start: { x: -1000, y: 0 }, end: { x: 0, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 1000 } },
    { kind: "line", handle: "30", layerId: "0", start: { x: 1000, y: 0 }, end: { x: 2000, y: 0 } },
    { kind: "line", handle: "40", layerId: "0", start: { x: 1000, y: 0 }, end: { x: 1000, y: 1000 } },
  ];
  return document;
}

function dxfRecordPairs(text: string, type: string, handle: string): Array<[number, string]> {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index + 3 < lines.length; index += 2) {
    if (lines[index]?.trim() !== "0" || lines[index + 1]?.trim() !== type) continue;
    const pairs: Array<[number, string]> = [];
    for (let pairIndex = index + 2; pairIndex + 1 < lines.length; pairIndex += 2) {
      const code = Number(lines[pairIndex]?.trim());
      const value = lines[pairIndex + 1]?.trim() ?? "";
      if (code === 0) break;
      pairs.push([code, value]);
    }
    if (pairs.some(([code, value]) => code === 5 && value === handle)) return pairs;
  }
  return [];
}

async function seedLocalDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
  await seedKDrawDocument(page, document);
}

async function readDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
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
      const request = indexedDB.open("kuubik-draw");
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

async function readOperations(page: Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
    const rows = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result as Array<{ revision: number; operation: RecordedOperation }>);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return rows.sort((first, second) => first.revision - second.revision).map(({ operation }) => operation);
  });
}

test("F-024 FILLET Multiple preview equals atomic commit and one-step Undo/Redo", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const seeded = pairDocument();
  await seedLocalDocument(page, seeded);

  await page.getByLabel("FILLET režiim").selectOption("pairs");
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET Trim").selectOption("trim");
  await page.getByLabel("FILLET paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 6 tulemust · 2 sammu");
  await expect(page.getByTestId("fillet-preview")).toHaveAttribute("data-hidden-source-count", "4");

  await page.getByRole("button", { name: "FILLET Undo" }).click();
  await expect(page.getByLabel("FILLET paarid")).toHaveValue("10@-500,0>20@0,500");
  await expect(page.getByText("FILLET Undo: viimane paar eemaldatud; 1 paari jääb")).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);

  await page.getByLabel("FILLET paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  await expect(page.getByText("2 FILLET sammu salvestatud ühe Undo-operatsioonina")).toBeVisible();
  const committed = await readDocument(page);
  expect(committed.revision).toBe(1);
  expect(committed.entities).toMatchObject([
    { handle: "10", start: { x: -1000, y: 0 }, end: { x: -100, y: 0 }, appearance: seeded.entities[0]!.appearance, extensionData: seeded.entities[0]!.extensionData },
    { handle: "20", start: { x: 0, y: 100 }, end: { x: 0, y: 1000 } },
    { handle: "30", start: { x: 1100, y: 0 }, end: { x: 2000, y: 0 } },
    { handle: "40", start: { x: 1000, y: 100 }, end: { x: 1000, y: 1000 } },
    { kind: "arc", handle: "41", layerId: "0", center: { x: -100, y: 100 }, radius: 100 },
    { kind: "arc", handle: "42", layerId: "0", center: { x: 1100, y: 100 }, radius: 100 },
  ]);
  expect(await readOperation(page)).toMatchObject({
    commandId: "FILLET", targetHandles: ["10", "20", "30", "40"], resultHandles: ["10", "20", "41", "30", "40", "42"],
    args: { mode: "pairs", radius: 100, trimMode: "trim", multiple: true },
  });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(seeded.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);
});

test("F-024 FILLET No Trim keeps sources and Polyline rounds every eligible vertex", async ({ page }) => {
  await seedLocalDocument(page, pairDocument());
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET Trim").selectOption("no-trim");
  await page.getByLabel("FILLET paarid").fill("10@-500,0>20@0,500");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 1 tulemust · 1 sammu");
  await expect(page.getByTestId("fillet-preview")).toHaveAttribute("data-hidden-source-count", "0");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const noTrim = await readDocument(page);
  expect(noTrim.entities.slice(0, 4)).toEqual(pairDocument().entities);
  expect(noTrim.entities[4]).toMatchObject({ kind: "arc", handle: "41", radius: 100 });

  const polyline = createEmptyDocument({ documentId: "local", now: "2026-08-29T15:10:00.000Z" });
  polyline.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }] }];
  await seedLocalDocument(page, polyline);
  await page.getByLabel("FILLET režiim").selectOption("polyline");
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET Polyline handle'id").fill("10");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const rounded = await readDocument(page);
  expect(rounded.entities[0]).toMatchObject({ kind: "polyline", handle: "10", closed: true });
  expect(rounded.entities[0]?.kind === "polyline" ? rounded.entities[0].vertices : []).toHaveLength(8);
});

test("F-024 FILLET rejects locked layers but explicit handles edit off and frozen layers like AutoCAD", async ({ page }) => {
  const document = pairDocument();
  document.layers.push(
    { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
    { id: "frozen", name: "FROZEN", visible: true, frozen: true, locked: false, plottable: true },
  );
  document.entities[0] = { ...document.entities[0]!, layerId: "locked" };
  document.entities[2] = { ...document.entities[2]!, layerId: "hidden" };
  document.entities.push(
    { kind: "line", handle: "50", layerId: "frozen", start: { x: 3000, y: 0 }, end: { x: 4000, y: 0 } },
    { kind: "line", handle: "60", layerId: "frozen", start: { x: 4000, y: 0 }, end: { x: 4000, y: 1000 } },
  );
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500; 50@3500,0>60@4000,500");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  await expect(page.getByTestId("fillet-rejected")).toContainText("10+20#1 (locked-layer)");
  await expect(page.getByTestId("fillet-rejected")).not.toContainText("hidden-layer");
  const committed = await readDocument(page);
  expect(committed.entities.find((entity) => entity.handle === "10")).toEqual(document.entities[0]);
  expect(committed.entities.find((entity) => entity.handle === "20")).toEqual(document.entities[1]);
  expect(committed.entities.find((entity) => entity.handle === "30")).toMatchObject({ kind: "line", layerId: "hidden", start: { x: 1100, y: 0 }, end: { x: 2000, y: 0 } });
  expect(committed.entities.find((entity) => entity.handle === "40")).toMatchObject({ kind: "line", start: { x: 1000, y: 100 } });
  expect(committed.entities.find((entity) => entity.handle === "50")).toMatchObject({ kind: "line", layerId: "frozen", end: { x: 3900, y: 0 } });
  expect(committed.entities.find((entity) => entity.handle === "60")).toMatchObject({ kind: "line", start: { x: 4000, y: 100 } });
  expect(committed.entities.filter((entity) => entity.kind === "arc")).toMatchObject([
    { handle: "61", layerId: "0", radius: 100 },
    { handle: "62", layerId: "frozen", radius: 100 },
  ]);
  expect(await readOperation(page)).toMatchObject({ targetHandles: ["30", "40", "50", "60"], resultHandles: ["30", "40", "61", "50", "60", "62"] });
});

test("F-024 FILLET Polyline mixed success keeps rejected geometry visible and unchanged", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T15:30:00.000Z" });
  document.entities = [
    { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }] },
    { kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 1500, y: 0 }, { x: 1505, y: 0 }, { x: 1505, y: 5 }] },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET režiim").selectOption("polyline");
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET Polyline handle'id").fill("10,20");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 1 tulemust · 1 sammu");
  await expect(page.getByTestId("fillet-preview")).toHaveAttribute("data-hidden-source-count", "1");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  await expect(page.getByTestId("fillet-rejected")).toContainText("20#2 (radius-too-large)");
  const committed = await readDocument(page);
  expect(committed.entities.find((entity) => entity.handle === "20")).toEqual(document.entities[1]);
  expect((committed.entities.find((entity) => entity.handle === "10") as Extract<typeof committed.entities[number], { kind: "polyline" }>).vertices).toHaveLength(8);
  expect(await readOperation(page)).toMatchObject({ commandId: "FILLET", targetHandles: ["10"], resultHandles: ["10"] });
});

test("F-024 FILLET physical two-click canvas selection previews, commits and undoes exact geometry", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T16:00:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: 1000 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const first = await modelWorldToScreen(canvas, { x: 500, y: 1000 });
  const second = await modelWorldToScreen(canvas, { x: 1000, y: 1500 });
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText("FILLET esimene objekt: 10; vali teine objekt")).toBeVisible();
  await page.mouse.click(second.x, second.y);
  await expect(page.getByText("FILLET paar lisatud: 10+20; vali järgmine esimene objekt või käivita FILLET")).toBeVisible();
  const physicalPair = await page.getByLabel("FILLET paarid").inputValue();
  expect(physicalPair).toMatch(/^10@[-+]?\d+(?:\.\d+)?,1000>20@1000,[-+]?\d+(?:\.\d+)?$/u);
  expect(Number(physicalPair.slice(3).split(",")[0])).toBeCloseTo(500, 3);
  expect(Number(physicalPair.split(",")[2])).toBeCloseTo(1500, 3);
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 3 tulemust · 1 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "line", handle: "20", start: { x: 1000, y: 1100 }, end: { x: 1000, y: 2000 } },
    { kind: "arc", handle: "21", center: { x: 900, y: 1100 }, radius: 100 },
  ]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);
  expect(consoleErrors).toEqual([]);
});

test("F-024 FILLET physically picks a RAY and XLINE and commits AutoCAD construction-line semantics", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T21:50:00.000Z" });
  document.entities = [
    { kind: "ray", handle: "10", layerId: "0", basePoint: { x: 0, y: 1000 }, direction: { x: 4, y: 0 } },
    { kind: "xline", handle: "20", layerId: "0", basePoint: { x: 1000, y: 1000 }, direction: { x: 0, y: 3 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const first = await modelWorldToScreen(canvas, { x: 500, y: 1000 });
  const second = await modelWorldToScreen(canvas, { x: 1000, y: 1500 });
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText("FILLET esimene objekt: 10; vali teine objekt")).toBeVisible();
  await page.mouse.click(second.x, second.y);
  await expect(page.getByText("FILLET paar lisatud: 10+20; vali järgmine esimene objekt või käivita FILLET")).toBeVisible();
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 3 tulemust · 1 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "ray", handle: "20", basePoint: { x: 1000, y: 1100 }, direction: { x: 0, y: 1 } },
    { kind: "arc", handle: "21", center: { x: 900, y: 1100 }, radius: 100 },
  ]);
  expect(committed.entities.some((entity) => entity.kind === "xline")).toBe(false);
  expect(await readOperation(page)).toMatchObject({ commandId: "FILLET", targetHandles: ["10", "20"], resultHandles: ["10", "20", "21"] });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);
  expect(consoleErrors).toEqual([]);
});

test("F-024 FILLET Shift on the second canvas pick uses radius zero once and preserves stored Radius", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T16:10:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: 1100 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const first = await modelWorldToScreen(canvas, { x: 500, y: 1000 });
  const second = await modelWorldToScreen(canvas, { x: 1000, y: 1500 });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect(page.getByText("FILLET Shift-teine objekt: 20; see paar kasutab raadiust 0, salvestatud Radius ei muutunud")).toBeVisible();
  await expect(page.getByLabel("FILLET radius")).toHaveValue("100");
  const shiftPair = await page.getByLabel("FILLET paarid").inputValue();
  expect(shiftPair).toMatch(/^10@[-+]?\d+(?:\.\d+)?,1000>20@1000,[-+]?\d+(?:\.\d+)?~0$/u);
  expect(Number(shiftPair.slice(3).split(",")[0])).toBeCloseTo(500, 3);
  expect(Number(shiftPair.split(",")[2].replace("~0", ""))).toBeCloseTo(1500, 3);
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toMatchObject([
    { kind: "line", handle: "10", end: { x: 1000, y: 1000 } },
    { kind: "line", handle: "20", start: { x: 1000, y: 1000 } },
  ]);
  expect(committed.entities).toHaveLength(2);
  expect(await readOperation(page)).toMatchObject({
    commandId: "FILLET",
    args: { radius: 100, pairs: [{ firstHandle: "10", secondHandle: "20", radiusOverride: 0 }] },
  });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);
});

test("F-024 FILLET physical polyline segment picks carry stable segment ids into one atomic edit", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T16:20:00.000Z" });
  document.entities = [{
    kind: "polyline", handle: "10", layerId: "0", closed: true,
    vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 2000 }, { x: 0, y: 2000 }],
  }];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const first = await modelWorldToScreen(canvas, { x: 500, y: 1000 });
  const second = await modelWorldToScreen(canvas, { x: 1000, y: 1500 });
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText("FILLET esimene objekt: 10 segment 0; vali teine objekt")).toBeVisible();
  await page.mouse.click(second.x, second.y);
  await expect(page.getByLabel("FILLET paarid")).toHaveValue(/10#0@.*>10#1@/u);
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 1 tulemust · 1 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities).toHaveLength(1);
  expect(committed.entities[0]).toMatchObject({ kind: "polyline", handle: "10", closed: true });
  expect(committed.entities[0]?.kind === "polyline" ? committed.entities[0].vertices : []).toHaveLength(5);
  expect(await readOperation(page)).toMatchObject({
    commandId: "FILLET", targetHandles: ["10"], resultHandles: ["10"],
    args: { pairs: [{ firstHandle: "10", firstSegment: 0, secondHandle: "10", secondSegment: 1 }] },
  });
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(document.entities);
});

test("F-024 FILLET Polyline No Trim and FILLETPOLYARC preserve the source and expose the selected policy", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T16:30:00.000Z" });
  document.entities = [{
    kind: "polyline", handle: "10", layerId: "0", closed: false,
    vertices: [
      { x: 0, y: 0 },
      { x: 1000, y: 0, bulge: Math.tan(Math.PI / 8) },
      { x: 1500, y: 500 },
      { x: 1500, y: 1500 },
      { x: 500, y: 1500 },
    ],
  }];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET režiim").selectOption("polyline");
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET Trim").selectOption("no-trim");
  await page.getByLabel("FILLETPOLYARC").selectOption("0");
  await page.getByLabel("FILLET Polyline handle'id").fill("10");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 2 tulemust · 1 sammu");
  await expect(page.getByTestId("fillet-preview")).toHaveAttribute("data-hidden-source-count", "0");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities[0]).toEqual(document.entities[0]);
  expect(committed.entities.slice(1)).toMatchObject([
    { kind: "arc", handle: "11", radius: 100 },
    { kind: "arc", handle: "12", radius: 100 },
  ]);
  expect(await readOperation(page)).toMatchObject({
    commandId: "FILLET", targetHandles: ["10"], resultHandles: ["11", "12"],
    args: { mode: "polyline", trimMode: "no-trim", filletPolylineArc: 0 },
  });
});

test("F-024 browser evidence fillets line-circle and line-arc with AutoCAD layer rules", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-29T17:20:00.000Z" });
  source.layers.push(
    { id: "a", name: "A", visible: true, frozen: false, locked: false, plottable: true },
    { id: "b", name: "B", visible: true, frozen: false, locked: false, plottable: true },
    { id: "c", name: "C", visible: true, frozen: false, locked: false, plottable: true },
  );
  source.currentLayerId = "c";
  const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.5 };
  source.entities = [
    { kind: "line", handle: "10", layerId: "a", appearance, start: { x: -100, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "circle", handle: "20", layerId: "b", appearance, center: { x: 0, y: 30 }, radius: 10 },
    { kind: "line", handle: "30", layerId: "a", appearance, start: { x: 200, y: 0 }, end: { x: 400, y: 0 } },
    { kind: "arc", handle: "40", layerId: "a", appearance, center: { x: 300, y: 30 }, radius: 10, startAngleRad: Math.PI, endAngleRad: Math.PI * 2, counterClockwise: true },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("FILLET režiim").selectOption("pairs");
  await page.getByLabel("FILLET radius").fill("10");
  await page.getByLabel("FILLET Trim").selectOption("no-trim");
  await page.getByLabel("FILLET paarid").fill("10@-30,0>20@-10,30; 30@270,0>40@290,30");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 2 tulemust · 2 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities.slice(0, 4)).toEqual(source.entities);
  expect(committed.entities.slice(4)).toMatchObject([
    { kind: "arc", handle: "41", layerId: "c", radius: 10, appearance: { lineweightMm: 0.5 } },
    { kind: "arc", handle: "42", layerId: "a", radius: 10, appearance },
  ]);
  const operation = await readOperation(page);
  expect(operation).toMatchObject({
    commandId: "FILLET", targetHandles: ["10", "20", "30", "40"], resultHandles: ["41", "42"],
    args: { mode: "pairs", radius: 10, trimMode: "no-trim", multiple: true },
  });
  expect(consoleErrors).toEqual([]);
  await capture("F-024-browser-families.json", { rowId: "F-024", source, committed, operation, consoleErrors, status: "PASS" });
});

test("F-024 browser evidence trims full ellipse and rational spline with the AutoCAD live contract", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-29T17:25:00.000Z" });
  const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.5 };
  source.entities = [
    { kind: "line", handle: "10", layerId: "0", appearance, start: { x: -200, y: 0 }, end: { x: 0, y: 0 } },
    { kind: "ellipse", handle: "20", layerId: "0", appearance, center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
    { kind: "line", handle: "30", layerId: "0", appearance, start: { x: 100, y: 200 }, end: { x: 300, y: 200 } },
    { kind: "spline", handle: "40", layerId: "0", appearance, degree: 3, controlPoints: [{ x: 300, y: 200 }, { x: 300, y: 240 }, { x: 360, y: 260 }, { x: 400, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 2, 3, 4], closed: false, periodic: false },
  ];
  await seedLocalDocument(page, source);

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const sourceDxfBytes = await readFile(path!);
  const parsedSource = new DxfParser().parseSync(sourceDxfBytes.toString("utf8"));
  expect(parsedSource?.entities.map((entity) => [entity.handle, entity.type])).toEqual([
    ["10", "LINE"], ["20", "ELLIPSE"], ["30", "LINE"], ["40", "SPLINE"],
  ]);

  await page.getByLabel("FILLET režiim").selectOption("pairs");
  await page.getByLabel("FILLET radius").fill("10");
  await page.getByLabel("FILLET Trim").selectOption("trim");
  await page.getByLabel("FILLET paarid").fill("10@-20,0>20@2,10; 30@280,200>40@302,210");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 5 tulemust · 2 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  const lineEllipse = committed.entities.find((entity) => entity.handle === "10");
  const ellipse = committed.entities.find((entity) => entity.handle === "20");
  const lineSpline = committed.entities.find((entity) => entity.handle === "30");
  const spline = committed.entities.find((entity) => entity.handle === "40");
  const ellipseArc = committed.entities.find((entity) => entity.handle === "41");
  const splineArc = committed.entities.find((entity) => entity.handle === "42");
  expect(lineEllipse).toMatchObject({ kind: "line", end: { y: 0 } });
  expect((lineEllipse as Extract<typeof lineEllipse, { kind: "line" }>).end.x).toBeCloseTo(-8.55777007055, 5);
  expect(ellipse).toEqual(source.entities[1]);
  expect(lineSpline).toMatchObject({ kind: "line", end: { y: 200 } });
  expect((lineSpline as Extract<typeof lineSpline, { kind: "line" }>).end.x).toBeLessThan(300);
  expect(spline).toMatchObject({ kind: "spline", degree: 3, weights: expect.any(Array), closed: false, periodic: false });
  expect((spline as Extract<typeof spline, { kind: "spline" }>).controlPoints[0]).not.toEqual(source.entities[3] && "controlPoints" in source.entities[3] ? source.entities[3].controlPoints[0] : null);
  expect(ellipseArc).toMatchObject({ kind: "arc", handle: "41", radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } });
  expect((ellipseArc as Extract<typeof ellipseArc, { kind: "arc" }>).appearance?.lineweightMm).toBeUndefined();
  expect((ellipseArc as Extract<typeof ellipseArc, { kind: "arc" }>).center.x).toBeCloseTo(-8.55777007055, 5);
  expect((ellipseArc as Extract<typeof ellipseArc, { kind: "arc" }>).center.y).toBeCloseTo(10, 7);
  expect(splineArc).toMatchObject({ kind: "arc", handle: "42", radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } });
  expect((splineArc as Extract<typeof splineArc, { kind: "arc" }>).appearance?.lineweightMm).toBeUndefined();
  const operation = await readOperation(page);
  expect(operation).toMatchObject({ commandId: "FILLET", targetHandles: ["10", "20", "30", "40"], resultHandles: ["10", "20", "41", "30", "40", "42"], args: { mode: "pairs", radius: 10, trimMode: "trim", multiple: true } });

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => [entity.handle, entity.type])).toEqual([
    ["10", "LINE"], ["20", "ELLIPSE"], ["30", "LINE"], ["40", "SPLINE"], ["41", "ARC"], ["42", "ARC"],
  ]);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restoredContainer = await deserializeKDraw(kdrawBytes);
  expect(restoredContainer.manifest.documentPath).toBe("document.json");
  expect(restoredContainer.manifest.entries).toHaveLength(1);
  expect(restoredContainer.attachments.size).toBe(0);
  const restored = restoredContainer.document;
  expect(restored.entities).toEqual(committed.entities);

  expect(consoleErrors).toEqual([]);
  await capture("F-024-browser-parametric-source.dxf", sourceDxfBytes);
  await capture("F-024-browser-parametric.dxf", dxfBytes);
  await capture("F-024-browser-parametric.kdraw", kdrawBytes);
  await capture("F-024-browser-parametric.json", { rowId: "F-024", source, committed, operation, consoleErrors, status: "PASS" });
});

test("F-024 browser evidence matches AutoCAD RAY/XLINE Trim, No Trim and exact DXF records", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-29T22:00:00.000Z" });
  const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.5 };
  source.entities = [
    { kind: "ray", handle: "10", layerId: "0", appearance, basePoint: { x: 0, y: 4600 }, direction: { x: 4, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", appearance, start: { x: 100, y: 4600 }, end: { x: 100, y: 4700 } },
    { kind: "xline", handle: "20", layerId: "0", appearance, basePoint: { x: 0, y: 4800 }, direction: { x: 4, y: 0 } },
    { kind: "line", handle: "21", layerId: "0", appearance, start: { x: 100, y: 4800 }, end: { x: 100, y: 4900 } },
    { kind: "ray", handle: "30", layerId: "0", appearance, basePoint: { x: 0, y: 5000 }, direction: { x: 4, y: 0 } },
    { kind: "line", handle: "31", layerId: "0", appearance, start: { x: 100, y: 5000 }, end: { x: 100, y: 5100 } },
    { kind: "xline", handle: "40", layerId: "0", appearance, basePoint: { x: 0, y: 5200 }, direction: { x: 4, y: 0 } },
    { kind: "line", handle: "41", layerId: "0", appearance, start: { x: 100, y: 5200 }, end: { x: 100, y: 5300 } },
    { kind: "ray", handle: "50", layerId: "0", appearance, basePoint: { x: 0, y: 5400 }, direction: { x: 4, y: 0 } },
    { kind: "xline", handle: "51", layerId: "0", appearance, basePoint: { x: 100, y: 5400 }, direction: { x: 0, y: 3 } },
  ];
  await seedLocalDocument(page, source);

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const sourceDxfBytes = await readFile(path!);
  const sourceDxfText = sourceDxfBytes.toString("utf8");
  expect(dxfRecordPairs(sourceDxfText, "RAY", "10")).toEqual(expect.arrayContaining([[10, "0"], [20, "4600"], [11, "4"], [21, "0"], [62, "1"], [370, "50"]]));
  expect(dxfRecordPairs(sourceDxfText, "XLINE", "20")).toEqual(expect.arrayContaining([[10, "0"], [20, "4800"], [11, "4"], [21, "0"], [62, "1"], [370, "50"]]));

  await page.getByLabel("FILLET režiim").selectOption("pairs");
  await page.getByLabel("FILLET radius").fill("10");
  await page.getByLabel("FILLET Trim").selectOption("trim");
  await page.getByLabel("FILLET paarid").fill("10@80,4600>11@100,4650; 20@80,4800>21@100,4850; 50@80,5400>51@100,5450");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 9 tulemust · 3 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();

  await page.getByLabel("FILLET Trim").selectOption("no-trim");
  await page.getByLabel("FILLET paarid").fill("30@80,5000>31@100,5050; 40@80,5200>41@100,5250");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 2 tulemust · 2 sammu");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();

  const committed = await readDocument(page);
  expect(committed.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 0, y: 4600 }, end: { x: 90, y: 4600 }, appearance });
  expect(committed.entities.find((entity) => entity.handle === "20")).toMatchObject({ kind: "ray", basePoint: { x: 90, y: 4800 }, direction: { x: -1, y: 0 }, appearance });
  expect(committed.entities.find((entity) => entity.handle === "21")).toMatchObject({ kind: "line", start: { x: 100, y: 4810 }, end: { x: 100, y: 4900 }, appearance });
  expect(committed.entities.find((entity) => entity.handle === "30")).toEqual(source.entities.find((entity) => entity.handle === "30"));
  expect(committed.entities.find((entity) => entity.handle === "40")).toEqual(source.entities.find((entity) => entity.handle === "40"));
  expect(committed.entities.find((entity) => entity.handle === "50")).toMatchObject({ kind: "line", start: { x: 0, y: 5400 }, end: { x: 90, y: 5400 }, appearance });
  expect(committed.entities.find((entity) => entity.handle === "51")).toMatchObject({ kind: "ray", basePoint: { x: 100, y: 5410 }, direction: { x: 0, y: 1 }, appearance });
  expect(["52", "53", "54", "55", "56"].map((handle) => committed.entities.find((entity) => entity.handle === handle))).toMatchObject([
    { kind: "arc", center: { x: 90, y: 4610 }, radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } },
    { kind: "arc", center: { x: 90, y: 4810 }, radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } },
    { kind: "arc", center: { x: 90, y: 5410 }, radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } },
    { kind: "arc", center: { x: 90, y: 5010 }, radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } },
    { kind: "arc", center: { x: 90, y: 5210 }, radius: 10, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } },
  ]);
  const operations = await readOperations(page);
  expect(operations).toMatchObject([
    { commandId: "FILLET", targetHandles: ["10", "11", "20", "21", "50", "51"], resultHandles: ["10", "11", "52", "20", "21", "53", "50", "51", "54"], args: { trimMode: "trim" } },
    { commandId: "FILLET", targetHandles: ["30", "31", "40", "41"], resultHandles: ["55", "56"], args: { trimMode: "no-trim" } },
  ]);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const dxfText = dxfBytes.toString("utf8");
  expect(dxfRecordPairs(dxfText, "RAY", "30")).toEqual(expect.arrayContaining([[10, "0"], [20, "5000"], [11, "4"], [21, "0"], [62, "1"], [370, "50"]]));
  expect(dxfRecordPairs(dxfText, "XLINE", "40")).toEqual(expect.arrayContaining([[10, "0"], [20, "5200"], [11, "4"], [21, "0"], [62, "1"], [370, "50"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "20")).toEqual(expect.arrayContaining([[10, "90"], [20, "4800"], [11, "-1"], [21, "0"], [62, "1"], [370, "50"]]));
  expect(dxfRecordPairs(dxfText, "RAY", "51")).toEqual(expect.arrayContaining([[10, "100"], [20, "5410"], [11, "0"], [21, "1"], [62, "1"], [370, "50"]]));
  for (const handle of ["52", "53", "54", "55", "56"]) {
    expect(dxfRecordPairs(dxfText, "ARC", handle)).toEqual(expect.arrayContaining([[62, "1"]]));
    expect(dxfRecordPairs(dxfText, "ARC", handle).some(([code]) => code === 370)).toBe(false);
  }

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restoredContainer = await deserializeKDraw(kdrawBytes);
  expect(restoredContainer.manifest.documentPath).toBe("document.json");
  expect(restoredContainer.manifest.entries).toHaveLength(1);
  expect(restoredContainer.attachments.size).toBe(0);
  const restored = restoredContainer.document;
  expect(restored.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);

  await capture("F-024-browser-construction-source.dxf", sourceDxfBytes);
  await capture("F-024-browser-construction.dxf", dxfBytes);
  await capture("F-024-browser-construction.kdraw", kdrawBytes);
  await capture("F-024-browser-construction.json", { rowId: "F-024", source, committed, operations, consoleErrors, status: "PASS" });
});

test("F-024 browser evidence joins polyline+line and preserves exact DXF/KDRAW1 output", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const source = createEmptyDocument({ documentId: "local", now: "2026-08-29T17:30:00.000Z" });
  source.entities = [
    { kind: "polyline", handle: "10", layerId: "0", closed: false, appearance: { color: "#ff0000", lineweightMm: 0.5 }, extensionData: { rowId: "F-024" }, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }] },
    { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    { kind: "polyline", handle: "50", layerId: "0", closed: false, vertices: [{ x: 600, y: 1400 }, { x: 700, y: 1400, bulge: Math.tan(Math.PI / 8) }, { x: 760, y: 1460 }, { x: 760, y: 1540 }, { x: 660, y: 1540 }] },
  ];
  await seedLocalDocument(page, source);

  await page.getByLabel("FILLET režiim").selectOption("pairs");
  await page.getByLabel("FILLET radius").fill("10");
  await page.getByLabel("FILLET Trim").selectOption("trim");
  await page.getByLabel("FILLET paarid").fill("10#0@80,0>20@100,20");
  await expect(page.getByTestId("fillet-preview")).toHaveText("FILLET eelvaade: 1 tulemust · 1 sammu");
  await expect(page.getByTestId("fillet-preview")).toHaveAttribute("data-hidden-source-count", "2");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const joined = await readDocument(page);
  expect(joined.entities).toMatchObject([
    { kind: "polyline", handle: "10", vertices: [
      { x: 0, y: 0, startWidth: 2, endWidth: 3.8 },
      { x: 90, y: 0, bulge: 0.414213562373, startWidth: 3.8, endWidth: 3.8 },
      { x: 100, y: 10, startWidth: 3.8, endWidth: 3.8 },
      { x: 100, y: 100, startWidth: 3.8, endWidth: 3.8 },
    ] },
    { kind: "polyline", handle: "50" },
  ]);

  await page.getByLabel("FILLET režiim").selectOption("polyline");
  await page.getByLabel("FILLET Trim").selectOption("no-trim");
  await page.getByLabel("FILLETPOLYARC").selectOption("0");
  await page.getByLabel("FILLET Polyline handle'id").fill("50");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  const committed = await readDocument(page);
  expect(committed.entities.slice(-2)).toMatchObject([{ kind: "arc", handle: "51", radius: 10 }, { kind: "arc", handle: "52", radius: 10 }]);
  const operations = await readOperations(page);
  expect(operations).toMatchObject([
    { commandId: "FILLET", targetHandles: ["10", "20"], resultHandles: ["10"], args: { mode: "pairs", trimMode: "trim" } },
    { commandId: "FILLET", targetHandles: ["50"], resultHandles: ["51", "52"], args: { mode: "polyline", trimMode: "no-trim", filletPolylineArc: 0 } },
  ]);

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  let path = await (await download).path();
  const dxfBytes = await readFile(path!);
  const parsed = new DxfParser().parseSync(dxfBytes.toString("utf8"));
  expect(parsed?.entities.map((entity) => [entity.handle, entity.type])).toEqual([["10", "LWPOLYLINE"], ["50", "LWPOLYLINE"], ["51", "ARC"], ["52", "ARC"]]);

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  path = await (await download).path();
  const kdrawBytes = await readFile(path!);
  const restoredContainer = await deserializeKDraw(kdrawBytes);
  expect(restoredContainer.manifest.documentPath).toBe("document.json");
  expect(restoredContainer.manifest.entries).toHaveLength(1);
  expect(restoredContainer.attachments.size).toBe(0);
  const restored = restoredContainer.document;
  expect(restored.entities).toEqual(committed.entities);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).entities).toEqual(joined.entities);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  const undoRestored = await readDocument(page);
  expect(undoRestored.entities).toEqual(source.entities);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  const redone = await readDocument(page);
  expect(redone.entities).toEqual(committed.entities);
  expect(consoleErrors).toEqual([]);

  await capture("F-024-browser.dxf", dxfBytes);
  await capture("F-024-browser.kdraw", kdrawBytes);
  await capture("F-024-browser-matrix.json", { rowId: "F-024", source, joined, committed, operations, restored, undoRestored, redone, consoleErrors, status: "PASS" });
});
