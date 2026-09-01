import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createEmptyDocument } from "../packages/cad-core/src/index.js";
import { exportDxf, importDxf } from "../packages/cad-dxf/src/index.js";
import { createF106Document } from "../parity/fixtures/f106-document.js";
import { seedKDrawDocument } from "./helpers/indexed-db.js";
import { openLayoutTools } from "./helpers/layout-tools.js";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function answerLivePrompt(page: Page, field: string, value: string): Promise<void> {
  const prompt = page.getByTestId("live-command-prompt");
  await expect(prompt).toHaveAttribute("data-field", field);
  const control = prompt.locator("input, select");
  if (await prompt.getAttribute("data-kind") === "select") await control.selectOption(value);
  else await control.fill(value);
  await prompt.locator(".live-command-next").click();
}

async function readLocalDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result as KDrawDocumentV1);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document;
  });
}

test("Lite v1 runs one durable import-edit-layer-PDF-dimension-DXF-recovery workflow", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-09-01T12:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedKDrawDocument(page, createEmptyDocument({ documentId: "local", now: "2026-09-01T12:00:00.000Z" }));

  const shell = page.locator("main.app-shell");
  await expect(shell).toHaveAttribute("data-product-profile", "kuubik-draw-lite-v1");
  await expect(shell).toHaveAttribute("data-scope-size", "20");
  await expect(page.getByTestId("lite-profile-badge")).toHaveText("LITE V1 · 20 funktsiooni");

  for (const label of ["Line", "Polyline", "Circle", "Move", "Copy", "Offset", "Trim"]) {
    const tool = page.getByRole("button", { name: `Ribbon ${label} command` });
    await expect(tool).toHaveAttribute("data-scope-selected", "true");
    await expect(tool).toBeEnabled();
  }
  const unselectedRectangle = page.getByRole("button", { name: "Ribbon Rectangle unavailable" });
  await expect(unselectedRectangle).toBeDisabled();
  await expect(unselectedRectangle).toHaveAttribute("data-scope-selected", "false");
  await expect(unselectedRectangle).toHaveAttribute("data-state-reason", "Pole Lite v1 töövoos");
  await expect(unselectedRectangle).toHaveAttribute("title", /Pole Lite v1 töövoos/u);

  const sourceDocument = createF106Document("lite-v1-source");
  sourceDocument.metadata.title = "Kuubik Draw Lite v1";
  sourceDocument.textStyles = [{ id: "lite-text", name: "LITE_TEXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 }];
  sourceDocument.dimensionStyles = [{ id: "lite-dim", name: "LITE_DIM", textStyleId: "lite-text", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 }];
  const source = Buffer.from(exportDxf(sourceDocument).bytes);
  await page.getByLabel("DXF import").setInputFiles({
    name: "kuubik-draw-lite-v1-source.dxf",
    mimeType: "application/dxf",
    buffer: source,
  });
  await expect(page.getByText(/DXF imporditud: 3 objekti · \d+ kihti · mm/u)).toBeVisible();
  const importedDimensionStyleId = (await readLocalDocument(page)).dimensionStyles[0]?.id;
  expect(importedDimensionStyleId).toBeTruthy();

  const layerOperation = page.getByTestId("layer-operation-readback");
  await page.getByRole("button", { name: "Loo uus kiht" }).click();
  await expect(layerOperation).toContainText("LAYER_CREATE");
  const currentLayerName = page.getByRole("complementary", { name: "Properties palette" }).getByText("Current layer:").locator("strong");
  await expect(currentLayerName).toHaveText(/^Layer \d+$/u);
  const createdLayerName = await currentLayerName.textContent();
  expect(createdLayerName).not.toBeNull();
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText(createdLayerName!, { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: `${createdLayerName} värv` }).selectOption("#00ff00");
  await expect(page.getByRole("combobox", { name: `${createdLayerName} värv` })).toHaveValue("#00ff00");
  await page.getByRole("combobox", { name: `${createdLayerName} joonepaksus` }).selectOption("0.35");
  await expect(page.getByRole("combobox", { name: `${createdLayerName} joonepaksus` })).toHaveValue("0.35");
  const layerVisibility = page.getByRole("button", { name: `${createdLayerName} nähtavus` });
  await layerVisibility.click();
  await expect(layerVisibility).toHaveAttribute("aria-pressed", "false");
  await layerVisibility.click();
  await expect(layerVisibility).toHaveAttribute("aria-pressed", "true");
  await expect(currentLayerName).toHaveText(createdLayerName!);

  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("LINE 8000,0 9000,0");
  await command.press("Enter");
  await expect(page.locator(".command-history")).toContainText("LINE");

  // F-106 currently fails closed on dimensions. Prove the supported vector-PDF
  // slice after the layer edit, then prove DIMLINEAR through DXF and recovery.
  await openLayoutTools(page);
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspordi model PDF" }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  const pdfBytes = await readFile(pdfPath!);
  expect(pdfBytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  expect(pdfBytes.toString("latin1")).not.toContain("/Subtype /Image");
  await page.getByLabel("Layout tools").click();

  await page.getByTestId("dimension-menu").locator("summary").click();
  const linearDimension = page.getByRole("menuitem", { name: "Linear" });
  await expect(linearDimension).toHaveAttribute("data-feature-row", "F-061");
  await expect(linearDimension).toBeEnabled();
  await linearDimension.click();
  await answerLivePrompt(page, "first", "8000,0");
  await answerLivePrompt(page, "second", "9000,0");
  await answerLivePrompt(page, "dimensionLinePoint", "8000,500");
  await answerLivePrompt(page, "axis", "horizontal");
  await answerLivePrompt(page, "rotationRad", "");
  await answerLivePrompt(page, "textPoint", "");
  await answerLivePrompt(page, "overrideText", "");
  await answerLivePrompt(page, "associative", "ei");
  await answerLivePrompt(page, "styleId", importedDimensionStyleId!);
  await expect(page.locator(".command-history")).toContainText("DIM · atomic commit/read-back");

  const afterDimension = await readLocalDocument(page);
  expect(afterDimension.entities).toHaveLength(5);
  expect(afterDimension.layers.find((layer) => layer.name === createdLayerName)).toMatchObject({
    visible: true,
    appearance: { color: "#00ff00", lineweightMm: 0.35 },
  });
  expect(afterDimension.entities.slice(-2)).toEqual([
    expect.objectContaining({ kind: "line", layerId: afterDimension.currentLayerId }),
    expect.objectContaining({ kind: "dimension", layerId: afterDimension.currentLayerId, styleId: importedDimensionStyleId }),
  ]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await readLocalDocument(page)).entities.length).toBe(4);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect.poll(async () => (await readLocalDocument(page)).entities.length).toBe(5);

  const dxfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const dxfDownload = await dxfDownloadPromise;
  const dxfPath = await dxfDownload.path();
  expect(dxfPath).not.toBeNull();
  const dxfBytes = await readFile(dxfPath!);
  const dxfReadback = importDxf(dxfBytes, { documentId: "lite-v1-readback" });
  expect(dxfReadback.report.skipped).toEqual([]);
  expect(dxfReadback.document.entities).toHaveLength(5);
  expect(dxfReadback.document.layers.some((layer) => layer.name === createdLayerName)).toBe(true);

  const durableRevision = (await readLocalDocument(page)).revision;
  await page.reload();
  await expect(shell).toHaveAttribute("data-product-profile", "kuubik-draw-lite-v1");
  await expect(page.getByTestId("lite-profile-badge")).toHaveText("LITE V1 · 20 funktsiooni");
  await expect.poll(async () => {
    const document = await readLocalDocument(page);
    return { revision: document.revision, entities: document.entities.length, currentLayer: document.layers.find((layer) => layer.id === document.currentLayerId)?.name };
  }).toEqual({ revision: durableRevision, entities: 5, currentLayer: createdLayerName });
  expect(errors).toEqual([]);
});
