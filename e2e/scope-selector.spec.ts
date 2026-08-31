import { expect, test } from "@playwright/test";

test.describe("Reio scope selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/scope.html");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("renders all rows exactly once and has no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await expect(page.getByRole("heading", { name: "Vali ainult see, mida sul päriselt vaja on." })).toBeVisible();
    await expect(page.getByTestId("selected-count")).toHaveText("0 / 133");
    const rowIds = await page.locator("[data-row-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-row-id")));
    expect(rowIds).toHaveLength(133);
    expect(new Set(rowIds).size).toBe(133);
    expect(consoleErrors).toEqual([]);
  });

  test("supports group tri-state, 13-row percentage and persistence", async ({ page }) => {
    const firstGroup = page.locator('[data-group-id="1"]');
    await firstGroup.locator(":scope > summary").click();
    const groupCheckbox = firstGroup.getByRole("checkbox", { name: "Vali kogu grupp Põhijoonestamine" });
    const firstRowCheckbox = firstGroup.locator('[data-row-id="F-001"] input[type="checkbox"]');
    await firstRowCheckbox.check();
    await expect(groupCheckbox).toHaveJSProperty("indeterminate", true);
    await groupCheckbox.check();
    await expect(groupCheckbox).toBeChecked();
    await page.locator('[data-group-id="2"] > summary').click();
    await page.locator('[data-group-id="2"] [data-row-id] input[type="checkbox"]').evaluateAll((checkboxes) => {
      for (const checkbox of checkboxes) (checkbox as HTMLInputElement).click();
    });
    await page.locator('[data-group-id="3"] > summary').click();
    await page.locator('[data-row-id="F-012"] input[type="checkbox"]').check();
    await page.locator('[data-row-id="F-013"] input[type="checkbox"]').check();
    await expect(page.getByTestId("selected-count")).toHaveText("13 / 133");
    await expect(page.getByTestId("selected-percent")).toContainText("9.8%");
    await page.locator('[data-row-id="F-012"] .note-box > summary').click();
    await page.locator('[data-row-id="F-012"] textarea').fill("Vajan täpsete kõverate jaoks.");
    await page.reload();
    await expect(page.getByTestId("selected-count")).toHaveText("13 / 133");
    await page.locator('[data-group-id="3"] > summary').click();
    await page.locator('[data-row-id="F-012"] .note-box > summary').click();
    await expect(page.locator('[data-row-id="F-012"] textarea')).toHaveValue("Vajan täpsete kõverate jaoks.");
  });

  test("validates imported JSON and remains keyboard usable", async ({ page }) => {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Liigu funktsioonide juurde" })).toBeFocused();
    await page.getByRole("button", { name: "Impordi JSON" }).click();
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, selectedRowIds: ["F-999"] })),
    });
    await expect(page.getByRole("status")).toContainText("Import ebaõnnestus");
  });

  test("imports a valid selection with notes and remains usable at 200 percent equivalent", async ({ page }) => {
    const payload = {
      schemaVersion: 1,
      benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
      selectedRowIds: ["F-001", "F-061", "F-133"],
      visualProfile: "autocad-familiar-clean",
      unselectedMode: "visible-disabled",
      primaryViewport: { width: 1920, height: 1080, input: "mouse-keyboard" },
      exportedAt: "2026-08-31T10:00:00.000Z",
      localNotes: { "F-061": "Põhimõõdud on vajalikud." },
    };
    await page.locator('input[type="file"]').setInputFiles({
      name: "kuubik-draw-reio-scope-v1.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(payload)),
    });
    await expect(page.getByTestId("selected-count")).toHaveText("3 / 133");
    await page.getByRole("button", { name: "Valitud", exact: true }).click();
    await expect(page.locator("[data-row-id]")).toHaveCount(3);
    await page.setViewportSize({ width: 960, height: 540 });
    await expect(page.getByRole("heading", { name: "Vali ainult see, mida sul päriselt vaja on." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ekspordi JSON" })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
  });
});
