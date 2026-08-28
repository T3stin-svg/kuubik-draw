import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import DxfParser from "dxf-parser";

test("F-003 RECTANGLE registry to browser commit and independent DXF read-back", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/d/local");
  await page.getByLabel("Esimene nurk").fill("125.25,-200.5");
  await page.getByLabel("Teine nurk").fill("600.75,900.125");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await expect(page.getByText("RECTANGLE salvestatud, revision 1")).toBeVisible();
  await expect(page.getByText("1 objekti")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF eksport" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("local-r1.dxf");
  const path = await download.path();
  expect(path).not.toBeNull();
  const dxf = await readFile(path!, "utf8");
  const parsed = new DxfParser().parseSync(dxf);
  expect(parsed?.header?.$INSUNITS).toBe(4);
  expect(parsed?.entities).toHaveLength(1);
  const rectangle = parsed?.entities[0] as { type?: string; shape?: boolean; vertices?: Array<{ x: number; y: number }> };
  expect(rectangle.type).toBe("LWPOLYLINE");
  expect(rectangle.shape).toBe(true);
  expect(rectangle.vertices).toEqual([
    expect.objectContaining({ x: 125.25, y: -200.5 }),
    expect.objectContaining({ x: 600.75, y: -200.5 }),
    expect.objectContaining({ x: 600.75, y: 900.125 }),
    expect.objectContaining({ x: 125.25, y: 900.125 }),
  ]);

  await page.reload();
  await expect(page.getByText("Taastatud revision 1")).toBeVisible();
  await expect(page.getByText("1 objekti")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
