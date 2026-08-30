import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const captureRoot = process.env.PARITY_CAPTURE_DIR;

test("AutoCAD-style shell keeps all eight primary zones visible at 1920x1080", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  await expect(page.getByRole("navigation", { name: "Ribbon vahelehed" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Käsurida" })).toBeVisible();

  const zones = await page.locator("[data-visual-zone]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [element.getAttribute("data-visual-zone"), {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    }];
  })));
  expect(zones).toMatchObject({
    titlebar: { x: 0, y: 0, width: 1920, height: 30 },
    "ribbon-tabs": { x: 0, y: 30, width: 1920, height: 29 },
    ribbon: { x: 0, y: 59, width: 1920, height: 92 },
    "document-tabs": { x: 0, y: 151, width: 1920, height: 30 },
    "command-line": { x: 0, width: 1920, height: 52 },
    statusbar: { x: 0, width: 1920, height: 24 },
  });
  expect((zones as Record<string, { x: number; width: number; height: number }>)["properties-palette"]).toMatchObject({ x: 0, width: 680 });
  const palette = page.getByRole("complementary", { name: "Properties palette" });
  await expect(palette.getByRole("complementary", { name: "Layer filters" })).toBeVisible();
  await expect(palette.getByRole("row").first().locator("span")).toHaveCount(7);
  await expect(palette.getByText("Linetype scale")).toBeVisible();
  await expect(palette.getByText("Transparency")).toBeVisible();
  const ribbonPrimary = await page.getByLabel("Home ribbon").evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(ribbonPrimary.scrollWidth).toBeLessThanOrEqual(ribbonPrimary.clientWidth);

  if (captureRoot) {
    await mkdir(captureRoot, { recursive: true });
    await writeFile(resolve(captureRoot, "visual-shell-empty-workspace.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-zones.json"), `${JSON.stringify({ viewport: [1920, 1080], zones, consoleErrors }, null, 2)}\n`, "utf8");
  }

  await page.getByRole("button", { name: "Ribbon Line command" }).click();
  await expect(page.getByRole("button", { name: "Ribbon Line command" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("LINE Specify first point")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-active-command.png"), await page.screenshot());

  await page.reload();
  await page.getByLabel("Esimene nurk").fill("100,100");
  await page.getByLabel("Teine nurk").fill("900,600");
  await page.getByRole("button", { name: "RECTANGLE", exact: true }).click();
  await page.getByRole("button", { name: "Vali kõik", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("1 selected")).toBeVisible();
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-selected-handles", /.+/);
  const selectionPixels = await page.getByLabel("Kuubik Draw joonestusala").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! < 110 && pixels[index + 1]! > 120 && pixels[index + 2]! > 180 && pixels[index + 3]! > 220) count += 1;
    }
    return count;
  });
  expect(selectionPixels).toBeGreaterThan(150);
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-selected-properties.png"), await page.screenshot());

  await page.getByRole("button", { name: "Uus kiht", exact: true }).click();
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText("Layer 1")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layer-manager.png"), await page.screenshot());

  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await page.getByRole("button", { name: "Layout 1", exact: true }).click();
  await expect(page.getByTestId("paper-space-sheet")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layout-paper-space.png"), await page.screenshot());

  await page.getByRole("button", { name: "Ava käsuajalugu" }).click();
  await expect(page.getByRole("log", { name: "Käsuajalugu" })).toBeVisible();
  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-shell-command-history.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-states.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      states: {
        emptyWorkspace: true,
        activeDrawingCommand: true,
        selectedProperties: true,
        selectionPixels,
        layerManagerRows: await page.getByRole("table", { name: "Kihtide loend" }).getByRole("row").count(),
        layoutPaperSpace: await page.getByTestId("paper-space-sheet").isVisible(),
        commandHistory: await page.getByRole("log", { name: "Käsuajalugu" }).isVisible(),
      },
      consoleErrors,
    }, null, 2)}\n`, "utf8");
  }
  expect(consoleErrors).toEqual([]);
});
