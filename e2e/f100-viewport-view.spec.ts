import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { openLayoutTools } from "./helpers/layout-tools.js";

type RecordedOperation = { opId: string; commandId: string; baseRevision: number };
type ViewState = {
  center: { x: number; y: number };
  viewHeight: number;
  frameWidth: number;
  frameHeight: number;
  scaleDenominator: number;
  twistAngleRad: number;
  scaleLabel: string;
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function viewportDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00.000Z" });
  document.entities.push({
    kind: "line",
    handle: "10",
    layerId: "0",
    start: { x: -2000, y: -500 },
    end: { x: 4000, y: -500 },
    appearance: { color: "#102a43", lineweightMm: 2 },
  });
  const marker = modelAtNormalized({
    center: { x: 1000, y: -500 }, viewHeight: 5540, frameWidth: 400, frameHeight: 277,
    scaleDenominator: 20, twistAngleRad: Math.PI / 6, scaleLabel: "1:20",
  }, { x: -0.28, y: 0.15 });
  document.entities.push({
    kind: "circle", handle: "11", layerId: "0", center: marker, radius: 80,
    appearance: { color: "#ff0033", lineweightMm: 2 },
  });
  document.layouts.push({
    id: "layout-f100",
    name: "F100 VIEW",
    kind: "paper",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    viewports: [{
      id: "viewport-f100",
      center: { x: 210, y: 148.5 },
      width: 400,
      height: 277,
      viewCenter: { x: 0, y: 0 },
      viewHeight: 13850,
      twistAngleRad: 0,
      locked: false,
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
    return values.sort((a, b) => a.revision - b.revision).map((value) => value.operation);
  });
}

async function viewState(viewport: Locator): Promise<ViewState> {
  return viewport.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    const [x, y] = data.viewCenter!.split(",").map(Number);
    return {
      center: { x: x!, y: y! },
      viewHeight: Number(data.viewHeight),
      frameWidth: Number(data.frameWidth),
      frameHeight: Number(data.frameHeight),
      scaleDenominator: Number(data.scaleDenominator),
      twistAngleRad: Number(data.twistAngleRad),
      scaleLabel: data.scaleLabel!,
    };
  });
}

function modelAtNormalized(state: ViewState, normalized: { x: number; y: number }) {
  const viewWidth = state.viewHeight * (state.frameWidth / state.frameHeight);
  const localX = normalized.x * viewWidth;
  const localY = normalized.y * state.viewHeight;
  const cosine = Math.cos(-state.twistAngleRad);
  const sine = Math.sin(-state.twistAngleRad);
  return {
    x: state.center.x + localX * cosine - localY * sine,
    y: state.center.y + localX * sine + localY * cosine,
  };
}

function modelAtCanvasPoint(state: ViewState, canvasBox: { x: number; y: number; width: number; height: number }, screen: { x: number; y: number }) {
  const viewWidth = state.viewHeight * (state.frameWidth / state.frameHeight);
  const pixelsPerModelUnit = Math.min(canvasBox.width / viewWidth, canvasBox.height / state.viewHeight);
  const localX = (screen.x - (canvasBox.x + canvasBox.width / 2)) / pixelsPerModelUnit;
  const localY = -(screen.y - (canvasBox.y + canvasBox.height / 2)) / pixelsPerModelUnit;
  const cosine = Math.cos(-state.twistAngleRad);
  const sine = Math.sin(-state.twistAngleRad);
  return {
    x: state.center.x + localX * cosine - localY * sine,
    y: state.center.y + localX * sine + localY * cosine,
  };
}

function normalizedAtModel(state: ViewState, model: { x: number; y: number }) {
  const dx = model.x - state.center.x;
  const dy = model.y - state.center.y;
  const cosine = Math.cos(state.twistAngleRad);
  const sine = Math.sin(state.twistAngleRad);
  return {
    x: (dx * cosine - dy * sine) / (state.viewHeight * (state.frameWidth / state.frameHeight)),
    y: (dx * sine + dy * cosine) / state.viewHeight,
  };
}

async function redMarkerScreen(viewport: Locator) {
  return viewport.locator("canvas").evaluate((canvasElement) => {
    const canvas = canvasElement as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset]! > 180 && data[offset + 1]! < 120 && data[offset + 2]! < 150 && data[offset + 3]! > 0) points.push({ x, y });
      }
    }
    if (points.length < 8) throw new Error(`F-100 red marker was not painted: ${points.length} pixels.`);
    const pixelX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const pixelY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    return {
      count: points.length,
      x: rect.left + pixelX * (rect.width / canvas.width),
      y: rect.top + pixelY * (rect.height / canvas.height),
      canvas: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    };
  });
}

async function paintedSlope(viewport: Locator) {
  return viewport.locator("canvas").evaluate((canvasElement) => {
    const canvas = canvasElement as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset]! < 100 && data[offset + 1]! < 130 && data[offset + 2]! < 160 && data[offset + 3]! > 0) points.push({ x, y });
      }
    }
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
    const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    return { paintedPixels: points.length, slope: covariance / varianceX };
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
  if (process.env.PARITY_CAPTURE_DIR) await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-100-browser-viewport-view.kdraw"), bytes);
  return {
    bytes,
    document: JSON.parse(documentBytes.toString("utf8")) as KDrawDocumentV1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("F-100 applies preset/custom scale, cursor-anchor zoom, rotated pan/twist, atomic undo and reload", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-28T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, viewportDocument());
  await page.getByRole("button", { name: "F100 VIEW", exact: true }).click();
  const viewport = page.locator('[data-viewport-id="viewport-f100"]');
  await expect(viewport).toHaveCount(1);
  await viewport.dblclick();
  await expect(viewport).toHaveAttribute("data-space-context", "model");
  await expect(viewport).toHaveAttribute("data-navigation-enabled", "true");
  await openLayoutTools(page);

  await page.getByLabel("Viewport standardmõõtkava").selectOption("20");
  await expect(page.getByLabel("Viewport mõõtkava nimetaja")).toHaveValue("20");
  await page.getByLabel("Viewport keskme X").fill("1000");
  await page.getByLabel("Viewport keskme Y").fill("-500");
  await page.getByLabel("Viewport pöördenurk").fill("30");
  await page.getByRole("button", { name: "Rakenda viewport vaade" }).click();
  await page.getByLabel("Layout tools").click();
  await expect(viewport).toHaveAttribute("data-scale-label", "1:20");
  const preset = await viewState(viewport);
  expect(preset).toMatchObject({ center: { x: 1000, y: -500 }, scaleDenominator: 20, scaleLabel: "1:20" });
  expect(preset.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
  const presetPixels = await paintedSlope(viewport);
  expect(presetPixels.paintedPixels).toBeGreaterThan(100);
  expect(presetPixels.slope).toBeLessThan(-0.45);
  expect(presetPixels.slope).toBeGreaterThan(-0.7);

  const outerBox = await viewport.boundingBox();
  const markerBefore = await redMarkerScreen(viewport);
  expect(outerBox).not.toBeNull();
  expect(outerBox!.width - markerBefore.canvas.width).toBeCloseTo(2, 1);
  expect(outerBox!.height - markerBefore.canvas.height).toBeCloseTo(2, 1);
  const cursor = { x: Math.round(markerBefore.x), y: Math.round(markerBefore.y) };
  const anchorBefore = modelAtCanvasPoint(preset, markerBefore.canvas, cursor);
  const normalizedCursor = normalizedAtModel(preset, anchorBefore);
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -120);
  await expect(viewport).toHaveAttribute("data-scale-label", "1:18.182 (Custom)");
  const zoomed = await viewState(viewport);
  expect(zoomed.scaleDenominator).toBeCloseTo(18.18181818181818, 12);
  expect(zoomed.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
  const markerAfter = await redMarkerScreen(viewport);
  const anchorAfter = modelAtCanvasPoint(zoomed, markerAfter.canvas, cursor);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 9);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 9);
  expect(markerAfter.x).toBeCloseTo(markerBefore.x, 0);
  expect(markerAfter.y).toBeCloseTo(markerBefore.y, 0);

  const panStart = { x: markerAfter.canvas.x + markerAfter.canvas.width * 0.5, y: markerAfter.canvas.y + markerAfter.canvas.height * 0.5 };
  const panDelta = { x: 80, y: -50 };
  const viewWidth = zoomed.viewHeight * (zoomed.frameWidth / zoomed.frameHeight);
  const pixelsPerModelUnit = Math.min(markerAfter.canvas.width / viewWidth, markerAfter.canvas.height / zoomed.viewHeight);
  const localPan = { x: -panDelta.x / pixelsPerModelUnit, y: panDelta.y / pixelsPerModelUnit };
  const expectedPannedCenter = {
    x: zoomed.center.x + localPan.x * Math.cos(-zoomed.twistAngleRad) - localPan.y * Math.sin(-zoomed.twistAngleRad),
    y: zoomed.center.y + localPan.x * Math.sin(-zoomed.twistAngleRad) + localPan.y * Math.cos(-zoomed.twistAngleRad),
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + panDelta.x, panStart.y + panDelta.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await viewState(viewport)).center.x).not.toBe(zoomed.center.x);
  const panned = await viewState(viewport);
  expect(panned.center.x).toBeCloseTo(expectedPannedCenter.x, 9);
  expect(panned.center.y).toBeCloseTo(expectedPannedCenter.y, 9);
  expect(panned.scaleDenominator).toBeCloseTo(zoomed.scaleDenominator, 12);
  expect(panned.twistAngleRad).toBeCloseTo(zoomed.twistAngleRad, 12);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await viewState(viewport)).center.x).toBeCloseTo(zoomed.center.x, 9);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect.poll(async () => (await viewState(viewport)).center.x).toBeCloseTo(panned.center.x, 9);

  const exported = await downloadKDraw(page);
  const exportedViewport = exported.document.layouts[1]!.viewports[0]!;
  expect(exportedViewport).toMatchObject({ id: "viewport-f100", viewCenter: panned.center });
  expect(exportedViewport.viewHeight / exportedViewport.height).toBeCloseTo(panned.scaleDenominator, 12);
  expect(exportedViewport.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
  const stored = await readDocument(page);
  expect(stored.revision).toBe(5);
  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual(["VIEWPORT_VIEW", "VIEWPORT_ZOOM", "VIEWPORT_PAN", "UNDO", "VIEWPORT_PAN"]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();
  await page.getByRole("button", { name: "F100 VIEW", exact: true }).click();
  const restoredViewport = page.locator('[data-viewport-id="viewport-f100"]');
  const restored = await viewState(restoredViewport);
  expect(restored.center.x).toBeCloseTo(panned.center.x, 9);
  expect(restored.center.y).toBeCloseTo(panned.center.y, 9);
  expect(restored.scaleDenominator).toBeCloseTo(panned.scaleDenominator, 12);
  expect(restored.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
  expect((await paintedSlope(restoredViewport)).slope).toBeLessThan(-0.45);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-100-browser-viewport-view.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-100",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      action: "PAPER -> MODEL -> 1:20 + center + 30deg twist -> cursor-anchor wheel zoom -> rotated pointer pan -> undo/redo -> KDRAW1 -> reload",
      preset,
      presetPixels,
      cursorZoom: {
        normalizedCursor, anchorBefore, zoomed, anchorAfter,
        delta: { x: anchorAfter.x - anchorBefore.x, y: anchorAfter.y - anchorBefore.y },
        markerBefore, markerAfter,
        markerPixelDelta: { x: markerAfter.x - markerBefore.x, y: markerAfter.y - markerBefore.y },
      },
      pan: { deltaPx: panDelta, canvas: markerAfter.canvas, expectedCenter: expectedPannedCenter },
      panned,
      restored,
      document: { revision: stored.revision, viewport: stored.layouts[1]!.viewports[0] },
      operations,
      exported: { bytes: exported.bytes.byteLength, sha256: exported.sha256 },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
