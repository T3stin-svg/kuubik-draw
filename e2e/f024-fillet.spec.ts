import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

type RecordedOperation = { commandId: string; targetHandles: string[]; resultHandles: string[]; args: Record<string, unknown> };

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

test("F-024 FILLET reports locked and hidden layer refusals without mutation", async ({ page }) => {
  const document = pairDocument();
  document.layers.push(
    { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
  );
  document.entities[0] = { ...document.entities[0]!, layerId: "locked" };
  document.entities[2] = { ...document.entities[2]!, layerId: "hidden" };
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  await page.getByLabel("FILLET paarid").fill("10@-500,0>20@0,500; 30@1500,0>40@1000,500");
  await page.getByRole("button", { name: "FILLET", exact: true }).click();
  await expect(page.getByTestId("fillet-rejected")).toContainText("10+20#1 (locked-layer)");
  await expect(page.getByTestId("fillet-rejected")).toContainText("30+40#2 (hidden-layer)");
  expect((await readDocument(page)).entities).toEqual(document.entities);
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
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const screenPoint = (x: number, y: number) => ({
    x: box!.x + box!.width / 2 + (x - 1000) * pixelsPerWorldUnit,
    y: box!.y + box!.height / 2 - (y - 1000) * pixelsPerWorldUnit,
  });
  const first = screenPoint(500, 1000);
  const second = screenPoint(1000, 1500);
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

test("F-024 FILLET Shift on the second canvas pick uses radius zero once and preserves stored Radius", async ({ page }) => {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-29T16:10:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 900, y: 1000 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 1000, y: 1100 }, end: { x: 1000, y: 2000 } },
  ];
  await seedLocalDocument(page, document);
  await page.getByLabel("FILLET radius").fill("100");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pixelsPerWorldUnit = Math.min(box!.width / 3000, box!.height / 3000);
  const first = { x: box!.x + box!.width / 2 - 500 * pixelsPerWorldUnit, y: box!.y + box!.height / 2 };
  const second = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 - 500 * pixelsPerWorldUnit };
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
