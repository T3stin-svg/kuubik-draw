import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { openLayoutTools } from "./helpers/layout-tools.js";

type RecordedOperation = { commandId: string; baseRevision: number };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function lockedViewportDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
  document.layouts.push({
    id: "layout-f101",
    name: "F101 LOCK",
    kind: "paper",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [{
      id: "viewport-f101", center: { x: 210, y: 148.5 }, width: 400, height: 277,
      viewCenter: { x: 400, y: 200 }, viewHeight: 1385, twistAngleRad: 0, locked: false,
    }],
    entities: [],
  });
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
  }, document);
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
    const value = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return value as KDrawDocumentV1;
  });
}

async function readOperations(page: Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const values = await new Promise<Array<{ revision: number; operation: RecordedOperation }>>((resolveRead, rejectRead) => {
      const request = database.transaction("operations", "readonly").objectStore("operations").getAll();
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return values.sort((a, b) => a.revision - b.revision).map((entry) => entry.operation);
  });
}

async function viewportState(viewport: Locator) {
  return viewport.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      center: data.viewCenter,
      viewHeight: Number(data.viewHeight),
      scaleDenominator: Number(data.scaleDenominator),
      locked: data.displayLocked === "true",
      navigationEnabled: data.navigationEnabled === "true",
      spaceContext: data.spaceContext,
    };
  });
}

async function downloadKDraw(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "KDraw eksport" }).click();
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const text = bytes.toString("utf8");
  expect(text.startsWith("KDRAW1\n")).toBe(true);
  const envelope = JSON.parse(text.slice("KDRAW1\n".length)) as {
    manifest: { entries: Array<{ path: string; byteLength: number; sha256: string }> };
    files: Record<string, string>;
  };
  const documentBytes = Buffer.from(envelope.files["document.json"]!, "base64");
  const entry = envelope.manifest.entries.find((candidate) => candidate.path === "document.json")!;
  expect(documentBytes.byteLength).toBe(entry.byteLength);
  expect(createHash("sha256").update(documentBytes).digest("hex")).toBe(entry.sha256);
  if (process.env.PARITY_CAPTURE_DIR) await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-101-browser-viewport-lock.kdraw"), bytes);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    document: JSON.parse(documentBytes.toString("utf8")) as KDrawDocumentV1,
  };
}

test("F-101 locks navigation, permits model editing, unlocks/relocks atomically and survives reload", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, lockedViewportDocument());
  await page.getByRole("button", { name: "F101 LOCK", exact: true }).click();
  const viewport = page.locator('[data-viewport-id="viewport-f101"]');
  await viewport.dblclick();
  await expect(viewport).toHaveAttribute("data-space-context", "model");
  await expect(viewport).toHaveAttribute("data-navigation-enabled", "true");
  const initial = await viewportState(viewport);

  await openLayoutTools(page);
  await page.getByRole("button", { name: "Lukusta viewport" }).click();
  await expect(viewport).toHaveAttribute("data-display-locked", "true");
  await expect(viewport).toHaveAttribute("data-navigation-enabled", "false");
  await expect(page.getByTestId("viewport-lock-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(viewport.locator(".paper-space-viewport-label")).toContainText("🔒");
  const locked = await viewportState(viewport);
  expect(locked).toMatchObject({ ...initial, locked: true, navigationEnabled: false });
  await page.getByLabel("Layout tools").click();

  const canvas = viewport.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const pointer = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(1);
  const afterLockedWheel = await viewportState(viewport);
  expect(afterLockedWheel).toEqual(locked);
  await page.mouse.down();
  await page.mouse.move(pointer.x + 80, pointer.y - 50, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(1);
  const afterLockedPan = await viewportState(viewport);
  expect(afterLockedPan).toEqual(locked);

  await openLayoutTools(page);
  await page.getByLabel("Viewport mõõtkava nimetaja").fill("25");
  await page.getByLabel("Viewport keskme X").fill("700");
  await page.getByLabel("Viewport keskme Y").fill("350");
  await page.getByLabel("Viewport pöördenurk").fill("15");
  const applyView = page.getByRole("button", { name: "Rakenda viewport vaade" });
  await expect(applyView).toBeDisabled();
  await applyView.evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => (await readDocument(page)).revision).toBe(1);
  const afterLockedDirect = await viewportState(viewport);
  expect(afterLockedDirect).toEqual(locked);

  await page.getByRole("button", { name: "LINE test" }).click();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(2);
  const afterLockedEdit = await readDocument(page);
  expect(afterLockedEdit.entities).toHaveLength(2);
  expect(await viewportState(viewport)).toEqual(locked);

  await page.getByRole("button", { name: "Ava viewport" }).click();
  await expect(viewport).toHaveAttribute("data-display-locked", "false");
  await expect(viewport).toHaveAttribute("data-navigation-enabled", "true");
  await page.getByLabel("Layout tools").click();
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await readDocument(page)).revision).toBe(4);
  const zoomed = await viewportState(viewport);
  expect(zoomed.scaleDenominator).toBeCloseTo(initial.scaleDenominator / 1.1, 12);
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down();
  await page.mouse.move(pointer.x + 80, pointer.y - 50, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(5);
  const panned = await viewportState(viewport);
  expect(panned.center).not.toBe(zoomed.center);
  expect(panned.scaleDenominator).toBeCloseTo(zoomed.scaleDenominator, 12);

  await openLayoutTools(page);
  await page.getByRole("button", { name: "Lukusta viewport" }).click();
  await expect(viewport).toHaveAttribute("data-display-locked", "true");
  const relocked = await viewportState(viewport);
  await page.getByLabel("Layout tools").click();
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, 120);
  await page.mouse.down();
  await page.mouse.move(pointer.x - 60, pointer.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).revision).toBe(6);
  expect(await viewportState(viewport)).toEqual(relocked);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-display-locked", "false");
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-display-locked", "true");
  const finalState = await viewportState(viewport);
  expect(finalState).toEqual(relocked);

  const exported = await downloadKDraw(page);
  const exportedViewport = exported.document.layouts[1]!.viewports[0]!;
  expect(exportedViewport).toMatchObject({ id: "viewport-f101", locked: true, viewCenter: { x: Number(panned.center!.split(",")[0]), y: Number(panned.center!.split(",")[1]) } });
  const stored = await readDocument(page);
  expect(stored.revision).toBe(8);
  expect(stored.entities).toHaveLength(2);
  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual([
    "VIEWPORT_LOCK", "LINE", "VIEWPORT_LOCK", "VIEWPORT_ZOOM", "VIEWPORT_PAN", "VIEWPORT_LOCK", "UNDO", "VIEWPORT_LOCK",
  ]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 8")).toBeVisible();
  await page.getByRole("button", { name: "F101 LOCK", exact: true }).click();
  const restoredViewport = page.locator('[data-viewport-id="viewport-f101"]');
  await expect(restoredViewport).toHaveAttribute("data-display-locked", "true");
  expect(await viewportState(restoredViewport)).toMatchObject({ ...finalState, spaceContext: "paper", navigationEnabled: false });
  await restoredViewport.dblclick();
  await expect(restoredViewport).toHaveAttribute("data-space-context", "model");
  await expect(restoredViewport).toHaveAttribute("data-navigation-enabled", "false");
  await expect(page.getByRole("button", { name: "LINE test" })).toBeEnabled();
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-101-browser-viewport-lock.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-101",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      action: "MODEL -> lock -> refused wheel/pan/direct scale-center-twist Apply -> model LINE -> unlock -> wheel/pan -> relock -> refused wheel/pan -> undo/redo -> KDRAW1 -> reload",
      initial, locked, afterLockedWheel, afterLockedPan, afterLockedDirect,
      afterLockedEdit: { revision: afterLockedEdit.revision, entityCount: afterLockedEdit.entities.length },
      zoomed, panned, relocked, restored: await viewportState(restoredViewport),
      document: { revision: stored.revision, entityCount: stored.entities.length, viewport: stored.layouts[1]!.viewports[0] },
      operations,
      exported: { bytes: exported.bytes.byteLength, sha256: exported.sha256 },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
