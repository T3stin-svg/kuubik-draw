import { expect, type Page } from "@playwright/test";

export async function openLayoutTools(page: Page): Promise<void> {
  const tools = page.getByTestId("layout-tools");
  if (!await tools.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await page.getByLabel("Layout tools").click();
  }
  await expect(tools).toHaveAttribute("open", "");
}
