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
    "ribbon-tabs": { x: 0, y: 30, width: 1920, height: 22 },
    ribbon: { x: 0, y: 52, width: 1920, height: 99 },
    "document-tabs": { x: 0, y: 151, width: 1920, height: 30 },
    "command-line": { x: 688, y: 985, width: 600, height: 50 },
    "layout-status": { x: 0, y: 1043, width: 1920, height: 37 },
    statusbar: { x: 1260, y: 1047, width: 660, height: 32 },
  });
  expect((zones as Record<string, { x: number; width: number; height: number }>)["properties-palette"]).toMatchObject({ x: 0, width: 680 });
  const ribbonTabs = await page.locator("[data-ribbon-tab]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [element.getAttribute("data-ribbon-tab"), {
      x: rect.x, width: rect.width, right: rect.right, height: rect.height,
      backgroundColor: getComputedStyle(element).backgroundColor,
    }];
  })));
  expect(ribbonTabs).toEqual({
    home: { x: 0, width: 55, right: 55, height: 21, backgroundColor: "rgb(59, 68, 83)" },
    insert: { x: 55, width: 52, right: 107, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    annotate: { x: 107, width: 71, right: 178, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    parametric: { x: 178, width: 86, right: 264, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    view: { x: 264, width: 49, right: 313, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    manage: { x: 313, width: 64, right: 377, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    output: { x: 377, width: 62, right: 439, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    "add-ins": { x: 439, width: 63, right: 502, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    collaborate: { x: 502, width: 85, right: 587, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    "express-tools": { x: 587, width: 87, right: 674, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    "featured-apps": { x: 674, width: 106, right: 780, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
    prodlib: { x: 780, width: 65, right: 845, height: 21, backgroundColor: "rgba(0, 0, 0, 0)" },
  });
  const documentTabs = await page.locator("[data-document-tab]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [element.getAttribute("data-document-tab"), {
      x: rect.x, width: rect.width, right: rect.right, height: rect.height,
      backgroundColor: getComputedStyle(element).backgroundColor,
    }];
  })));
  expect(documentTabs).toEqual({
    menu: { x: 0, width: 42, right: 42, height: 26, backgroundColor: "rgba(0, 0, 0, 0)" },
    start: { x: 42, width: 48, right: 90, height: 26, backgroundColor: "rgba(0, 0, 0, 0)" },
    drawing: { x: 90, width: 95, right: 185, height: 26, backgroundColor: "rgb(59, 68, 83)" },
    new: { x: 185, width: 47, right: 232, height: 26, backgroundColor: "rgba(0, 0, 0, 0)" },
  });
  const titleChrome = await page.locator(".titlebar").evaluate((element) => {
    const box = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector)!;
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      backgroundColor: getComputedStyle(element).backgroundColor,
      applicationMark: box(".application-mark"),
      quickAccess: box(".quick-access"),
      workspace: box(".workspace-name"),
      displayControls: box(".title-display-controls"),
    };
  });
  expect(titleChrome).toMatchObject({
    backgroundColor: "rgb(34, 41, 51)",
    applicationMark: { x: 15, y: 3, width: 24, height: 24 },
    workspace: { x: 574, y: 3, width: 180, height: 24 },
    displayControls: { x: 760, y: 3, width: 84, height: 24 },
  });
  const bottomChrome = await page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
        backgroundColor: style.backgroundColor,
        borderTopColor: style.borderTopColor,
        borderTopWidth: style.borderTopWidth,
        borderBottomColor: style.borderBottomColor,
        borderBottomWidth: style.borderBottomWidth,
      };
    };
    return {
      layoutStatus: measure(".layoutbar"),
      statusbar: measure(".statusbar"),
      commandLine: measure(".command-line"),
    };
  });
  expect(bottomChrome).toEqual({
    layoutStatus: {
      x: 0, y: 1043, width: 1920, height: 37, right: 1920, bottom: 1080,
      backgroundColor: "rgb(34, 41, 51)", borderTopColor: "rgb(59, 68, 83)", borderTopWidth: "4px",
      borderBottomColor: "rgb(6, 150, 215)", borderBottomWidth: "1px",
    },
    statusbar: {
      x: 1260, y: 1047, width: 660, height: 32, right: 1920, bottom: 1079,
      backgroundColor: "rgba(0, 0, 0, 0)", borderTopColor: "rgb(17, 22, 27)", borderTopWidth: "0px",
      borderBottomColor: "rgb(6, 150, 215)", borderBottomWidth: "1px",
    },
    commandLine: {
      x: 688, y: 985, width: 600, height: 50, right: 1288, bottom: 1035,
      backgroundColor: "rgba(34, 41, 51, 0.96)", borderTopColor: "rgb(78, 90, 104)", borderTopWidth: "1px",
      borderBottomColor: "rgb(78, 90, 104)", borderBottomWidth: "1px",
    },
  });
  const statusControls = await page.locator("[data-status-control]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const control = element as HTMLButtonElement;
    const rect = control.getBoundingClientRect();
    return [element.getAttribute("data-status-control"), {
      x: rect.x, width: rect.width, height: rect.height, disabled: control.disabled,
      pressed: element.getAttribute("aria-pressed"), color: getComputedStyle(element).color,
      backgroundColor: getComputedStyle(element).backgroundColor,
    }];
  })));
  expect(statusControls.grid).toMatchObject({ disabled: false, pressed: "true", height: 30, backgroundColor: "rgb(23, 106, 153)" });
  for (const name of ["ortho", "osnap", "otrack", "dyn"]) {
    expect(statusControls[name]).toMatchObject({ disabled: true, pressed: null, height: 30, color: "rgb(120, 130, 139)", backgroundColor: "rgba(0, 0, 0, 0)" });
  }
  await expect(page.getByRole("button", { name: "Kiirpääsu DXF avamine" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu KDraw salvestamine" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu DXF-väljund" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu uus joonis unavailable" })).toBeDisabled();
  const palette = page.getByRole("complementary", { name: "Properties palette" });
  await expect(palette.getByRole("complementary", { name: "Layer filters" })).toBeVisible();
  await expect(palette.getByRole("row").first().locator("span")).toHaveCount(7);
  await expect(palette.getByText("Linetype scale")).toBeVisible();
  await expect(palette.getByText("Transparency")).toBeVisible();
  const ribbonPrimary = await page.getByLabel("Home ribbon").evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(ribbonPrimary.scrollWidth).toBeLessThanOrEqual(ribbonPrimary.clientWidth);
  const ribbonPanels = await page.locator("[data-ribbon-panel]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [element.getAttribute("data-ribbon-panel"), {
      x: rect.x,
      width: rect.width,
      right: rect.right,
      height: rect.height,
      backgroundColor: getComputedStyle(element).backgroundColor,
    }];
  })));
  expect(ribbonPanels).toEqual({
    draw: { x: 0, width: 225, right: 225, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    modify: { x: 225, width: 250, right: 475, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    annotation: { x: 475, width: 189, right: 664, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    layers: { x: 664, width: 273, right: 937, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    block: { x: 937, width: 161, right: 1098, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    properties: { x: 1098, width: 262, right: 1360, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    groups: { x: 1360, width: 72, right: 1432, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    utilities: { x: 1432, width: 97, right: 1529, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    clipboard: { x: 1529, width: 91, right: 1620, height: 99, backgroundColor: "rgb(59, 68, 83)" },
    view: { x: 1620, width: 53, right: 1673, height: 99, backgroundColor: "rgb(59, 68, 83)" },
  });
  const commandPanel = await page.getByLabel("Käsu parameetrid").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width, right: rect.right, height: rect.height, backgroundColor: getComputedStyle(element).backgroundColor };
  });
  expect(commandPanel).toEqual({ x: 1673, width: 247, right: 1920, height: 99, backgroundColor: "rgb(59, 68, 83)" });
  const disabledRibbonTool = page.getByRole("button", { name: "Ribbon Polyline unavailable" });
  await expect(disabledRibbonTool).toBeDisabled();
  const disabledRibbonState = await disabledRibbonTool.evaluate((element) => ({
    color: getComputedStyle(element).color,
    backgroundColor: getComputedStyle(element).backgroundColor,
  }));
  const lineRibbonTool = page.getByRole("button", { name: "Ribbon Line command" });
  await lineRibbonTool.hover();
  const hoverRibbonState = await lineRibbonTool.evaluate((element) => ({
    color: getComputedStyle(element).color,
    backgroundColor: getComputedStyle(element).backgroundColor,
    borderColor: getComputedStyle(element).borderColor,
  }));
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
  const modelDisplayReadback = await modelCanvas.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true })!;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    const pixel = (x: number, y: number) => {
      const offset = (y * element.width + x) * 4;
      return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!] as const;
    };
    const runs = (axis: "x" | "y", fixed: number, start: number, end: number) => {
      const hits: number[] = [];
      for (let value = start; value <= end; value += 1) {
        const rgba = axis === "x" ? pixel(value, fixed) : pixel(fixed, value);
        if (rgba[3] >= 32) hits.push(value);
      }
      const output: Array<[number, number]> = [];
      for (const value of hits) {
        const last = output.at(-1);
        if (last && value <= last[1] + 1) last[1] = value;
        else output.push([value, value]);
      }
      return output;
    };
    return {
      cssBackground: getComputedStyle(element).backgroundColor,
      verticalGridRuns: runs("x", 219, 680, element.width - 1),
      horizontalGridRuns: runs("y", 700, 0, element.height - 1),
      clearPixelRgba: pixel(700, 20),
      majorGridPixelRgba: pixel(742, 219),
    };
  });
  expect(modelDisplayReadback.cssBackground).toBe("rgb(255, 255, 255)");
  expect(modelDisplayReadback.verticalGridRuns).toHaveLength(7);
  modelDisplayReadback.verticalGridRuns.map(([start, end]) => Math.round((start + end) / 2)).forEach((center, index) => {
    expect(Math.abs(center - [743, 918, 1093, 1268, 1444, 1619, 1794][index]!)).toBeLessThanOrEqual(1);
  });
  expect(modelDisplayReadback.horizontalGridRuns).toHaveLength(5);
  modelDisplayReadback.horizontalGridRuns.map(([start, end]) => Math.round((start + end) / 2)).forEach((center, index) => {
    expect(Math.abs(center - [147, 322, 498, 673, 848][index]!)).toBeLessThanOrEqual(1);
  });
  expect(modelDisplayReadback.clearPixelRgba[3]).toBe(0);
  expect(modelDisplayReadback.majorGridPixelRgba[3]).toBeGreaterThan(200);
  await page.getByRole("navigation", { name: "Ribbon vahelehed" }).hover();
  await expect(crosshair).toBeHidden();

  if (captureRoot) {
    await mkdir(captureRoot, { recursive: true });
    await writeFile(resolve(captureRoot, "visual-shell-empty-workspace.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-zones.json"), `${JSON.stringify({ viewport: [1920, 1080], zones, consoleErrors }, null, 2)}\n`, "utf8");
  }

  await lineRibbonTool.click();
  await expect(lineRibbonTool).toHaveAttribute("aria-pressed", "true");
  const activeRibbonState = await lineRibbonTool.evaluate((element) => ({
    color: getComputedStyle(element).color,
    backgroundColor: getComputedStyle(element).backgroundColor,
    borderColor: getComputedStyle(element).borderColor,
  }));
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
  expect(layoutGeometry.layoutbar.height).toBe(37);
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
        topChrome: {
          title: titleChrome,
          ribbonTabs,
          documentTabs,
        },
        bottomChrome,
        statusControls,
        ribbon: {
          panels: ribbonPanels,
          commandPanel,
          disabled: disabledRibbonState,
          hover: hoverRibbonState,
          active: activeRibbonState,
        },
        modelNavigation,
        modelDisplayReadback,
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
