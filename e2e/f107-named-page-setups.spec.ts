import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { MAX_PAGE_SETUP_TEMPLATE_BYTES, createPageSetupTemplate, parsePageSetupTemplate, resolvePageSetupLibrary, serializePageSetupTemplate, type PageSetupTemplateV1 } from "../packages/cad-core/src/index.js";
import { createF107Document } from "../parity/fixtures/f107-document.js";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function seedLocalDocument(page: Page, document: KDrawDocumentV1, errors: string[]): Promise<void> {
  await page.goto("/d/local");
  await page.evaluate(async (value) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains("documents")) next.createObjectStore("documents", { keyPath: "documentId" });
        if (!next.objectStoreNames.contains("operations")) {
          const store = next.createObjectStore("operations", { keyPath: "opId" });
          store.createIndex("byDocument", "documentId");
        }
        if (!next.objectStoreNames.contains("snapshots")) next.createObjectStore("snapshots", { keyPath: "key" });
        if (!next.objectStoreNames.contains("attachments")) next.createObjectStore("attachments", { keyPath: "id" });
      };
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
  await page.waitForTimeout(100);
  if (await page.locator("main").count() === 0) throw new Error(`F-107 app failed to render after seed: ${errors.join(" | ")}`);
  await expect(page.getByText("Taastatud revision 0")).toBeVisible();
}

async function readLocalDocument(page: Page): Promise<KDrawDocumentV1> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
    const value = await new Promise<unknown>((resolveRead, rejectRead) => {
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return value as KDrawDocumentV1;
  });
}

function containsForbiddenGeometryKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenGeometryKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, entry]) => key === "entities" || key === "blocks" || containsForbiddenGeometryKey(entry));
}

test("F-107 persists named page setup CRUD and imports a geometry-free template atomically", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-29T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF107Document("local"), errors);
  await page.getByRole("button", { name: "F-107 ISSUE LAYOUT", exact: true }).click();
  const library = page.getByTestId("page-setup-library");
  await library.getByText("PAGE SETUPS", { exact: true }).click();
  await expect(library).toHaveAttribute("data-count", "0");

  await page.getByRole("textbox", { name: "New page setup name" }).fill("F-107 A4 ISSUE");
  await page.getByRole("button", { name: "Save named page setup" }).click();
  await expect(page.getByText("Page setup “F-107 A4 ISSUE” salvestatud.")).toBeVisible();
  await expect(library).toHaveAttribute("data-count", "1");
  await expect(library).toHaveAttribute("data-assigned", "page-setup-1");
  await expect(page.getByRole("combobox", { name: "Named page setup" })).toHaveValue("page-setup-1");

  await page.getByRole("textbox", { name: "New page setup name" }).fill(" f-107 a4 issue ");
  await page.getByRole("button", { name: "Save named page setup" }).click();
  await expect(page.getByText(/PAGESETUP viga: Page setup name already exists/u)).toBeVisible();
  expect((await readLocalDocument(page)).revision).toBe(1);

  await page.getByRole("combobox", { name: "Paper media" }).selectOption("ISO_A3");
  await page.getByRole("combobox", { name: "Paper orientation" }).selectOption("landscape");
  await page.getByRole("combobox", { name: "Plot area" }).selectOption("window");
  await page.getByRole("combobox", { name: "Plot scale mode" }).selectOption("fit");
  const center = page.getByRole("checkbox", { name: "Center plot" });
  if (await center.isChecked()) await center.click();
  await page.getByRole("textbox", { name: "Plot offset X" }).fill("4");
  await page.getByRole("textbox", { name: "Plot offset Y" }).fill("6");
  await page.getByRole("button", { name: "Rakenda page setup" }).click();
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-media", "ISO_A3");
  await expect(library).toHaveAttribute("data-assigned", "");
  await page.getByRole("combobox", { name: "Named page setup" }).selectOption("page-setup-1");
  await page.getByRole("button", { name: "Apply named page setup" }).click();
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-media", "ISO_A4");
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-orientation", "portrait");
  await expect(page.getByTestId("page-setup-controls")).toHaveAttribute("data-plot-area", "layout");

  await page.getByRole("textbox", { name: "Rename page setup" }).fill("F-107 A4 FINAL");
  await page.getByRole("button", { name: "Rename named page setup" }).click();
  await expect(page.getByRole("combobox", { name: "Named page setup" })).toContainText("F-107 A4 FINAL");
  await page.getByRole("textbox", { name: "Page setup template name" }).fill("F-107 office template");
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export page setup template" }).click();
  const templateDownload = await pendingDownload;
  expect(templateDownload.suggestedFilename()).toBe("F-107 office template.kdraw-template.json");
  const templatePath = await templateDownload.path();
  expect(templatePath).not.toBeNull();
  const templateBytes = await readFile(templatePath!);
  const templateText = templateBytes.toString("utf8");
  const template = parsePageSetupTemplate(templateText);
  expect(serializePageSetupTemplate(template)).toBe(templateText);
  expect(template).toMatchObject({ format: "kuubik-draw-page-setup-template", name: "F-107 office template", pageSetups: [{ name: "F-107 A4 FINAL" }] });
  expect(containsForbiddenGeometryKey(template)).toBe(false);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete named page setup" }).click();
  await expect(library).toHaveAttribute("data-count", "0");
  await expect(library).toHaveAttribute("data-assigned", "");
  await page.getByLabel("Import page setup template").setInputFiles({ name: "F-107-office.kdraw-template.json", mimeType: "application/json", buffer: templateBytes });
  await expect(page.getByText(/Template “F-107 office template” rakendatud ühe undo-sammuna: 1 setup'i, 1 layout'i/u)).toBeVisible();
  await expect(library).toHaveAttribute("data-count", "1");
  await expect(page.getByRole("button", { name: "F-107 ISSUE LAYOUT (2)", exact: true })).toBeVisible();
  const imported = await readLocalDocument(page);
  expect(imported.revision).toBe(6);
  expect(imported.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  expect(imported.layouts[1]!.entities?.map((entity) => entity.handle)).toEqual(["12"]);
  expect(imported.layouts[2]).toMatchObject({ name: "F-107 ISSUE LAYOUT (2)", entities: [] });
  expect(resolvePageSetupLibrary(imported)).toMatchObject({ setups: [{ name: "F-107 A4 FINAL" }], assignments: { "layout-2": "page-setup-1" } });

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByRole("button", { name: "F-107 ISSUE LAYOUT (2)", exact: true })).toHaveCount(0);
  await expect(library).toHaveAttribute("data-count", "0");
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(page.getByRole("button", { name: "F-107 ISSUE LAYOUT (2)", exact: true })).toBeVisible();
  await expect(library).toHaveAttribute("data-count", "1");
  await page.reload();
  await expect(page.getByText("Taastatud revision 8")).toBeVisible();
  await expect(page.getByRole("button", { name: "F-107 ISSUE LAYOUT (2)", exact: true })).toBeVisible();
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await page.getByRole("button", { name: "F-107 ISSUE LAYOUT (2)", exact: true }).click();
    await page.getByTestId("page-setup-library").getByText("PAGE SETUPS", { exact: true }).click();
    await expect(library).toHaveAttribute("data-assigned", "page-setup-1");
    await expect(page.getByRole("combobox", { name: "Named page setup" })).toHaveValue("page-setup-1");
    const finalDocument = await readLocalDocument(page);
    await page.locator(".page-setup-library-grid").screenshot({ path: resolve(captureDir, "F-107-browser-page-setups.png") });
    await writeFile(resolve(captureDir, "F-107-browser-template.json"), templateBytes);
    await writeFile(resolve(captureDir, "F-107-browser-matrix.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-107",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      workflow: "Save unique named A4 setup -> duplicate reject -> mutate layout -> apply -> rename -> geometry-free export -> delete -> file-input import -> atomic Undo/Redo -> IndexedDB reload",
      template: { bytes: templateBytes.byteLength, sha256: sha256(templateBytes), name: template.name, pageSetups: template.pageSetups.length, layouts: template.layouts.length, geometryFree: !containsForbiddenGeometryKey(template) },
      finalDocument: {
        revision: finalDocument.revision,
        layouts: finalDocument.layouts.length,
        modelEntities: finalDocument.entities.length,
        preservedPaperEntities: finalDocument.layouts[1]?.entities?.length ?? 0,
        importedPaperEntities: finalDocument.layouts[2]?.entities?.length ?? 0,
        library: resolvePageSetupLibrary(finalDocument),
      },
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});

test("F-107 rejects a dangling template through the visible file input without committing", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF107Document("local"), errors);
  const template = createPageSetupTemplateFixture();
  template.layouts[1]!.pageSetupId = "missing";
  await page.getByTestId("page-setup-library").getByText("PAGE SETUPS", { exact: true }).click();
  await page.getByLabel("Import page setup template").setInputFiles({ name: "dangling.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.getByText(/TEMPLATE viga: Template layout 2 references a missing page setup/u)).toBeVisible();
  expect((await readLocalDocument(page)).revision).toBe(0);
  const stale = createPageSetupTemplateFixture();
  stale.layouts[1]!.pageSetup.plotStyle.profile = "color";
  await page.getByLabel("Import page setup template").setInputFiles({ name: "stale.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(stale)) });
  await expect(page.getByText(/TEMPLATE viga: Template layout 2 does not match its named page setup/u)).toBeVisible();
  expect((await readLocalDocument(page)).revision).toBe(0);
  await page.getByLabel("Import page setup template").setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(MAX_PAGE_SETUP_TEMPLATE_BYTES + 1, 0x20) });
  await expect(page.getByText(/TEMPLATE viga: Page setup template exceeds/u)).toBeVisible();
  expect((await readLocalDocument(page)).revision).toBe(0);
  expect(errors).toEqual([]);
});

function createPageSetupTemplateFixture(): PageSetupTemplateV1 {
  const document = createF107Document("F-107-template-fixture");
  const saved = {
    schemaVersion: 1 as const,
    setups: [{ id: "page-setup-1", name: "A4 issue", pageSetup: structuredClone(document.layouts[1]!.pageSetup!), paperMarginsMm: structuredClone(document.layouts[1]!.paper!.marginsMm) }],
    assignments: { "layout-1": "page-setup-1" },
  };
  document.metadata.extensions = { "kuubikDraw.pageSetupLibrary.v1": saved };
  return createPageSetupTemplate(document, "Dangling fixture");
}
