import { expect, type Page } from "@playwright/test";

/** Clears the current model selection through the same visible UI available to a user. */
export async function clearModelSelection(page: Page): Promise<void> {
  await page.getByLabel("Kuubik Draw joonestusala").click({ button: "right", position: { x: 900, y: 300 } });
  const menu = page.getByRole("menu", { name: "Drawing context menu" });
  const deselect = menu.getByRole("menuitem", { name: /Deselect All/u });
  await expect(deselect).toBeEnabled();
  await deselect.click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("No selection").first()).toBeVisible();
}
