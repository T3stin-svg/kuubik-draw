import { expect, test } from "@playwright/test";

test("/d/local commits and restores a versioned IndexedDB document", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/d/local");
  await expect(page.getByText("Kuubik Draw", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toBeVisible();
  await expect(page.getByText("0 objekti")).toBeVisible();

  await page.getByRole("button", { name: "LINE test" }).click();
  await expect(page.getByText("1 objekti")).toBeVisible();
  await expect(page.getByText("LINE salvestatud, revision 1")).toBeVisible();

  await page.reload();
  await expect(page.getByText("1 objekti")).toBeVisible();
  await expect(page.getByText("Taastatud revision 1")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
