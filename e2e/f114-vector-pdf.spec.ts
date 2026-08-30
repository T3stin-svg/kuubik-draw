import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createF114Document, F114_LAYOUT_IDS, F114_LAYOUT_NAMES } from "../parity/fixtures/f114-document.js";
import { openLayoutTools } from "./helpers/layout-tools.js";

const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
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

async function publish(page: Page): Promise<{ bytes: Buffer; name: string }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Publish layouts" }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { bytes: await readFile(path!), name: download.suggestedFilename() };
}

function summary(bytes: Buffer) {
  const text = bytes.toString("latin1");
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    a3Landscape: (text.match(/\/MediaBox \[0 0 1190\.551181 841\.889764\]/gu) ?? []).length,
    a4Portrait: (text.match(/\/MediaBox \[0 0 595\.275591 841\.889764\]/gu) ?? []).length,
    a3TitleAt: text.indexOf(`(${F114_LAYOUT_NAMES[0]}) Tj`),
    a4TitleAt: text.indexOf(`(${F114_LAYOUT_NAMES[1]}) Tj`),
    kuubikTitles: (text.match(/\(KUUBIK F-114 VECTOR PDF\) Tj/gu) ?? []).length,
    red: text.includes("1 0 0 RG 1 0 0 rg"),
    blue: text.includes("0 0 1 RG 0 0 1 rg"),
    alpha60: text.includes("/GS60 gs"),
    images: (text.match(/\/Subtype \/Image\b/gu) ?? []).length,
    eof: /%%EOF\s*$/u.test(text),
  };
}

test("F-114 downloads a deterministic mixed-size vector PDF and restores it after reload", async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.setFixedTime("2026-08-29T00:00:00.000Z");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedLocalDocument(page, createF114Document("local"));
  await page.getByRole("button", { name: F114_LAYOUT_NAMES[0], exact: true }).click();
  await openLayoutTools(page);

  const options = page.getByTestId("publish-options");
  await options.locator("summary").click();
  await expect(options).toHaveAttribute("data-order", F114_LAYOUT_IDS.join("|"));
  await expect(options).toHaveAttribute("data-included", F114_LAYOUT_IDS.join("|"));
  const name = options.getByRole("textbox", { name: "Publish failinimi" });
  await name.fill("F114 Browser");
  await options.getByRole("button", { name: "Salvesta publish failinimi" }).click();
  await expect(options).toHaveAttribute("data-busy", "false");

  const first = await publish(page);
  const firstSummary = summary(first.bytes);
  expect(first.name).toBe("F114 Browser.pdf");
  expect(firstSummary).toEqual({
    version: "1.4", pages: 2, a3Landscape: 1, a4Portrait: 1,
    a3TitleAt: expect.any(Number), a4TitleAt: expect.any(Number), kuubikTitles: 2,
    red: true, blue: true, alpha60: true, images: 0, eof: true,
  });
  expect(firstSummary.a3TitleAt).toBeGreaterThan(0);
  expect(firstSummary.a4TitleAt).toBeGreaterThan(firstSummary.a3TitleAt);

  await options.locator("summary").click();
  await page.getByRole("button", { name: F114_LAYOUT_NAMES[1], exact: true }).click();
  await expect(page.getByTestId("paper-space-sheet")).toHaveAttribute("data-paper-width-mm", "210");
  await expect(page.getByTestId("paper-space-sheet")).toHaveAttribute("data-paper-height-mm", "297");
  await page.reload();
  await expect(page.getByText(/Taastatud revision/u)).toBeVisible();
  await page.getByRole("button", { name: F114_LAYOUT_NAMES[0], exact: true }).click();
  await openLayoutTools(page);
  const restored = page.getByTestId("publish-options");
  await restored.locator("summary").click();
  await expect(restored.getByRole("textbox", { name: "Publish failinimi" })).toHaveValue("F114 Browser");
  const second = await publish(page);
  expect(second.bytes).toEqual(first.bytes);
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    await Promise.all([
      writeFile(resolve(captureDir, "F-114-browser-vector.pdf"), first.bytes),
      restored.locator(".publish-options-grid").screenshot({ path: resolve(captureDir, "F-114-browser-publish.png") }),
      writeFile(resolve(captureDir, "F-114-browser-matrix.json"), `${JSON.stringify({
        schemaVersion: 1,
        rowId: "F-114",
        status: "PASS",
        viewport: { width: 1920, height: 1080 },
        action: "Open A3 -> publish mixed A3/A4 vector PDF -> inspect A4 -> reload -> exact re-publish",
        order: [...F114_LAYOUT_IDS],
        included: [...F114_LAYOUT_IDS],
        output: { bytes: first.bytes.byteLength, sha256: sha256(first.bytes), name: first.name, summary: firstSummary },
        deterministicReloadSha256: sha256(second.bytes),
        consoleErrors: errors,
      }, null, 2)}\n`, "utf8"),
    ]);
  }
});
