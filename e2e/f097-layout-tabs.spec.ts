import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { f016StandardDocument } from "../parity/fixtures/f016-standard-fixture.mjs";

type RecordedOperation = { opId: string; commandId: string; baseRevision: number; args: Record<string, unknown>; targetHandles: string[]; resultHandles: string[] };

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function layoutDocument(): KDrawDocumentV1 {
  const document = structuredClone(f016StandardDocument) as KDrawDocumentV1;
  document.documentId = "local";
  document.revision = 0;
  document.entities = [];
  document.layouts = [
    { id: "model", name: "Model", kind: "model", viewports: [], entities: [] },
    {
      id: "layout-plan", name: "F097 PLAN", kind: "paper",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
      viewports: [{
        id: "f097-plan-vp", center: { x: 210, y: 148.5 }, width: 390, height: 267,
        viewCenter: { x: 1250, y: -750 }, viewHeight: 5000, twistAngleRad: Math.PI / 12,
        locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } },
      }],
      entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 50, y: 50 }, radius: 25 }],
    },
    {
      id: "layout-notes", name: "F097 NOTES", kind: "paper",
      paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [], entities: [],
    },
  ];
  return document;
}

async function seedLocalDocument(page: import("@playwright/test").Page, document: KDrawDocumentV1): Promise<void> {
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

async function readDocument(page: import("@playwright/test").Page): Promise<KDrawDocumentV1> {
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

async function readOperations(page: import("@playwright/test").Page): Promise<RecordedOperation[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
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

async function captureJson(name: string, value: unknown): Promise<void> {
  if (!process.env.PARITY_CAPTURE_DIR) return;
  await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
  await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function downloadKDraw(page: import("@playwright/test").Page): Promise<{ bytes: Buffer; document: KDrawDocumentV1; sha256: string }> {
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
  if (process.env.PARITY_CAPTURE_DIR) {
    await mkdir(resolve(process.env.PARITY_CAPTURE_DIR), { recursive: true });
    await writeFile(resolve(process.env.PARITY_CAPTURE_DIR, "F-097-browser-layout-tabs.kdraw"), bytes);
  }
  return { bytes, document: JSON.parse(documentBytes.toString("utf8")) as KDrawDocumentV1, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("F-097 visible layout strip copies, reorders, deletes, undoes and persists exact paper content", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page, layoutDocument());

  await page.getByRole("button", { name: "F097 PLAN", exact: true }).click();
  for (const name of ["LINE test", "RECTANGLE", "Vali kõik", "MOVE", "COPY", "ROTATE", "SCALE", "MIRROR", "OFFSET", "OFFSET Undo", "ERASE"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  expect((await readDocument(page)).entities).toEqual([]);
  await page.getByRole("button", { name: "Kopeeri paigutus" }).click();
  await expect(page.getByRole("button", { name: "F097 PLAN (2)", exact: true })).toHaveAttribute("aria-pressed", "true");
  let stored = await readDocument(page);
  expect(stored.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN (2)", "F097 PLAN", "F097 NOTES"]);
  const source = stored.layouts.find((layout) => layout.name === "F097 PLAN")!;
  const copy = stored.layouts.find((layout) => layout.name === "F097 PLAN (2)")!;
  expect(copy).toMatchObject({ paper: source.paper, entities: [{ kind: "circle", radius: 25 }] });
  expect(copy.viewports[0]!.id).not.toBe(source.viewports[0]!.id);
  expect(copy.entities![0]!.handle).not.toBe(source.entities![0]!.handle);

  await page.getByRole("button", { name: "F097 NOTES", exact: true }).click();
  await page.getByRole("button", { name: "Liiguta vasakule" }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN (2)", "F097 NOTES", "F097 PLAN"]);
  await page.getByRole("button", { name: "Liiguta vasakule" }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);

  await page.getByRole("button", { name: "F097 PLAN (2)", exact: true }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Kustuta paigutus" }).click();
  await expect(page.getByRole("button", { name: "F097 PLAN", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  expect((await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);
  await page.getByRole("button", { name: "F097 PLAN (2)", exact: true }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Kustuta paigutus" }).click();

  const exported = await downloadKDraw(page);
  expect(exported.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
  expect(exported.document.layouts.find((layout) => layout.name === "F097 PLAN")!.entities).toMatchObject([{ kind: "circle", radius: 25 }]);
  stored = await readDocument(page);
  const operations = await readOperations(page);
  expect(operations.map((operation) => operation.commandId)).toEqual([
    "LAYOUT_COPY", "LAYOUT_REORDER", "LAYOUT_REORDER", "LAYOUT_DELETE", "UNDO", "LAYOUT_DELETE",
  ]);
  expect(operations.map((operation) => operation.baseRevision)).toEqual([0, 1, 2, 3, 4, 5]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 6")).toBeVisible();
  expect((await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
  await captureJson("F-097-browser-layout-tabs.json", {
    rowId: "F-097", status: "PASS", exportedSha256: exported.sha256,
    finalRevision: stored.revision, layouts: stored.layouts, operations,
  });
  expect(consoleErrors).toEqual([]);
});

test("F-097 creates and renames paper tabs while rejecting case-insensitive duplicates", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  const empty = layoutDocument();
  empty.layouts = [empty.layouts[0]!];
  await seedLocalDocument(page, empty);
  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await expect(page.getByRole("button", { name: "Layout 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Paigutuse nimi").fill("F097 PLAN");
  await page.getByRole("button", { name: "Nimeta paigutus" }).click();
  await expect(page.getByRole("button", { name: "F097 PLAN", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await expect(page.getByRole("button", { name: "Layout 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Paigutuse nimi").fill("f097 plan");
  await page.getByRole("button", { name: "Nimeta paigutus" }).click();
  const duplicateError = page.getByText(/LAYOUT viga: Layout name already exists/);
  await expect(duplicateError).toBeVisible();
  const duplicateErrorText = await duplicateError.textContent();
  const beforeUndo = await readDocument(page);
  const operationsBeforeUndo = await readOperations(page);
  expect(beforeUndo).toMatchObject({ revision: 3 });
  expect(beforeUndo.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN", "Layout 1"]);
  expect(operationsBeforeUndo.map((operation) => operation.commandId)).toEqual(["LAYOUT_CREATE", "LAYOUT_RENAME", "LAYOUT_CREATE"]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN"]);
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "Layout 1"]);
  const afterUndo = await readDocument(page);

  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN"]);
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN", "Layout 1"]);
  const afterRedo = await readDocument(page);
  const operations = await readOperations(page);
  expect(afterUndo.revision).toBe(5);
  expect(afterRedo.revision).toBe(7);
  expect(operations.map((operation) => operation.commandId)).toEqual([
    "LAYOUT_CREATE", "LAYOUT_RENAME", "LAYOUT_CREATE", "UNDO", "UNDO", "LAYOUT_RENAME", "LAYOUT_CREATE",
  ]);
  expect(operations.slice(-2).every((operation) => operation.opId.includes(":redo:"))).toBe(true);
  await captureJson("F-097-browser-create-rename.json", {
    rowId: "F-097",
    status: "PASS",
    beforeUndo,
    afterUndo,
    afterRedo,
    operations,
    duplicateRejected: true,
    duplicateError: duplicateErrorText,
  });
  expect(consoleErrors).toEqual([]);
});

test("F-097 PAPER blocks undo and redo of hidden Model operations while preserving layout undo", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await seedLocalDocument(page, layoutDocument());
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("button", { name: "LINE test", exact: true }).click();
  const beforeBlockedUndo = await readDocument(page);
  expect(beforeBlockedUndo).toMatchObject({ revision: 1 });
  expect(beforeBlockedUndo.entities).toHaveLength(1);

  await page.getByRole("button", { name: "F097 PLAN", exact: true }).click();
  await expect(page.getByRole("button", { name: "UNDO", exact: true })).toBeDisabled();
  const afterBlockedUndo = await readDocument(page);
  expect(afterBlockedUndo).toEqual(beforeBlockedUndo);

  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).entities).toEqual([]);
  const beforeBlockedRedo = await readDocument(page);
  expect(beforeBlockedRedo.revision).toBe(2);

  await page.getByRole("button", { name: "F097 PLAN", exact: true }).click();
  await expect(page.getByRole("button", { name: "REDO", exact: true })).toBeDisabled();
  const afterBlockedRedo = await readDocument(page);
  expect(afterBlockedRedo).toEqual(beforeBlockedRedo);
  await captureJson("F-097-browser-paper-domain.json", {
    rowId: "F-097",
    status: "PASS",
    modelUndoBlockedInPaper: true,
    modelRedoBlockedInPaper: true,
    beforeBlockedUndo,
    afterBlockedUndo,
    beforeBlockedRedo,
    afterBlockedRedo,
  });
  expect(consoleErrors).toEqual([]);
});
