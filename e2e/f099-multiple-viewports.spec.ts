import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

type RecordedOperation = { opId: string; commandId: string; baseRevision: number };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function viewportDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.entities.push(
    { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 220, appearance: { color: "#102a43", lineweightMm: 2 } },
    { kind: "circle", handle: "11", layerId: "0", center: { x: 2000, y: 0 }, radius: 220, appearance: { color: "#b42318", lineweightMm: 2 } },
  );
  document.layouts.push({
    id: "layout-f099",
    name: "F099 VIEWPORTS",
    kind: "paper",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [],
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
    return values.sort((a, b) => a.revision - b.revision).map((value) => value.operation);
  });
}

async function viewportMetrics(page: Page) {
  return page.locator('[data-testid="paper-space-viewport"]').evaluateAll((elements) => elements.map((element) => {
    const viewport = element as HTMLElement;
    const canvas = viewport.querySelector("canvas")!;
    const box = viewport.getBoundingClientRect();
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) paintedPixels += 1;
    return {
      id: viewport.dataset.viewportId,
      kind: viewport.dataset.viewportKind,
      context: viewport.dataset.spaceContext,
      viewCenter: viewport.dataset.viewCenter,
      viewHeight: Number(viewport.dataset.viewHeight),
      frame: { x: box.x, y: box.y, width: box.width, height: box.height },
      clipPath: getComputedStyle(viewport).clipPath,
      canvas: { width: canvas.width, height: canvas.height, paintedPixels },
    };
  }));
}

async function downloadKDraw(page: Page): Promise<{ document: KDrawDocumentV1; sha256: string; bytes: Buffer }> {
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
  if (process.env.PARITY_CAPTURE_DIR) await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-099-browser-multiple-viewports.kdraw"), bytes);
  return { document: JSON.parse(documentBytes.toString("utf8")) as KDrawDocumentV1, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

test("F-099 creates independent rectangular and non-rectangular viewports, survives MODEL-context deletion, undo and reload", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, viewportDocument());
  await page.getByRole("button", { name: "F099 VIEWPORTS", exact: true }).click();

  await page.getByRole("button", { name: "Lisa ristkülikviewport" }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Lisa polügoonviewport" }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(2);
  const created = await viewportMetrics(page);
  expect(created.map(({ id, kind, viewCenter, viewHeight }) => ({ id, kind, viewCenter, viewHeight }))).toEqual([
    { id: "viewport-1", kind: "rectangle", viewCenter: "0,0", viewHeight: 1200 },
    { id: "viewport-2", kind: "polygon", viewCenter: "2000,0", viewHeight: 1200 },
  ]);
  expect(created[0]!.frame.x + created[0]!.frame.width).toBeLessThan(created[1]!.frame.x);
  expect(created[0]!.canvas.paintedPixels).toBeGreaterThan(50);
  expect(created[1]!.canvas.paintedPixels).toBeGreaterThan(50);
  expect(created[0]!.clipPath).toBe("none");
  expect(created[1]!.clipPath).toContain("polygon(");

  let stored = await readDocument(page);
  expect(stored.layouts[1]!.viewports.map((viewport) => ({
    id: viewport.id,
    viewCenter: viewport.viewCenter,
    clipped: viewport.clipBoundary?.length ?? 0,
  }))).toEqual([
    { id: "viewport-1", viewCenter: { x: 0, y: 0 }, clipped: 0 },
    { id: "viewport-2", viewCenter: { x: 2000, y: 0 }, clipped: 6 },
  ]);

  await page.locator('[data-viewport-id="viewport-2"]').dblclick();
  await expect(page.locator('[data-viewport-id="viewport-2"]')).toHaveAttribute("data-space-context", "model");
  await expect(page.getByText("MODEL · mm · SNAP")).toBeVisible();
  await page.locator('[data-testid="paper-space-sheet"]').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('[data-viewport-id="viewport-2"]')).toHaveAttribute("data-space-context", "paper");
  await expect(page.getByText("PAPER · mm · SNAP")).toBeVisible();
  await page.locator('[data-viewport-id="viewport-2"]').dblclick();
  await expect(page.locator('[data-viewport-id="viewport-2"]')).toHaveAttribute("data-space-context", "model");
  await page.getByRole("button", { name: "Kustuta viewport" }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(1);
  await expect(page.getByText("PAPER · mm · SNAP")).toBeVisible();
  expect((await readDocument(page)).layouts[1]!.viewports.map((viewport) => viewport.id)).toEqual(["viewport-1"]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(2);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(1);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(2);

  const exported = await downloadKDraw(page);
  expect(exported.document.layouts[1]!.viewports.map((viewport) => viewport.id)).toEqual(["viewport-1", "viewport-2"]);
  stored = await readDocument(page);
  expect(stored.revision).toBe(6);
  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual([
    "VIEWPORT_CREATE", "VIEWPORT_CREATE", "VIEWPORT_DELETE", "UNDO", "VIEWPORT_DELETE", "UNDO",
  ]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4, 5]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 6")).toBeVisible();
  await page.getByRole("button", { name: "F099 VIEWPORTS", exact: true }).click();
  await expect(page.locator('[data-testid="paper-space-viewport"]')).toHaveCount(2);
  const restored = await viewportMetrics(page);
  expect(restored.map(({ id, kind, viewCenter }) => ({ id, kind, viewCenter }))).toEqual([
    { id: "viewport-1", kind: "rectangle", viewCenter: "0,0" },
    { id: "viewport-2", kind: "polygon", viewCenter: "2000,0" },
  ]);
  expect(restored.every((viewport) => viewport.canvas.paintedPixels > 50)).toBe(true);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-099-browser-multiple-viewports.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-099",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      action: "PAPER -> rectangular MVIEW -> polygon-clipped MVIEW -> independent cameras -> viewport MODEL -> delete -> PAPER -> undo/redo/undo -> KDRAW1 -> reload",
      created,
      afterModelContextDelete: { viewportIds: ["viewport-1"], space: "PAPER" },
      restored,
      document: { revision: stored.revision, layout: stored.layouts[1] },
      operations,
      exported: { bytes: exported.bytes.byteLength, sha256: exported.sha256 },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
