import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { exportDxf } from "../packages/cad-dxf/src/index.js";
import { createF109Document } from "../parity/fixtures/f109-document.js";
import { seedKDrawDocument } from "./helpers/indexed-db.js";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function seedLocalDocument(page: Page, document: KDrawDocumentV1): Promise<void> {
  await seedKDrawDocument(page, document);
}

test("F-109 exports the exact production DXF bytes through the visible browser workflow", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-29T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const document = createF109Document("local");
  await seedLocalDocument(page, document);

  const expected = Buffer.from(exportDxf(document).bytes);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("local-r0.dxf");
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.equals(expected)).toBe(true);
  await expect(page.getByText("DXF eksporditud: 40 objekti")).toBeVisible();
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await writeFile(resolve(captureDir, "F-109-browser.dxf"), bytes);
    await page.screenshot({ path: resolve(captureDir, "F-109-browser-export.png"), fullPage: true });
    await writeFile(resolve(captureDir, "F-109-browser-matrix.json"), `${JSON.stringify({
      schemaVersion: 1,
      rowId: "F-109",
      status: "PASS",
      viewport: { width: 1920, height: 1080 },
      workflow: "Seed exact 40-entity document -> click visible DXF eksport -> capture browser download -> compare exact production bytes",
      suggestedFilename: download.suggestedFilename(),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      exactProductionBytes: bytes.equals(expected),
      entityCount: document.entities.length,
      revision: document.revision,
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
});

test("F-109 refuses a visible partial export when the document contains an unsupported entity", async ({ page }) => {
  const errors = collectErrors(page);
  const document = createF109Document("local");
  document.entities.push({ kind: "proxy", handle: "1600", layerId: "lines", originalType: "ACAD_PROXY_ENTITY", raw: { reason: "synthetic F-109 refusal fixture" } });
  await seedLocalDocument(page, document);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "DXF eksport" }).click();
  await expect(page.getByText("DXF peatatud: 1 toetamata objekti")).toBeVisible();
  await page.waitForTimeout(250);
  expect(downloaded).toBe(false);
  expect(errors).toEqual([]);
});

test("F-109 reports encoding errors without a partial download or page error", async ({ page }) => {
  const errors = collectErrors(page);
  const invalid = createF109Document("local");
  invalid.layers[0]!.name = "😀";
  await seedLocalDocument(page, invalid);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "DXF eksport" }).click();
  await expect(page.getByText(/DXF viga: DXF ANSI_1252 cannot encode/u)).toBeVisible();
  await page.waitForTimeout(250);
  expect(downloaded).toBe(false);
  expect(errors).toEqual([]);
});

test("F-109 refuses a HATCH with one invalid loop instead of downloading partial geometry", async ({ page }) => {
  const errors = collectErrors(page);
  const invalid = createF109Document("local");
  const hatch = invalid.entities.find((entity) => entity.kind === "hatch");
  if (!hatch || hatch.kind !== "hatch") throw new Error("F-109 hatch fixture is missing.");
  hatch.loops.push({ isHole: true, vertices: [{ x: 5220, y: 3020 }, { x: 5240, y: 3020 }] });
  await seedLocalDocument(page, invalid);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "DXF eksport" }).click();
  await expect(page.getByText(/DXF viga: DXF HATCH 1300 requires every boundary loop/u)).toBeVisible();
  await page.waitForTimeout(250);
  expect(downloaded).toBe(false);
  expect(errors).toEqual([]);
});
