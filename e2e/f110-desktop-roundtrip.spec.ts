import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "../packages/cad-core/src/index.js";
import { importDxf } from "../packages/cad-dxf/src/index.js";

const fixturePath = resolve("packages/cad-dxf/test/fixtures/synthetic/F-110-desktop-saved.dxf");
const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function dismissRecovery(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Sulge taastamispaneel" });
  try {
    await close.waitFor({ state: "visible", timeout: 2_000 });
    await close.click();
  } catch {
    // A clean session has no recovery dialog.
  }
}

async function seedEmptyDocument(page: Page): Promise<void> {
  const document = createEmptyDocument({ documentId: "local", now: "2026-09-01T00:00:00.000Z" });
  await page.goto("/d/local");
  await page.evaluate(async (value) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 3);
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains("documents")) next.createObjectStore("documents", { keyPath: "documentId" });
        if (!next.objectStoreNames.contains("operations")) {
          const store = next.createObjectStore("operations", { keyPath: "opId" });
          store.createIndex("byDocument", "documentId");
        }
        if (!next.objectStoreNames.contains("snapshots")) next.createObjectStore("snapshots", { keyPath: "key" });
        if (!next.objectStoreNames.contains("attachments")) next.createObjectStore("attachments", { keyPath: "id" });
        if (!next.objectStoreNames.contains("recoveryEvents")) next.createObjectStore("recoveryEvents", { keyPath: "eventId" }).createIndex("byDocument", "documentId");
        if (!next.objectStoreNames.contains("compactions")) next.createObjectStore("compactions", { keyPath: "key" }).createIndex("byDocument", "documentId");
      };
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const transaction = database.transaction(["documents", "operations", "snapshots", "recoveryEvents", "compactions"], "readwrite");
      transaction.objectStore("documents").put(value);
      transaction.objectStore("operations").clear();
      transaction.objectStore("snapshots").clear();
      transaction.objectStore("recoveryEvents").clear();
      transaction.objectStore("compactions").clear();
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => rejectWrite(transaction.error);
    });
    database.close();
  }, document);
  await page.reload();
  await dismissRecovery(page);
  await expect(page.getByLabel("DXF import")).toBeVisible();
}

async function storedDocument(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 3);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const result = await new Promise<unknown>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return result;
  });
}

test("F-110 imports the exact AutoCAD Desktop save in production Chromium and preserves editable semantics", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-09-01T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedEmptyDocument(page);
  const source = await readFile(fixturePath);
  expect(sha256(source)).toBe("8540f77da4b011c39f38fee5cdeb285ca854e918398fa1fd8944eab31cd4cb4f");

  await page.getByLabel("DXF import").setInputFiles({ name: "F-110-desktop-saved.dxf", mimeType: "application/dxf", buffer: source });
  await expect(page.getByText("DXF imporditud: 13 objekti · 2 kihti · mm")).toBeVisible();
  await dismissRecovery(page);
  const imported = await storedDocument(page);
  expect(imported).toMatchObject({ revision: 1, units: { linear: "mm" } });
  expect(imported.entities.map((entity: any) => entity.handle)).toEqual(["10", "20", "30", "40", "50", "60", "70", "80", "90", "A0", "B0"]);
  expect(imported.entities.find((entity: any) => entity.handle === "70")).toMatchObject({ kind: "text", text: "TÕEND ŠŽ€" });
  expect(imported.blocks).toMatchObject([{ name: "SYMBOL", entities: [{ handle: "C0" }, { handle: "C1" }] }]);

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MOVE baaspunkt").fill("0,0");
  await page.getByLabel("MOVE sihtpunkt").fill("10,20");
  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("11 objekti nihutatud Δ10,20")).toBeVisible();
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 3")).toBeVisible();
  await page.getByRole("button", { name: "REDO", exact: true }).click();
  await expect(page.getByText("REDO taastatud, revision 4")).toBeVisible();

  await page.reload();
  await dismissRecovery(page);
  await expect(page.getByLabel("DXF import")).toBeVisible();
  const persisted = await storedDocument(page);
  expect(persisted.revision).toBe(4);
  expect(persisted.entities).toHaveLength(11);
  expect(persisted.entities.find((entity: any) => entity.handle === "10")).toMatchObject({ kind: "line", start: { x: 10, y: 20 }, end: { x: 110, y: 45 } });

  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  await expect(page.getByText("DXF eksporditud: 13 objekti")).toBeVisible();
  const download = await pendingDownload;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = await readFile(downloadPath!);
  const readback = importDxf(exported, { documentId: "F-110-browser-readback" });
  expect(readback.report.skipped).toEqual([]);
  expect(readback.document.units.linear).toBe("mm");
  expect(readback.document.entities.map((entity) => entity.handle)).toEqual(["10", "20", "30", "40", "50", "60", "70", "80", "90", "A0", "B0"]);
  expect(readback.document.entities.find((entity) => entity.handle === "70")).toMatchObject({ kind: "text", text: "TÕEND ŠŽ€" });
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await writeFile(resolve("packages/cad-dxf/test/fixtures/synthetic/F-110-browser-roundtrip.dxf"), exported);
    await page.screenshot({ path: resolve(captureDir, "F-110-browser-roundtrip.png"), fullPage: true });
    await writeFile(resolve(captureDir, "F-110-browser-readback.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-110",
      status: "PASS",
      source: { path: "packages/cad-dxf/test/fixtures/synthetic/F-110-desktop-saved.dxf", bytes: source.byteLength, sha256: sha256(source) },
      exported: { bytes: exported.byteLength, sha256: sha256(exported), semanticReadback: "PASS" },
      workflow: "Visible production DXF import -> select all -> MOVE -> Undo -> Redo -> reload -> visible DXF export",
      viewport: { width: 1920, height: 1080 },
      revision: persisted.revision,
      entityHandles: readback.document.entities.map((entity) => entity.handle),
      units: readback.document.units.linear,
      text: (readback.document.entities.find((entity) => entity.handle === "70") as any).text,
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});
