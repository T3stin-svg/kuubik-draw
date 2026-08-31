import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";
import { clearModelSelection } from "./helpers/selection.js";

async function downloadBytes(download: { path(): Promise<string | null> }, captureName: string): Promise<Buffer> {
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const captureRoot = process.env.PARITY_CAPTURE_DIR;
  if (captureRoot) {
    await mkdir(resolve(captureRoot), { recursive: true });
    await writeFile(resolve(captureRoot, captureName), bytes);
  }
  return bytes;
}

test("F-015 ERASE selection to atomic delete, empty DXF and one-step UNDO", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/d/local");
  await expect(page.getByText(/DocumentLiveOrchestrator/u)).toBeVisible();
  await page.getByRole("button", { name: "LINE test" }).click();
  await expect(page.getByText("LINE runtime salvestatud, revision 1")).toBeVisible();
  await page.getByLabel("Esimene nurk").fill("125.25,-200.5");
  await page.getByLabel("Teine nurk").fill("600.75,900.125");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await expect(page.getByText("RECTANGLE salvestatud, revision 2")).toBeVisible();
  await clearModelSelection(page);
  await expect(page.getByText("2 objekti · 0 valitud")).toBeVisible();

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti · 2 valitud")).toBeVisible();
  await page.getByRole("button", { name: "ERASE", exact: true }).click();
  await expect(page.getByText("2 objekti kustutatud")).toBeVisible();
  await expect(page.getByText("0 objekti · 0 valitud")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("local-r3.dxf");
  const parsed = new DxfParser().parseSync((await downloadBytes(download, "F-015-browser-empty.dxf")).toString("utf8"));
  expect(parsed?.header?.$INSUNITS).toBe(4);
  expect(parsed?.entities).toEqual([]);

  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(page.getByText("UNDO taastatud, revision 4")).toBeVisible();
  await expect(page.getByText("2 objekti · 0 valitud")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("recovery-panel").getByText("Pärast katkestust taastati revisjon 4.", { exact: true })).toBeVisible();
  await expect(page.getByText("2 objekti · 0 valitud")).toBeVisible();
  const restoredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const restoredDownload = await restoredDownloadPromise;
  expect(restoredDownload.suggestedFilename()).toBe("local-r4.dxf");
  const restored = new DxfParser().parseSync((await downloadBytes(restoredDownload, "F-015-browser-restored.dxf")).toString("utf8"));
  expect(restored?.entities.map((entity) => entity.handle).sort()).toEqual(["10", "11"]);
  expect(restored?.entities.find((entity) => entity.type === "LINE")).toMatchObject({
    handle: "10",
    layer: "0",
    vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }],
  });
  expect(restored?.entities.find((entity) => entity.type === "LWPOLYLINE")).toMatchObject({
    handle: "11",
    layer: "0",
    shape: true,
    vertices: [
      { x: 125.25, y: -200.5 },
      { x: 600.75, y: -200.5 },
      { x: 600.75, y: 900.125 },
      { x: 125.25, y: 900.125 },
    ],
  });
  expect(consoleErrors).toEqual([]);
});

test("F-015 mixed selection preserves a locked-layer object through commit and reload", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/d/local");
  await expect(page.getByText(/DocumentLiveOrchestrator/u)).toBeVisible();
  await page.getByRole("button", { name: "LINE test" }).click();
  await expect(page.getByText("LINE runtime salvestatud, revision 1")).toBeVisible();
  await page.getByRole("button", { name: "Uus kiht", exact: true }).click();
  await expect(page.getByText("Layer 1 loodud typed Layer Manageri kaudu")).toBeVisible();
  await page.getByLabel("Esimene nurk").fill("125.25,-200.5");
  await page.getByLabel("Teine nurk").fill("600.75,900.125");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await expect(page.getByText("RECTANGLE salvestatud, revision 3")).toBeVisible();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();
  await expect(page.getByText("Layer 1 lukustatud")).toBeVisible();

  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByRole("button", { name: "ERASE", exact: true }).click();
  await expect(page.getByText("1 objekti kustutatud; 1 jäi muutmata")).toBeVisible();
  await expect(page.getByText("1 objekti · 0 valitud · Layer 1 · LOCKED", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("recovery-panel").getByText("Pärast katkestust taastati revisjon 5.", { exact: true })).toBeVisible();
  await expect(page.getByText("1 objekti · 0 valitud · Layer 1 · LOCKED", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const parsed = new DxfParser().parseSync((await downloadBytes(await downloadPromise, "F-015-browser-locked.dxf")).toString("utf8"));
  expect(parsed?.entities).toHaveLength(1);
  expect(parsed?.entities[0]).toMatchObject({
    type: "LWPOLYLINE",
    handle: "12",
    layer: "Layer 1",
    shape: true,
    vertices: [
      { x: 125.25, y: -200.5 },
      { x: 600.75, y: -200.5 },
      { x: 600.75, y: 900.125 },
      { x: 125.25, y: 900.125 },
    ],
  });
  expect(consoleErrors).toEqual([]);
});
