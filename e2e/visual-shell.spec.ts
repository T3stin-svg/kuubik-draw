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
  const modelCanvas = page.getByLabel("Kuubik Draw joonestusala");
  const gridToggle = page.getByRole("button", { name: "Grid display" });
  await expect(gridToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("view-orientation-indicator")).toBeVisible();
  const canvasInkPixels = () => modelCanvas.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) count += 1;
    return count;
  });
  const gridInkPixels = await canvasInkPixels();
  expect(gridInkPixels).toBeGreaterThan(5_000);
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(canvasInkPixels).toBe(0);
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(canvasInkPixels).toBeGreaterThan(5_000);
  await modelCanvas.hover({ position: { x: 1200, y: 320 } });
  const crosshair = page.getByTestId("cad-crosshair");
  await expect(crosshair).toBeVisible();
  await expect(page.getByTestId("coordinate-readout")).not.toHaveText("0.0000, 0.0000, 0.0000");
  const modelNavigation = {
    gridInkPixels,
    gridPressed: await gridToggle.getAttribute("aria-pressed"),
    crosshairWorld: {
      x: await crosshair.getAttribute("data-world-x"),
      y: await crosshair.getAttribute("data-world-y"),
    },
    coordinateReadout: await page.getByTestId("coordinate-readout").textContent(),
    viewIndicator: await page.getByTestId("view-orientation-indicator").getAttribute("aria-label"),
  };
  await page.getByRole("navigation", { name: "Ribbon vahelehed" }).hover();
  await expect(crosshair).toBeHidden();

  if (captureRoot) {
    await mkdir(captureRoot, { recursive: true });
    await writeFile(resolve(captureRoot, "visual-shell-empty-workspace.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-zones.json"), `${JSON.stringify({ viewport: [1920, 1080], zones, consoleErrors }, null, 2)}\n`, "utf8");
  }

  await page.getByRole("button", { name: "Ribbon Line command" }).click();
  await expect(page.getByRole("button", { name: "Ribbon Line command" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("LINE Specify first point")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-active-command.png"), await page.screenshot());

  await modelCanvas.click({ button: "right", position: { x: 1200, y: 320 } });
  const activeContextMenu = page.getByRole("menu", { name: "Drawing context menu" });
  const cancelLine = activeContextMenu.getByRole("menuitem", { name: /Cancel LINE/u });
  const unavailableQuickSelect = activeContextMenu.getByRole("menuitem", { name: "Quick Select…" });
  await expect(activeContextMenu).toBeVisible();
  await expect(cancelLine).toBeEnabled();
  await expect(cancelLine).toBeFocused();
  await expect(unavailableQuickSelect).toBeDisabled();
  const contextMenuGeometry = await activeContextMenu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const firstItem = element.querySelector<HTMLElement>('[role="menuitem"]')!;
    const separator = element.querySelector<HTMLElement>('[role="separator"]')!;
    const disabledItem = element.querySelector<HTMLButtonElement>('[role="menuitem"]:disabled')!;
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      itemHeight: firstItem.getBoundingClientRect().height,
      separatorHeight: separator.getBoundingClientRect().height,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      disabledColor: getComputedStyle(disabledItem).color,
    };
  });
  expect(contextMenuGeometry).toMatchObject({
    x: 1200, y: 501, width: 200, height: 371,
    itemHeight: 20.5, separatorHeight: 1,
    backgroundColor: "rgb(240, 240, 240)",
    borderColor: "rgb(160, 160, 160)",
    disabledColor: "rgb(160, 160, 160)",
  });
  await cancelLine.hover();
  await expect.poll(() => cancelLine.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(204, 232, 255)");
  await page.keyboard.press("End");
  await expect(activeContextMenu.getByRole("menuitem", { name: /Properties/u })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(activeContextMenu).toBeHidden();
  await expect(page.getByRole("button", { name: "Ribbon Line command" })).toHaveAttribute("aria-pressed", "true");
  await modelCanvas.click({ button: "right", position: { x: 1200, y: 320 } });
  await page.getByRole("menu", { name: "Drawing context menu" }).getByRole("menuitem", { name: /Cancel LINE/u }).click();
  await expect(page.getByRole("button", { name: "Ribbon Line command" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Command: *Cancel* (LINE)")).toBeVisible();

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
  await page.getByLabel("Kuubik Draw joonestusala").hover({ position: { x: 1200, y: 320 } });
  await expect(page.getByTestId("cad-crosshair")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-selected-properties.png"), await page.screenshot());

  await page.getByLabel("Kuubik Draw joonestusala").click({ button: "right", position: { x: 1200, y: 320 } });
  const selectedContextMenu = page.getByRole("menu", { name: "Drawing context menu" });
  await expect(selectedContextMenu.getByRole("menuitem", { name: "Repeat last command" })).toBeDisabled();
  await expect(selectedContextMenu.getByRole("menuitem", { name: /Erase/u })).toBeEnabled();
  await expect(selectedContextMenu.getByRole("menuitem", { name: /Deselect All/u })).toBeEnabled();
  const propertiesMenuItem = selectedContextMenu.getByRole("menuitem", { name: /Properties/u });
  await propertiesMenuItem.hover();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-context-menu.png"), await page.screenshot());
  await page.keyboard.press("Escape");
  await expect(selectedContextMenu).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("1 selected")).toBeVisible();
  await page.getByLabel("Kuubik Draw joonestusala").click({ button: "right", position: { x: 1200, y: 320 } });
  await page.getByRole("menu", { name: "Drawing context menu" }).getByRole("menuitem", { name: "Count" }).click();
  await expect(page.getByText("Count: 1 object")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: "Uus kiht", exact: true }).click();
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText("Layer 1")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layer-manager.png"), await page.screenshot());

  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await page.getByRole("button", { name: "Layout 1", exact: true }).click();
  await expect(page.getByTestId("paper-space-sheet")).toBeVisible();
  const layoutTools = page.getByTestId("layout-tools");
  await expect(layoutTools).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("page-setup-controls")).toBeHidden();
  await expect(page.getByTestId("paper-printable-area")).toBeVisible();
  const layoutGeometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    return {
      desk: bounds("[data-testid='paper-space-desk']"),
      sheet: bounds("[data-testid='paper-space-sheet']"),
      printable: bounds("[data-testid='paper-printable-area']"),
      palette: bounds(".layer-manager"),
      layoutbar: bounds(".layoutbar"),
    };
  });
  expect(layoutGeometry.desk.x).toBe(0);
  expect(layoutGeometry.desk.width).toBe(1920);
  expect(layoutGeometry.sheet.x).toBeGreaterThanOrEqual(layoutGeometry.palette.right + 20);
  expect(layoutGeometry.sheet.width / layoutGeometry.sheet.height).toBeCloseTo(297 / 210, 3);
  expect(layoutGeometry.printable.x).toBeGreaterThan(layoutGeometry.sheet.x);
  expect(layoutGeometry.printable.right).toBeLessThan(layoutGeometry.sheet.right);
  expect(layoutGeometry.printable.y).toBeGreaterThan(layoutGeometry.sheet.y);
  expect(layoutGeometry.printable.bottom).toBeLessThan(layoutGeometry.sheet.bottom);
  expect(layoutGeometry.layoutbar.height).toBe(30);
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layout-paper-space.png"), await page.screenshot());
  await page.getByLabel("Layout tools").click();
  await expect(layoutTools).toHaveAttribute("open", "");
  await expect(page.getByTestId("page-setup-controls")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layout-tools-open.png"), await page.screenshot());
  await page.getByLabel("Layout tools").click();
  await expect(layoutTools).not.toHaveAttribute("open", "");

  await page.keyboard.press("F2");
  const commandTextWindow = page.getByTestId("command-text-window");
  await expect(commandTextWindow).toBeVisible();
  await expect(page.getByRole("log", { name: "Käsuajalugu" })).toBeVisible();
  const commandHistoryGeometry = await commandTextWindow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const titlebarElement = element.querySelector<HTMLElement>(".command-text-titlebar")!;
    const menubarElement = element.querySelector<HTMLElement>(".command-text-menubar")!;
    const logElement = element.querySelector<HTMLElement>(".command-text-log")!;
    const promptElement = element.querySelector<HTMLElement>(".command-text-prompt")!;
    const titlebar = titlebarElement.getBoundingClientRect();
    const menubar = menubarElement.getBoundingClientRect();
    const log = logElement.getBoundingClientRect();
    const prompt = promptElement.getBoundingClientRect();
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      titlebarHeight: titlebar.height, menubarHeight: menubar.height, promptHeight: prompt.height,
      backgroundColor: style.backgroundColor,
      contentTop: log.y, contentBottom: log.bottom, promptTop: prompt.y,
      titlebarBackgroundColor: getComputedStyle(titlebarElement).backgroundColor,
      menubarBackgroundColor: getComputedStyle(menubarElement).backgroundColor,
      contentBackgroundColor: getComputedStyle(logElement).backgroundColor,
      promptBackgroundColor: getComputedStyle(promptElement).backgroundColor,
    };
  });
  expect(commandHistoryGeometry).toMatchObject({
    x: 0, y: 0, width: 1920, height: 1080,
    titlebarHeight: 30, menubarHeight: 22, promptHeight: 28,
    backgroundColor: "rgb(200, 200, 200)",
    contentTop: 53, contentBottom: 1051, promptTop: 1051,
    titlebarBackgroundColor: "rgb(255, 255, 255)",
    menubarBackgroundColor: "rgb(255, 255, 255)",
    contentBackgroundColor: "rgb(200, 200, 200)",
    promptBackgroundColor: "rgb(255, 255, 255)",
  });
  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-shell-command-history.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-states.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      states: {
        emptyWorkspace: true,
        activeDrawingCommand: true,
        modelNavigation,
        selectedProperties: true,
        selectionPixels,
        contextMenu: {
          activeCommand: true,
          selectedObject: true,
          keyboardNavigation: true,
          escapeDismissalPreservesCommandAndSelection: true,
          cancelAction: true,
          countAction: true,
          geometry: contextMenuGeometry,
        },
        layerManagerRows: await page.getByRole("table", { name: "Kihtide loend" }).getByRole("row").count(),
        layoutPaperSpace: await page.getByTestId("paper-space-sheet").isVisible(),
        layoutGeometry,
        layoutTools: { compactByDefault: true, openStateVerified: true, pageSetupStillReachable: true },
        commandHistory: await page.getByRole("log", { name: "Käsuajalugu" }).isVisible(),
        commandHistoryGeometry,
      },
      consoleErrors,
    }, null, 2)}\n`, "utf8");
  }
  await page.keyboard.press("Escape");
  await expect(commandTextWindow).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
