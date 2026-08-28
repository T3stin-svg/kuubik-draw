import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";

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

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("F-016 MOVE preselection preview, exact vector, one-step UNDO and reload", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByLabel("Esimene nurk").fill("0,1000");
  await page.getByLabel("Teine nurk").fill("1000,1500");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti · 2 valitud")).toBeVisible();
  await page.getByLabel("MOVE baaspunkt").fill("100,200");
  await page.getByLabel("MOVE sihtpunkt").fill("600,950");
  await expect(page.getByTestId("move-preview")).toHaveText("MOVE eelvaade: 2 · Δ500,750");
  await expect(page.getByText("2 objekti · 2 valitud")).toBeVisible();

  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("2 objekti nihutatud Δ500,750")).toBeVisible();
  await expect(page.getByText("2 objekti · 0 valitud")).toBeVisible();

  const movedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const moved = new DxfParser().parseSync((await downloadBytes(await movedDownload, "F-016-browser-moved.dxf")).toString("utf8"));
  expect(moved?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, shape: entity.shape, vertices: entity.vertices }))).toEqual([
    { type: "LINE", handle: "10", shape: undefined, vertices: [{ x: 510, y: 760, z: 0 }, { x: 680, y: 840, z: 0 }] },
    { type: "LWPOLYLINE", handle: "11", shape: true, vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
  ]);

  await page.getByRole("button", { name: "UNDO" }).click();
  await expect(page.getByText("UNDO taastatud, revision 4")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 4")).toBeVisible();
  const restoredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const restored = new DxfParser().parseSync((await downloadBytes(await restoredDownload, "F-016-browser-restored.dxf")).toString("utf8"));
  expect(restored?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, shape: entity.shape, vertices: entity.vertices }))).toEqual([
    { type: "LINE", handle: "10", shape: undefined, vertices: [{ x: 10, y: 10, z: 0 }, { x: 180, y: 90, z: 0 }] },
    { type: "LWPOLYLINE", handle: "11", shape: true, vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-016 MOVE postselection, @relative input and mixed locked-layer selection", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Uus kiht" }).click();
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Lukusta aktiivne" }).click();

  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("MOVE: vali objektid, seejärel kinnita valik ja punktid")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await expect(page.getByText("2 objekti valitud; MOVE: määra baaspunkt ja sihtpunkt")).toBeVisible();
  await page.getByLabel("MOVE baaspunkt").fill("0,0");
  await page.getByLabel("MOVE sihtpunkt").fill("@100,50");
  await expect(page.getByTestId("move-preview")).toHaveText("MOVE eelvaade: 1 · Δ100,50");
  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("1 objekti nihutatud Δ100,50; 1 jäi muutmata")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Taastatud revision 5")).toBeVisible();

  const mixedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const mixed = new DxfParser().parseSync((await downloadBytes(await mixedDownload, "F-016-browser-locked.dxf")).toString("utf8"));
  expect(mixed?.entities.map((entity) => ({ handle: entity.handle, layer: entity.layer, vertices: entity.vertices }))).toEqual([
    { handle: "10", layer: "0", vertices: [{ x: 110, y: 60, z: 0 }, { x: 280, y: 140, z: 0 }] },
    { handle: "12", layer: "layer-1", vertices: [{ x: 10, y: 20, z: 0 }, { x: 180, y: 90, z: 0 }] },
  ]);
  expect(consoleErrors).toEqual([]);
});

test("F-016 MOVE zero displacement is a successful no-op with no undo entry", async ({ page }) => {
  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  await page.getByRole("button", { name: "LINE test" }).click();
  await page.getByRole("button", { name: "Vali kõik" }).click();
  await page.getByLabel("MOVE baaspunkt").fill("200,300");
  await page.getByLabel("MOVE sihtpunkt").fill("200,300");
  await expect(page.getByTestId("move-preview")).toHaveText("MOVE eelvaade: 0 · Δ0,0");
  await page.getByRole("button", { name: "MOVE", exact: true }).click();
  await expect(page.getByText("MOVE ei muutnud geomeetriat")).toBeVisible();
  await expect(page.getByRole("button", { name: "UNDO" })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("Taastatud revision 1")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
