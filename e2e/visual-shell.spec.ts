import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "../packages/cad-core/src/index.js";
import { exportDxf } from "../packages/cad-dxf/src/index.js";

const captureRoot = process.env.PARITY_CAPTURE_DIR;

async function answerLivePrompt(page: Page, value: string): Promise<void> {
  const prompt = page.getByTestId("live-command-prompt");
  const kind = await prompt.getAttribute("data-kind");
  const control = prompt.locator("input, select");
  if (kind === "select") await control.selectOption(value);
  else await control.fill(value);
  await prompt.locator(".live-command-next").click();
}

async function answerExpectedLivePrompt(page: Page, field: string, value: string): Promise<void> {
  await expect(page.getByTestId("live-command-prompt")).toHaveAttribute("data-field", field);
  await answerLivePrompt(page, value);
}

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
    "command-line": { x: 468, y: 985, width: 600, height: 50 },
    "layout-status": { x: 0, y: 1043, width: 1920, height: 37 },
    statusbar: { x: 1260, y: 1047, width: 660, height: 32 },
  });
  expect((zones as Record<string, { x: number; width: number; height: number }>)["properties-palette"]).toMatchObject({ x: 0, width: 460 });
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
    drawing: { x: 90, width: 118, right: 208, height: 26, backgroundColor: "rgb(59, 68, 83)" },
    new: { x: 208, width: 47, right: 255, height: 26, backgroundColor: "rgba(0, 0, 0, 0)" },
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
      x: 468, y: 985, width: 600, height: 50, right: 1068, bottom: 1035,
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
  expect(statusControls.ortho).toMatchObject({ disabled: false, pressed: "false", height: 30, backgroundColor: "rgba(0, 0, 0, 0)" });
  for (const name of ["osnap", "otrack", "dyn"]) expect(statusControls[name]).toMatchObject({ disabled: false, pressed: "true", height: 30, backgroundColor: "rgb(23, 106, 153)" });
  await expect(page.getByRole("button", { name: "ORTHO precision mode" })).toHaveAttribute("data-scope-selected", "true");
  await expect(page.getByRole("button", { name: "ORTHO precision mode" })).toHaveAttribute("title", /päris precision runtime/u);
  await expect(page.getByRole("button", { name: "Kiirpääsu DXF avamine" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu KDraw salvestamine" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu DXF-väljund" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Kiirpääsu uus joonis unavailable" })).toBeDisabled();
  const palette = page.getByRole("complementary", { name: "Properties palette" });
  await expect(palette.getByRole("complementary", { name: "Layer filters" })).toBeVisible();
  await expect(palette.getByRole("row").first().locator("span")).toHaveCount(10);
  await expect(palette.getByText("Linetype scale")).toBeVisible();
  await expect(palette.getByRole("term").filter({ hasText: "Transparency" })).toBeVisible();
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
  const disabledRibbonTool = page.getByRole("button", { name: "Ribbon Match properties unavailable" });
  await expect(disabledRibbonTool).toBeDisabled();
  await expect(disabledRibbonTool).toHaveAttribute("data-scope-selected", "false");
  await expect(disabledRibbonTool).toHaveAttribute("title", /Pole sinu töövoogu valitud/u);
  const selectedWithoutAdapter = page.getByRole("button", { name: "Ribbon Insert block command" });
  await expect(selectedWithoutAdapter).toBeEnabled();
  await expect(selectedWithoutAdapter).toHaveAttribute("data-scope-selected", "true");
  await expect(selectedWithoutAdapter).toHaveAttribute("title", /Valitud sinu töövoogu/u);
  await expect(selectedWithoutAdapter).toHaveAttribute("data-feature-row", "F-088");
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
  const gridToggle = page.getByRole("button", { name: "GRID precision mode" });
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
  const selectedSceneViewport = await modelCanvas.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return {
      width: element.clientWidth,
      height: element.clientHeight,
      worldCenter: {
        x: Number(element.dataset.worldCenterX),
        y: Number(element.dataset.worldCenterY),
      },
      worldUnitsPerPixel: Number(element.dataset.worldUnitsPerPixel),
    };
  });
  expect(selectedSceneViewport).toMatchObject({ width: 1920, height: 862 });
  expect(Number.isFinite(selectedSceneViewport.worldCenter.x)).toBe(true);
  expect(Number.isFinite(selectedSceneViewport.worldCenter.y)).toBe(true);
  expect(selectedSceneViewport.worldUnitsPerPixel).toBeGreaterThan(0);
  const selectedSceneWorldPoint = (x: number, y: number) => ({
    x: selectedSceneViewport.worldCenter.x + (x - selectedSceneViewport.width / 2) * selectedSceneViewport.worldUnitsPerPixel,
    y: selectedSceneViewport.worldCenter.y - (y - selectedSceneViewport.height / 2) * selectedSceneViewport.worldUnitsPerPixel,
  });
  const selectedSceneDocument = createEmptyDocument({ documentId: "visual-shell-selected", now: "2026-08-31T01:00:00.000Z" });
  const outerTopLeft = selectedSceneWorldPoint(785, 195);
  const outerBottomRight = selectedSceneWorldPoint(1812, 811);
  const circleCenter = selectedSceneWorldPoint(1298, 503);
  const textInsertion = selectedSceneWorldPoint(1032, 134);
  selectedSceneDocument.entities = [
    {
      kind: "polyline", handle: "A1", layerId: "0", closed: true,
      vertices: [
        outerTopLeft,
        { x: outerBottomRight.x, y: outerTopLeft.y },
        outerBottomRight,
        { x: outerTopLeft.x, y: outerBottomRight.y },
      ],
    },
    {
      kind: "circle", handle: "A2", layerId: "0", center: circleCenter,
      radius: 123.5 * selectedSceneViewport.worldUnitsPerPixel,
    },
    {
      kind: "text", handle: "A3", layerId: "0", position: textInsertion,
      text: "KUUBIK AUDIT", height: 75 * selectedSceneViewport.worldUnitsPerPixel, rotationRad: 0,
    },
  ];
  const selectedSceneDxf = Buffer.from(exportDxf(selectedSceneDocument).bytes);
  await page.getByLabel("DXF import").setInputFiles({ name: "visual-shell-selected.dxf", mimeType: "application/dxf", buffer: selectedSceneDxf });
  await expect(page.getByText("DXF imporditud: 3 objekti · 1 kihti · mm")).toBeVisible();
  await page.getByRole("button", { name: "Vali kõik", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("3 selected")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("All (3)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-selected-handles", /.+/);
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-preview-command", "");
  const selectedFixture = await modelCanvas.evaluate(async (canvas) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<any>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    const element = canvas as HTMLCanvasElement;
    const center = { x: Number(element.dataset.worldCenterX), y: Number(element.dataset.worldCenterY) };
    const scale = Number(element.dataset.worldUnitsPerPixel);
    const project = (point: { x: number; y: number }) => ({
      x: (point.x - center.x) / scale + element.clientWidth / 2,
      y: (center.y - point.y) / scale + element.clientHeight / 2,
    });
    const polyline = document.entities.find((entity: any) => entity.kind === "polyline");
    const circle = document.entities.find((entity: any) => entity.kind === "circle");
    const text = document.entities.find((entity: any) => entity.kind === "text");
    return {
      entityKinds: document.entities.map((entity: any) => entity.kind).sort(),
      handles: document.entities.map((entity: any) => entity.handle).sort(),
      selectedHandles: (element.dataset.selectedHandles ?? "").split(",").filter(Boolean).sort(),
      polyline: { closed: polyline.closed, vertices: polyline.vertices.map(project) },
      circle: { center: project(circle.center), radiusPx: circle.radius / scale },
      text: { value: text.text, insertion: project(text.position), heightPx: text.height / scale },
    };
  });
  expect(selectedFixture.entityKinds).toEqual(["circle", "polyline", "text"]);
  expect(selectedFixture.handles).toEqual(["A1", "A2", "A3"]);
  expect(selectedFixture.selectedHandles).toEqual(["A1", "A2", "A3"]);
  expect(selectedFixture.polyline.closed).toBe(true);
  expect(selectedFixture.polyline.vertices[0]!.x).toBeCloseTo(785, 6);
  expect(selectedFixture.polyline.vertices[0]!.y).toBeCloseTo(195, 6);
  expect(selectedFixture.polyline.vertices[2]!.x).toBeCloseTo(1812, 6);
  expect(selectedFixture.polyline.vertices[2]!.y).toBeCloseTo(811, 6);
  expect(selectedFixture.circle.center.x).toBeCloseTo(1298, 6);
  expect(selectedFixture.circle.center.y).toBeCloseTo(503, 6);
  expect(selectedFixture.circle.radiusPx).toBeCloseTo(123.5, 6);
  expect(selectedFixture.text.value).toBe("KUUBIK AUDIT");
  expect(selectedFixture.text.insertion.x).toBeCloseTo(1032, 6);
  expect(selectedFixture.text.insertion.y).toBeCloseTo(134, 6);
  expect(selectedFixture.text.heightPx).toBeCloseTo(75, 6);
  const selectedPropertiesGeometry = await page.getByRole("complementary", { name: "Properties palette" }).evaluate((element) => {
    const bounds = (target: Element) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const background = (target: Element) => getComputedStyle(target).backgroundColor;
    const sections = Array.from(element.querySelectorAll<HTMLElement>(":scope > section:not(.layer-manager)"));
    const generalRows = Array.from(sections[0]!.querySelectorAll<HTMLElement>("dl > div"));
    const layerManager = element.querySelector<HTMLElement>(":scope > .layer-manager")!;
    const propertiesHeader = element.querySelector<HTMLElement>(":scope > header")!;
    const selectionSummary = element.querySelector<HTMLElement>(":scope > .properties-selection-summary")!;
    return {
      palette: bounds(element),
      layerManager: bounds(layerManager),
      propertiesHeader: bounds(propertiesHeader),
      selectionSummary: bounds(selectionSummary),
      generalHeader: bounds(sections[0]!.querySelector("h2")!),
      generalRows: generalRows.map(bounds),
      threeDHeader: bounds(sections[1]!.querySelector("h2")!),
      materialRow: bounds(sections[1]!.querySelector("dl > div")!),
      plotStyleHeader: bounds(sections[2]!.querySelector("h2")!),
      viewHeader: bounds(sections[3]!.querySelector("h2")!),
      dataHeader: bounds(sections[4]!.querySelector("h2")!),
      surfaces: {
        palette: background(element),
        layerHeader: background(layerManager.querySelector(":scope > header")!),
        layerCurrent: background(layerManager.querySelector(".layer-current")!),
        layerToolbar: background(layerManager.querySelector(".layer-toolbar")!),
        layerRail: background(layerManager.querySelector(".layer-filter-rail")!),
        layerGrid: background(layerManager.querySelector(".layer-grid")!),
        layerGridHeader: background(layerManager.querySelector(".layer-grid-header")!),
        layerActiveRow: background(layerManager.querySelector(".layer-grid-row.active")!),
        layerSummary: background(layerManager.querySelector(".layer-manager-summary")!),
        propertiesHeader: background(propertiesHeader),
        selectionSummary: background(selectionSummary),
        sectionHeader: background(sections[0]!.querySelector("h2")!),
        propertyName: background(generalRows[0]!.querySelector("dt")!),
        propertyValue: background(generalRows[0]!.querySelector("dd")!),
      },
    };
  });
  expect(selectedPropertiesGeometry).toMatchObject({
    palette: { x: 0, y: 181, width: 460, height: 862, bottom: 1043 },
    layerManager: { x: 0, y: 181, width: 458, height: 326, bottom: 507 },
    propertiesHeader: { x: 0, y: 507, width: 458, height: 20, bottom: 527 },
    selectionSummary: { x: 7, y: 531, width: 444, height: 22, bottom: 553 },
    generalHeader: { x: 0, y: 557, width: 458, height: 20, bottom: 577 },
    threeDHeader: { x: 0, y: 739, width: 458, height: 20, bottom: 759 },
    materialRow: { x: 0, y: 759, width: 458, height: 18, bottom: 777 },
    plotStyleHeader: { x: 0, y: 777, width: 458, height: 20, bottom: 797 },
    viewHeader: { x: 0, y: 797, width: 458, height: 20, bottom: 817 },
    dataHeader: { x: 0, y: 817, width: 458, height: 20, bottom: 837 },
  });
  expect(selectedPropertiesGeometry.generalRows).toHaveLength(9);
  expect(selectedPropertiesGeometry.generalRows.every(({ height }) => height === 18)).toBe(true);
  expect(selectedPropertiesGeometry.surfaces).toEqual({
    palette: "rgb(59, 68, 83)", layerHeader: "rgb(46, 52, 64)", layerCurrent: "rgb(59, 68, 83)", layerToolbar: "rgb(59, 68, 83)",
    layerRail: "rgb(59, 68, 83)", layerGrid: "rgb(59, 68, 83)", layerGridHeader: "rgb(69, 79, 97)",
    layerActiveRow: "rgb(116, 135, 165)", layerSummary: "rgb(59, 68, 83)", propertiesHeader: "rgb(46, 52, 64)",
    selectionSummary: "rgb(78, 90, 110)", sectionHeader: "rgb(46, 52, 64)", propertyName: "rgba(0, 0, 0, 0)",
    propertyValue: "rgb(59, 68, 83)",
  });
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
  const staleMovePreviewPixels = await page.getByLabel("Kuubik Draw joonestusala").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return -1;
    const pixels = context.getImageData(1424, 176, 11, 11).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 2]! - pixels[index]! > 15 && pixels[index + 2]! - pixels[index + 1]! > 5) count += 1;
    }
    return count;
  });
  expect(staleMovePreviewPixels).toBe(0);
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
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("3 selected")).toBeVisible();
  await page.getByLabel("Kuubik Draw joonestusala").click({ button: "right", position: { x: 1200, y: 320 } });
  await page.getByRole("menu", { name: "Drawing context menu" }).getByRole("menuitem", { name: "Count" }).click();
  await expect(page.getByText("Count: 3 objects")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("3 selected")).toBeVisible();

  await page.getByRole("button", { name: "Uus kiht", exact: true }).click();
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText("Layer 1")).toBeVisible();
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layer-manager.png"), await page.screenshot());

  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await page.getByRole("tab", { name: "Layout 1", exact: true }).click();
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
        selectedProperties: { visible: true, geometry: selectedPropertiesGeometry },
        selectedFixture,
        selectionPixels,
        staleMovePreviewPixels,
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

test("scoped shell persists workspace and palette states and remains accessible", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  const shell = page.locator(".app-shell");
  const palette = page.getByRole("complementary", { name: "Properties palette" });
  await expect(shell).toHaveAttribute("data-workspace", "drafting");
  await expect(shell).toHaveAttribute("data-scope-profile", "autocad-familiar-clean");
  await expect(page.getByRole("status").filter({ hasText: "Salvestus valmis" })).toBeVisible();
  await expect(palette).toHaveAttribute("data-dock", "docked");

  const scopedTools = page.locator(".ribbon [data-feature-row]");
  const scopedIconCount = await scopedTools.locator(".ribbon-glyph > svg").count();
  expect(scopedIconCount).toBe(await scopedTools.count());
  await expect(page.getByRole("button", { name: "Ribbon Polyline command" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Ribbon Insert block command" })).toBeEnabled();
  const unselected = page.getByRole("button", { name: "Ribbon Match properties unavailable" });
  await expect(unselected).toBeDisabled();
  await expect(unselected).toHaveAttribute("data-scope-selected", "false");
  await expect(unselected).toHaveAttribute("title", "Match properties · Pole sinu töövoogu valitud");

  await page.getByRole("button", { name: "Ujuta paletid" }).click();
  await expect(palette).toHaveAttribute("data-dock", "floating");
  const floating = await palette.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(floating).toEqual({ x: 28, y: 211, width: 520, height: 780 });

  await page.getByRole("button", { name: "Peida paletid automaatselt" }).click();
  await expect(palette).toHaveAttribute("data-dock", "auto-hide");
  await expect.poll(() => palette.evaluate((element) => element.getBoundingClientRect().width)).toBe(32);
  await page.getByRole("button", { name: "Doki paletid" }).click();
  await expect(palette).toHaveAttribute("data-dock", "docked");
  await expect.poll(() => palette.evaluate((element) => element.getBoundingClientRect().width)).toBe(460);

  const workspace = page.getByRole("combobox", { name: "Tööruum" });
  await workspace.selectOption("focus");
  await expect(shell).toHaveAttribute("data-workspace", "focus");
  const focusedPaletteTransform = await palette.evaluate((element) => getComputedStyle(element).transform);
  expect(focusedPaletteTransform).not.toBe("none");
  await workspace.selectOption("review");
  await expect(shell).toHaveAttribute("data-workspace", "review");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Tööruum" })).toHaveValue("review");
  await expect(page.getByRole("complementary", { name: "Properties palette" })).toHaveAttribute("data-dock", "docked");

  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Kiirpääsu DXF avamine" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Kiirpääsu KDraw salvestamine" })).toBeFocused();
  const focusOutline = await page.getByRole("button", { name: "Kiirpääsu KDraw salvestamine" }).evaluate((element) => ({
    width: getComputedStyle(element).outlineWidth,
    style: getComputedStyle(element).outlineStyle,
    color: getComputedStyle(element).outlineColor,
  }));
  expect(focusOutline).toMatchObject({ width: "2px", style: "solid", color: "rgb(112, 197, 244)" });

  const contrast = await page.evaluate(() => {
    const parse = (value: string) => value.match(/[\d.]+/gu)!.slice(0, 3).map(Number);
    const luminance = ([red, green, blue]: number[]) => [red!, green!, blue!]
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const ratio = (foreground: string, background: string) => {
      const first = luminance(parse(foreground));
      const second = luminance(parse(background));
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const line = document.querySelector<HTMLElement>("[data-feature-row='F-001']")!;
    const ribbon = document.querySelector<HTMLElement>(".ribbon")!;
    const title = document.querySelector<HTMLElement>(".product-badge")!;
    const titlebar = document.querySelector<HTMLElement>(".titlebar")!;
    return {
      ribbonText: ratio(getComputedStyle(line).color, getComputedStyle(ribbon).backgroundColor),
      productText: ratio(getComputedStyle(title).color, getComputedStyle(titlebar).backgroundColor),
    };
  });
  expect(contrast.ribbonText).toBeGreaterThanOrEqual(4.5);
  expect(contrast.productText).toBeGreaterThanOrEqual(4.5);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.locator(".command-caret").evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(reducedMotion.animationName).toBe("none");

  await page.setViewportSize({ width: 960, height: 540 });
  await expect(page.getByRole("navigation", { name: "Ribbon vahelehed" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Käsurida" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Joonise vahelehed" })).toBeVisible();
  const zoomAudit = await page.evaluate(() => ({
    effectiveViewport: [window.innerWidth, window.innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    statusbarHidden: getComputedStyle(document.querySelector<HTMLElement>(".statusbar")!).display === "none",
    ribbon: {
      clientWidth: document.querySelector<HTMLElement>(".ribbon")!.clientWidth,
      scrollWidth: document.querySelector<HTMLElement>(".ribbon")!.scrollWidth,
      overflowX: getComputedStyle(document.querySelector<HTMLElement>(".ribbon")!).overflowX,
    },
  }));
  expect(zoomAudit).toMatchObject({ effectiveViewport: [960, 540], scrollWidth: 960, scrollHeight: 540, statusbarHidden: true });
  expect(zoomAudit.ribbon.scrollWidth).toBeGreaterThan(zoomAudit.ribbon.clientWidth);
  expect(zoomAudit.ribbon.overflowX).toBe("auto");

  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-shell-200-percent.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-accessibility.json"), `${JSON.stringify({
      viewport100: [1920, 1080],
      effectiveViewport200: zoomAudit.effectiveViewport,
      floating,
      contrast,
      focusOutline,
      reducedMotion,
      consoleErrors,
    }, null, 2)}\n`, "utf8");
  }
  expect(consoleErrors).toEqual([]);
});

test("visual shell routes real runtime workflows without enabling unbound commands", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  const modelCanvas = page.getByLabel("Kuubik Draw joonestusala");
  const commandInput = page.getByRole("textbox", { name: "Command input" });
  await page.getByRole("button", { name: "Ribbon Line command" }).click();
  await expect(commandInput).toHaveValue("LINE ");
  await commandInput.fill("LINE 10,10 180,90");
  await commandInput.press("Enter");
  await expect(page.locator(".command-history")).toContainText("LINE runtime salvestatud");
  await expect(modelCanvas).toHaveAttribute("data-selected-handles", /.+/u);
  const committedLineHandle = await modelCanvas.getAttribute("data-selected-handles");
  expect(committedLineHandle).toBeTruthy();

  const undo = page.getByRole("button", { name: "Kiirpääsu Undo" });
  const redo = page.getByRole("button", { name: "Kiirpääsu Redo" });
  await undo.click();
  await expect(page.getByLabel("Käsu parameetrid")).toContainText("0 objekti");
  await redo.click();
  await expect(page.getByLabel("Käsu parameetrid")).toContainText("1 objekti");
  await expect(modelCanvas).toHaveAttribute("data-selected-handles", "");
  await page.waitForTimeout(50);

  await page.getByRole("button", { name: "Ribbon Polyline command" }).click();
  await expect(commandInput).toHaveValue("PLINE ");
  await commandInput.fill("PLINE 20,20 80,70 140,30");
  await expect(commandInput).toHaveValue("PLINE 20,20 80,70 140,30");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("PLINE runtime salvestatud");

  await page.getByRole("button", { name: "Ribbon Circle command" }).click();
  await commandInput.fill("CIRCLE 220,120 35");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("CIRCLE runtime salvestatud");

  await page.getByRole("button", { name: "Ribbon Arc command" }).click();
  await commandInput.fill("ARC 300,80 340,140 390,90");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("ARC runtime salvestatud");
  await expect(page.getByLabel("Käsu parameetrid")).toContainText("4 objekti");

  const grid = page.getByRole("button", { name: "GRID precision mode" });
  const ortho = page.getByRole("button", { name: "ORTHO precision mode" });
  await page.locator("body").focus();
  await page.keyboard.press("F8");
  await expect(ortho).toHaveAttribute("aria-pressed", "true");
  await commandInput.fill("GRID OFF");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await expect(ortho).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".command-history")).toContainText("PrecisionCommandState");
  await modelCanvas.hover({ position: { x: 900, y: 420 } });
  await expect(page.locator(".statusbar")).toHaveAttribute("data-precision-source", "ortho");

  const layerRows = page.locator("[data-layer-id]");
  await expect(layerRows).toHaveCount(1);
  await page.getByRole("button", { name: "Loo uus kiht" }).click();
  await expect(layerRows).toHaveCount(2);
  await expect(page.locator(".command-history")).toContainText("typed Layer Manageri kaudu");
  await expect(page.getByRole("button", { name: "Layer 1 lukustus" })).toBeEnabled();

  await page.getByRole("button", { name: "Mitmerealine tekst" }).click();
  await expect(commandInput).toHaveValue("MTEXT ");
  await commandInput.fill('MTEXT 60,180 6 "Kuubik märkus"');
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("MTEXT runtime salvestatud");
  await page.getByRole("button", { name: "Viitjoon" }).click();
  await commandInput.fill('LEADER 180,180 240,220 "Kontrollitud"');
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("LEADER runtime salvestatud");
  await expect(page.getByLabel("Käsu parameetrid")).toContainText("6 objekti");

  const blockPanelCommand = page.getByRole("button", { name: "Sisesta plokk" });
  await expect(blockPanelCommand).toBeEnabled();
  await expect(page.getByRole("button", { name: "Ribbon Insert block unavailable" })).toHaveAttribute("data-state-reason", "Käsk pole praeguses olekus saadaval");
  const disabledBlockState = await blockPanelCommand.getAttribute("title");

  await page.getByRole("button", { name: "Uus joonis", exact: true }).click();
  await expect(page.locator("[data-document-id]")).toHaveCount(2);
  await expect(page.locator("[data-document-id='drawing-2']")).toHaveClass(/active/u);
  await expect(page.locator(".command-history")).toContainText("ModelSpaceDocument + document-tabs");
  await page.getByRole("button", { name: "local.kdraw", exact: true }).click();
  await expect(page.locator("[data-document-id='local']")).toHaveClass(/active/u);
  await expect(page.getByLabel("Käsu parameetrid")).toContainText("6 objekti");
  await page.getByRole("button", { name: "Sulge drawing-2.kdraw" }).click();
  await expect(page.locator("[data-document-id]")).toHaveCount(1);

  const domReadback = await page.evaluate(() => ({
    commandAdapter: document.querySelector<HTMLInputElement>("[data-runtime-adapter='command-engine']")?.dataset.runtimeAdapter,
    precisionSource: document.querySelector<HTMLElement>(".statusbar")?.dataset.precisionSource,
    layerIds: [...document.querySelectorAll<HTMLElement>("[data-layer-id]")].map((element) => element.dataset.layerId),
    tabs: [...document.querySelectorAll<HTMLElement>("[data-document-id]")].map((element) => ({ id: element.dataset.documentId, active: element.classList.contains("active") })),
    revision: Number(document.querySelector<HTMLElement>(".runtime-intent-readback")?.dataset.runtimeRevision),
    entityKinds: document.querySelector<HTMLElement>(".runtime-intent-readback")?.dataset.runtimeEntityKinds?.split(","),
    disabledRibbonRows: [...document.querySelectorAll<HTMLButtonElement>(".ribbon [data-scope-selected='true']:disabled")].map((element) => element.dataset.featureRow),
  }));
  const readback = { ...domReadback, disabledBlockState };
  expect(readback).toMatchObject({
    commandAdapter: "command-engine",
    precisionSource: "ortho",
    layerIds: ["0", "layer-layer-1"],
    tabs: [{ id: "local", active: true }],
    revision: 9,
    entityKinds: ["line", "polyline", "circle", "arc", "mtext", "leader"],
    disabledRibbonRows: expect.not.arrayContaining(["F-061", "F-067", "F-088"]),
  });
  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-shell-runtime-integration.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-shell-runtime-integration.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      committedLineHandle,
      workflows: ["LINE", "UNDO", "REDO", "PLINE", "CIRCLE", "ARC", "F8_ORTHO", "GRID_COMMAND", "LAYER_CREATE", "MTEXT_COMMIT", "LEADER_COMMIT", "DOCUMENT_NEW", "DOCUMENT_ACTIVATE", "DOCUMENT_CLOSE"],
      readback,
      consoleErrors,
    }, null, 2)}\n`, "utf8");
  }
  expect(consoleErrors).toEqual([]);
});

test("Layer Manager wires F-072..F-079 and exposes fail-closed F-080/F-086 connections", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  await expect(page.getByRole("status").filter({ hasText: "Salvestus valmis" })).toBeVisible();

  const linetypeDocument = createEmptyDocument({ documentId: "layer-shell-linetype", now: "2026-08-31T12:00:00.000Z" });
  linetypeDocument.linetypes = [{ id: "hidden-ui", name: "HIDDEN_UI", description: "Layer shell audit", pattern: [12, -6] }];
  linetypeDocument.layers[0]!.appearance = { linetypeId: "hidden-ui" };
  linetypeDocument.entities = [{ kind: "line", handle: "LT1", layerId: "0", start: { x: -100, y: -100 }, end: { x: -50, y: -50 } }];
  await page.getByLabel("DXF import").setInputFiles({ name: "layer-shell-linetype.dxf", mimeType: "application/dxf", buffer: Buffer.from(exportDxf(linetypeDocument).bytes) });
  await expect(page.getByText(/DXF imporditud/u)).toBeVisible();

  const palette = page.getByRole("complementary", { name: "Properties palette" });
  const table = page.getByRole("table", { name: "Kihtide loend" });
  const operation = page.getByTestId("layer-operation-readback");
  const commandInput = page.getByRole("textbox", { name: "Command input" });
  let observedRevision = 0;
  const waitForLayerCommand = async (commandId: string) => {
    const expectedRevision = observedRevision + 1;
    await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-revision", String(expectedRevision));
    await expect(operation).toContainText(commandId);
    await expect(operation).toHaveAttribute("data-state", "idle");
    observedRevision = expectedRevision;
  };

  const front = page.getByRole("button", { name: "Too valitud objektid ette" });
  const back = page.getByRole("button", { name: "Saada valitud objektid taha" });
  await expect(front).toBeDisabled();
  await expect(back).toBeDisabled();
  await expect(back).toHaveAttribute("data-scope-selected", "true");
  await expect(back).toHaveAttribute("title", "Vali objektid; draw-order on fail-closed");

  await commandInput.fill("LINE 10,10 180,90");
  await commandInput.press("Enter");
  await commandInput.fill("LINE 20,120 220,30");
  await commandInput.press("Enter");
  await expect(back).toBeEnabled();
  observedRevision = Number(await page.locator(".runtime-intent-readback").getAttribute("data-runtime-revision"));
  const selectedHandle = await page.getByLabel("Kuubik Draw joonestusala").getAttribute("data-selected-handles");
  const orderBefore = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const stored = await new Promise<any>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return stored.entities.map((entity: any) => entity.handle);
  });
  await back.click();
  await waitForLayerCommand("DRAWORDER");
  const orderAfter = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const stored = await new Promise<any>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return stored.entities.map((entity: any) => entity.handle);
  });
  expect(orderAfter[0]).toBe(selectedHandle);
  expect(orderAfter.slice(1)).toEqual(orderBefore.slice(0, -1));

  await page.getByRole("combobox", { name: "0 värv" }).selectOption("#ff0000");
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await page.getByRole("combobox", { name: "0 joonetüüp" }).selectOption("");
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await page.getByRole("combobox", { name: "0 joonetüüp" }).selectOption({ index: 1 });
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await page.getByRole("combobox", { name: "0 joonepaksus" }).selectOption("0.35");
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await page.getByRole("combobox", { name: "0 läbipaistvus" }).selectOption("25");
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");

  const effectiveProperty = (name: string) => palette.locator("dt", { hasText: name }).locator("xpath=following-sibling::dd");
  await expect(effectiveProperty("Color")).toHaveAttribute("data-property-source", "layer");
  await expect(effectiveProperty("Color")).toHaveAttribute("data-effective-value", "#ff0000");
  await expect(effectiveProperty("Lineweight")).toHaveAttribute("data-effective-value", "0.35");
  await expect(effectiveProperty("Transparency")).toHaveAttribute("data-effective-value", "25");

  const zeroVisibility = page.getByRole("button", { name: "0 nähtavus" });
  await zeroVisibility.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await expect(zeroVisibility).toHaveAttribute("aria-pressed", "false");
  await zeroVisibility.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  const zeroLock = page.getByRole("button", { name: "0 lukustus" });
  await zeroLock.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await expect(page.locator(".ribbon [data-feature-row='F-001']")).toBeDisabled();
  await zeroLock.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  const zeroPlot = page.getByRole("button", { name: "0 plot" });
  await zeroPlot.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await expect(zeroPlot).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Loo uus kiht" }).click();
  await waitForLayerCommand("LAYER_CREATE");
  await page.getByRole("button", { name: "Tee 0 aktiivseks" }).click();
  await waitForLayerCommand("LAYER_CURRENT");
  await table.getByText("Layer 1", { exact: true }).click();
  const freeze = page.getByRole("button", { name: "Layer 1 külmutus" });
  await freeze.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await expect(freeze).toHaveAttribute("aria-pressed", "true");
  await freeze.click();
  await waitForLayerCommand("LAYER_BATCH_PROPERTIES");
  await page.getByRole("button", { name: "Nimeta valitud kiht ümber" }).click();
  const rename = page.getByRole("textbox", { name: "Layer 1 uus nimi" });
  await rename.fill("A-WALL");
  await rename.press("Enter");
  await waitForLayerCommand("LAYER_RENAME");
  await expect(table.getByText("A-WALL", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tee valitud kiht aktiivseks", exact: true }).click();
  await waitForLayerCommand("LAYER_CURRENT");
  await expect(palette.getByText("Current layer:").locator("strong")).toHaveText("A-WALL");

  await page.getByRole("button", { name: "Loo uus kiht" }).click();
  await waitForLayerCommand("LAYER_CREATE");
  await page.getByRole("button", { name: "Tee 0 aktiivseks" }).click();
  await waitForLayerCommand("LAYER_CURRENT");
  await table.getByText("Layer 2", { exact: true }).click();
  await page.getByRole("button", { name: "Kustuta valitud kiht" }).click();
  await waitForLayerCommand("LAYER_DELETE");
  await expect(table.getByText("Layer 2", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Tee A-WALL aktiivseks" }).click();
  await waitForLayerCommand("LAYER_CURRENT");

  const zeroRow = page.getByRole("button", { name: "Tee 0 aktiivseks" }).locator("xpath=ancestor::*[@role='row']");
  const wallRow = page.getByRole("button", { name: "Tee A-WALL aktiivseks" }).locator("xpath=ancestor::*[@role='row']");
  await zeroRow.click();
  await zeroRow.focus();
  await zeroRow.press("ArrowDown");
  await expect(wallRow).toBeFocused();
  await wallRow.press("F2");
  await expect(page.getByRole("textbox", { name: "A-WALL uus nimi" })).toBeFocused();
  await page.keyboard.press("Escape");

  const resizeHandle = page.getByRole("separator", { name: "Muuda paleti laiust" });
  await resizeHandle.focus();
  await resizeHandle.press("ArrowRight");
  await expect(palette).toHaveAttribute("data-palette-width", "476");
  await page.getByRole("button", { name: "Ujuta paletid" }).click();
  await expect(palette).toHaveAttribute("data-dock", "floating");
  await page.getByRole("button", { name: "Doki paletid" }).click();
  await expect(palette).toHaveAttribute("data-dock", "docked");
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Properties palette" })).toHaveAttribute("data-palette-width", "476");
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText("A-WALL", { exact: true })).toBeVisible();

  const readBack = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const stored = await new Promise<any>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return {
      revision: stored.revision,
      currentLayerId: stored.currentLayerId,
      layers: stored.layers,
      entityOrder: stored.entities.map((entity: any) => entity.handle),
      palette: {
        dock: document.querySelector(".properties-palette")?.getAttribute("data-dock"),
        width: document.querySelector(".properties-palette")?.getAttribute("data-palette-width"),
      },
    };
  });
  expect(readBack.currentLayerId).toBe("layer-layer-1");
  expect(readBack.layers).toHaveLength(2);
  expect(readBack.layers.find((layer: any) => layer.name === "0")).toMatchObject({ visible: true, locked: false, plottable: false, appearance: { color: "#ff0000", lineweightMm: 0.35, transparency: 25 } });
  expect(readBack.palette).toEqual({ dock: "docked", width: "476" });
  expect(consoleErrors).toEqual([]);

  if (captureRoot) {
    await mkdir(captureRoot, { recursive: true });
    await writeFile(resolve(captureRoot, "visual-layer-core-after.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-layer-core-readback.json"), `${JSON.stringify({ consoleErrors, orderBefore, orderAfter, readBack }, null, 2)}\n`, "utf8");
  }
});

test("DIM and HATCH use typed prompts with atomic durable read-back", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  await page.getByRole("button", { name: "Mõõdustiilid" }).click();
  await answerLivePrompt(page, "create");
  await answerLivePrompt(page, JSON.stringify({ id: "DIM", name: "Kuubik DIM", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 }));
  await expect(page.locator(".command-history")).toContainText("DIM · atomic commit/read-back");

  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("RECTANGLE 0,0 100,80");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  await expect(page.locator(".command-history")).toContainText("RECTANGLE runtime salvestatud");
  await page.getByRole("button", { name: "Vali kõik", exact: true }).click();
  const boundary = await page.getByLabel("Kuubik Draw joonestusala").getAttribute("data-selected-handles");
  expect(boundary).toBeTruthy();
  await page.getByRole("button", { name: "Ribbon Hatch command" }).click();
  await answerExpectedLivePrompt(page, "mode", "create");
  await answerExpectedLivePrompt(page, "targetHandle", boundary!);
  await answerExpectedLivePrompt(page, "patch", JSON.stringify({ pattern: "ANSI31" }));
  await answerExpectedLivePrompt(page, "boundaryHandles", boundary!);
  await answerExpectedLivePrompt(page, "pattern", "ANSI31");
  await answerExpectedLivePrompt(page, "angleRad", "0.7853981633974483");
  await answerExpectedLivePrompt(page, "scale", "1");
  await answerExpectedLivePrompt(page, "associative", "jah");
  await answerExpectedLivePrompt(page, "islandDetection", "normal");
  await answerExpectedLivePrompt(page, "origin", "0,0");
  await expect(page.locator(".command-history")).toContainText("HATCH · atomic commit/read-back");

  await page.getByTestId("dimension-menu").locator("summary").click();
  await page.getByRole("menuitem", { name: "Linear" }).click();
  await answerLivePrompt(page, "0,0");
  await answerLivePrompt(page, "100,0");
  await answerLivePrompt(page, "0,20");
  await answerLivePrompt(page, "horizontal");
  await answerLivePrompt(page, "ei");
  await answerLivePrompt(page, "DIM");
  await expect(page.locator(".command-history")).toContainText("DIM · atomic commit/read-back");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /hatch.*dimension/u);
  expect(errors).toEqual([]);
});

test("BLOCK INSERT ATTRIB BEDIT and EXPLODE stay atomic through the live adapter", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("LINE 0,0 80,0");
  await page.getByRole("button", { name: "Käivita käsk" }).click();

  await page.getByRole("button", { name: "Ribbon Create command" }).click();
  await answerLivePrompt(page, "DETAIL");
  await answerLivePrompt(page, "Detail");
  await answerLivePrompt(page, "0,0");
  const attributes = [{ tag: "MARK", prompt: "Mark", defaultValue: "B1", position: { x: 5, y: 5 }, height: 2.5 }];
  await answerLivePrompt(page, JSON.stringify(attributes));
  await expect(page.locator(".command-history")).toContainText("BLOCK · atomic commit/read-back");

  const runtimeReadback = page.locator(".runtime-intent-readback");
  const insertHandle = await page.getByLabel("Kuubik Draw joonestusala").getAttribute("data-selected-handles");
  expect(insertHandle).toBeTruthy();
  const beforeAttribRevision = Number(await runtimeReadback.getAttribute("data-runtime-revision"));
  await page.getByRole("button", { name: "Ribbon Attributes command" }).click();
  await answerLivePrompt(page, "edit");
  await answerLivePrompt(page, JSON.stringify({ MARK: "B9" }));
  await expect(page.locator(".command-history")).toContainText("ATTRIB · atomic commit/read-back");
  await expect(runtimeReadback).toHaveAttribute("data-runtime-revision", String(beforeAttribRevision + 1));
  const attribReadback = await page.evaluate(async (handle) => {
    const { KDrawIndexedDb } = await import("/src/indexed-db.ts");
    const database = new KDrawIndexedDb(indexedDB, "kuubik-draw");
    try {
      const document = await database.loadDocument("local");
      const insert = document?.entities.find((entity) => entity.handle === handle);
      return insert?.kind === "blockRef" ? { revision: document!.revision, attributes: insert.attributes } : null;
    } finally {
      database.close();
    }
  }, insertHandle!);
  expect(attribReadback).toEqual({ revision: beforeAttribRevision + 1, attributes: { MARK: "B9" } });

  await page.getByRole("button", { name: "Ribbon Edit block command" }).click();
  await answerLivePrompt(page, "0,0");
  await answerLivePrompt(page, JSON.stringify([{ kind: "line", handle: "BM2", layerId: "0", start: { x: 0, y: 0 }, end: { x: 120, y: 0 } }]));
  await answerLivePrompt(page, JSON.stringify(attributes));
  await answerLivePrompt(page, "ei");
  await expect(page.locator(".command-history")).toContainText("BEDIT · atomic commit/read-back");

  await page.getByLabel("Kuubik Draw joonestusala").click({ button: "right", position: { x: 900, y: 600 } });
  await page.getByRole("menuitem", { name: /Deselect All/u }).click();
  await page.getByRole("button", { name: "Ribbon Insert block command" }).click();
  await answerLivePrompt(page, "DETAIL");
  await answerLivePrompt(page, "180,80");
  await answerLivePrompt(page, "1");
  await answerLivePrompt(page, "1");
  await answerLivePrompt(page, "0");
  await answerLivePrompt(page, JSON.stringify({ MARK: "B2" }));
  await expect(page.locator(".command-history")).toContainText("INSERT · atomic commit/read-back");

  await page.getByRole("button", { name: "Ribbon Explode command" }).click();
  await answerLivePrompt(page, "jah");
  await answerLivePrompt(page, "preserve");
  await expect(page.locator(".command-history")).toContainText("EXPLODE · atomic commit/read-back");
  expect(errors).toEqual([]);
});

test("precision candidates, document tabs, recovery and PDF underlay use live orchestrators", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("LINE 0,0 100,0");
  await page.getByRole("button", { name: "Käivita käsk" }).click();
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const geometry = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = Number((element as HTMLElement).dataset.worldCenterX);
    const centerY = Number((element as HTMLElement).dataset.worldCenterY);
    const units = Number((element as HTMLElement).dataset.worldUnitsPerPixel);
    return { x: rect.width / 2 + (0 - centerX) / units, y: rect.height / 2 - (0 - centerY) / units };
  });
  await canvas.hover({ position: geometry });
  const readBack = page.getByTestId("live-contract-readback");
  await expect(readBack).toHaveAttribute("data-snap-candidates", /^[1-9]/u);
  await expect(readBack).toHaveAttribute("data-dynamic-input", "true");

  await page.getByRole("button", { name: "Uus joonis", exact: true }).click();
  await expect(readBack).toHaveAttribute("data-live-tabs", /local,drawing-2/u);
  await page.getByRole("button", { name: "local.kdraw", exact: true }).click();
  await expect(readBack).toHaveAttribute("data-live-recovery", /local:/u);

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  await page.getByLabel("PDF underlay fail").setInputFiles({ name: "reference.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(readBack).toHaveAttribute("data-pdf-placement", /underlay-/u);
  await expect(readBack).toHaveAttribute("data-pdf-bytes", String(pdf.byteLength));
  await expect(page.locator(".command-history")).toContainText("PDFATTACH");
  expect(errors).toEqual([]);
});

test("OSNAP candidate stack cycles by keyboard and drives the committed pointer frame", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const command = page.getByRole("textbox", { name: "Command input" });
  const submit = page.getByRole("button", { name: "Käivita käsk" });
  await command.fill("LINE 0,0 100,0");
  await submit.click();
  await command.fill("CIRCLE 0,0 25");
  await submit.click();

  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  const origin = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = Number((element as HTMLElement).dataset.worldCenterX);
    const centerY = Number((element as HTMLElement).dataset.worldCenterY);
    const units = Number((element as HTMLElement).dataset.worldUnitsPerPixel);
    return { x: rect.width / 2 - centerX / units, y: rect.height / 2 + centerY / units };
  });
  await canvas.hover({ position: origin });
  const readback = page.getByTestId("live-contract-readback");
  await expect.poll(async () => Number(await readback.getAttribute("data-snap-candidates"))).toBeGreaterThanOrEqual(2);
  const firstId = await readback.getAttribute("data-snap-candidate-id");
  await expect(page.getByTestId("cad-snap-marker")).toBeVisible();
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => readback.getAttribute("data-snap-candidate-id")).not.toBe(firstId);
  await expect(readback).toHaveAttribute("data-snap-candidate-index", "1");
  await page.keyboard.press("Shift+Tab");
  await expect(readback).toHaveAttribute("data-snap-candidate-id", firstId!);
  await expect(page.locator(".command-history")).toContainText("OSNAP 1/");
  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-live-snap-cycle.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-snap-cycle.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      candidateCount: Number(await readback.getAttribute("data-snap-candidates")),
      candidateId: await readback.getAttribute("data-snap-candidate-id"),
      candidateMode: await readback.getAttribute("data-snap-candidate-mode"),
      marker: await page.getByTestId("cad-snap-marker").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
  expect(errors).toEqual([]);
});

test("PGP aliases and per-document workspace history remain isolated and durable", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  await page.getByRole("button", { name: "Ava käsuajalugu" }).click();
  await page.getByLabel("Import PGP aliases").setInputFiles({ name: "reio.pgp", mimeType: "text/plain", buffer: Buffer.from("ZZ, *LINE\r\n") });
  await expect(page.getByTestId("pgp-alias-count")).toHaveText("1 custom alias");
  await page.getByRole("button", { name: "Sulge Kuubik Text Window" }).click();

  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("ZZ 0,0 80,0");
  await command.press("Enter");
  const canvas = page.getByLabel("Kuubik Draw joonestusala");
  await expect(canvas).toHaveAttribute("data-selected-handles", /.+/u);
  const localSelection = await canvas.getAttribute("data-selected-handles");
  expect(localSelection).toBeTruthy();
  const readback = page.getByTestId("live-contract-readback");
  await expect(readback).toHaveAttribute("data-pgp-aliases", "ZZ:LINE");
  await expect(readback).toHaveAttribute("data-workspace-history", /ZZ 0,0 80,0/u);
  await expect(readback).toHaveAttribute("data-workspace-selection", localSelection!);

  await page.getByRole("button", { name: "Uus joonis", exact: true }).click();
  await expect(readback).toHaveAttribute("data-workspace-active-document", "drawing-2");
  await command.fill("CIRCLE 20,20 10");
  await command.press("Enter");
  await expect(canvas).toHaveAttribute("data-selected-handles", /.+/u);
  const drawingSelection = await canvas.getAttribute("data-selected-handles");
  expect(drawingSelection).toBeTruthy();
  await expect(readback).toHaveAttribute("data-workspace-history", /CIRCLE 20,20 10/u);

  await page.getByRole("button", { name: "local.kdraw", exact: true }).click();
  await expect(readback).toHaveAttribute("data-workspace-active-document", "local");
  await expect(canvas).toHaveAttribute("data-selected-handles", localSelection!);
  await expect(readback).toHaveAttribute("data-workspace-history", /ZZ 0,0 80,0/u);
  await page.getByRole("button", { name: "Kiirpääsu Undo" }).click();
  await expect(readback).toHaveAttribute("data-workspace-can-redo", "true");
  await page.getByRole("button", { name: "Kiirpääsu Redo" }).click();
  await expect(readback).toHaveAttribute("data-workspace-can-undo", "true");
  await expect(readback).toHaveAttribute("data-workspace-history", /ZZ 0,0 80,0\|U\|REDO/u);
  if (captureRoot) {
    await writeFile(resolve(captureRoot, "visual-live-workspace-history.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-workspace-history.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      activeDocument: await readback.getAttribute("data-workspace-active-document"),
      selection: await readback.getAttribute("data-workspace-selection"),
      history: await readback.getAttribute("data-workspace-history"),
      aliases: await readback.getAttribute("data-pgp-aliases"),
      canUndo: await readback.getAttribute("data-workspace-can-undo"),
      canRedo: await readback.getAttribute("data-workspace-can-redo"),
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
  expect(errors).toEqual([]);
});

test("TABLE and dimension variants are visible shell workflows with atomic read-back", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  await page.getByRole("button", { name: "Mõõdustiilid" }).click();
  await answerLivePrompt(page, "create");
  await answerLivePrompt(page, JSON.stringify({ id: "DIM", name: "Kuubik DIM", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 }));

  const dimensionMenu = page.getByTestId("dimension-menu");
  await dimensionMenu.locator("summary").click();
  for (const label of ["Linear", "Aligned", "Angular", "Radius", "Diameter", "Continue", "Baseline", "Dimension Style"]) {
    await expect(page.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Aligned" }).click();
  await answerLivePrompt(page, "0,0");
  await answerLivePrompt(page, "100,40");
  await answerLivePrompt(page, "20,50");
  await answerLivePrompt(page, "ei");
  await answerLivePrompt(page, "DIM");
  await expect(page.locator(".command-history")).toContainText("DIM · atomic commit/read-back");

  await dimensionMenu.locator("summary").click();
  await page.getByRole("menuitem", { name: /^Continue/u }).click();
  await answerLivePrompt(page, "0,0;50,0;100,0");
  await answerLivePrompt(page, "0,20");
  await answerLivePrompt(page, "horizontal");
  await answerLivePrompt(page, "CHAIN-A");
  await answerLivePrompt(page, "ei");
  await answerLivePrompt(page, "DIM");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /dimension/u);

  await page.getByRole("button", { name: "Tekstistiilid" }).click();
  await answerLivePrompt(page, "create");
  await answerLivePrompt(page, JSON.stringify({ id: "TXT", name: "Kuubik", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 }));
  await expect(page.locator(".command-history")).toContainText("STYLE · atomic commit/read-back");

  const table = page.getByRole("button", { name: "Ribbon Table command" });
  await table.click();
  await answerLivePrompt(page, "style-create");
  await answerLivePrompt(page, JSON.stringify({ id: "TABLE-STD", name: "Standard", textStyleId: "TXT", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" }));
  await expect(page.locator(".command-history")).toContainText("TABLE · atomic commit/read-back");
  await table.click();
  await answerLivePrompt(page, "create");
  await answerLivePrompt(page, JSON.stringify({
    origin: { x: 200, y: 100 }, rotationRad: 0, styleId: "TABLE-STD",
    rows: [{ id: "R1", height: 8 }, { id: "R2", height: 10 }],
    columns: [{ id: "C1", width: 30 }, { id: "C2", width: 40 }],
    cells: [
      { id: "A1", rowId: "R1", columnId: "C1", value: { kind: "text", text: "Mark" } },
      { id: "A2", rowId: "R1", columnId: "C2", value: { kind: "text", text: "Value" } },
      { id: "B1", rowId: "R2", columnId: "C1", value: { kind: "text", text: "A-01" } },
      { id: "B2", rowId: "R2", columnId: "C2", value: { kind: "field", code: "%<SheetNumber>%", fallback: "1" } },
    ],
  }));
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /proxy/u);
  await expect(page.locator(".command-history")).toContainText("TABLE · atomic commit/read-back");
  if (captureRoot) {
    await dimensionMenu.locator("summary").click();
    await writeFile(resolve(captureRoot, "visual-live-table-dimensions.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-table-dimensions.json"), `${JSON.stringify({
      viewport: [1920, 1080],
      revision: await page.locator(".runtime-intent-readback").getAttribute("data-runtime-revision"),
      entityKinds: await page.locator(".runtime-intent-readback").getAttribute("data-runtime-entity-kinds"),
      tableButton: await table.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, disabled: (element as HTMLButtonElement).disabled };
      }),
      consoleErrors: errors,
    }, null, 2)}\n`, "utf8");
  }
  expect(errors).toEqual([]);
});

test("POLYGON runs ribbon typed preview, keyboard commit and command-line edge read-back", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  const polygonTool = page.getByRole("button", { name: "Ribbon Polygon command" });
  await polygonTool.focus();
  await page.keyboard.press("Enter");
  const prompt = page.getByTestId("polygon-prompt");
  await expect(prompt).toBeVisible();
  await expect(page.getByLabel("Polygon sides")).toBeFocused();
  await expect(prompt).toHaveAttribute("data-preview-valid", "true");
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-polygon-preview", "true");
  if (captureRoot) {
    const geometry = await page.evaluate(() => Object.fromEntries([".properties-palette", ".layer-manager", ".polygon-prompt", ".layoutbar"].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }];
    })));
    await writeFile(resolve(captureRoot, "visual-live-polygon-preview.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-polygon-preview.json"), `${JSON.stringify({ viewport: [1920, 1080], geometry, previewValid: true, consoleErrors: errors }, null, 2)}\n`, "utf8");
  }

  await page.keyboard.press("Control+A");
  await page.keyboard.type("5");
  for (let step = 0; step < 7; step += 1) await page.keyboard.press("Tab");
  await expect(prompt.locator('button[type="submit"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  await expect(page.locator(".command-history")).toContainText("POLYGON · atomic commit/read-back");
  const readback = page.getByTestId("live-contract-readback");
  await expect(readback).toHaveAttribute("data-polygon-sides", "5");
  await expect(readback).toHaveAttribute("data-polygon-mode", "center-inscribed");
  await expect(readback).toHaveAttribute("data-polygon-rotation-input", "radius-point");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /polyline/u);

  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("POL 4 E 0,0 100,0 CW");
  await command.press("Enter");
  await expect(readback).toHaveAttribute("data-polygon-sides", "4");
  await expect(readback).toHaveAttribute("data-polygon-mode", "edge");
  await expect(readback).toHaveAttribute("data-polygon-orientation", "clockwise");
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-selected-handles", /.+/u);
  expect(errors).toEqual([]);
});

test("ELLIPSE uses typed ghost, keyboard commit, command-line arc and reload read-back", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");

  const ellipse = page.getByRole("button", { name: "Ribbon Ellipse command" });
  await ellipse.focus();
  await page.keyboard.press("Enter");
  const prompt = page.getByTestId("ellipse-prompt");
  await expect(prompt).toBeVisible();
  await expect(page.getByLabel("Ellipse construction mode")).toBeFocused();
  await expect(prompt).toHaveAttribute("data-preview-valid", "true");
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-ellipse-preview", "true");
  if (captureRoot) {
    const geometry = await page.evaluate(() => Object.fromEntries([".ellipse-prompt", ".properties-palette", ".layoutbar"].map((selector) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }];
    })));
    await writeFile(resolve(captureRoot, "visual-live-ellipse-before.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-ellipse-before.json"), `${JSON.stringify({ viewport: [1920, 1080], geometry, consoleErrors: errors }, null, 2)}\n`, "utf8");
  }
  await page.getByRole("button", { name: "Rakenda" }).focus();
  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  const readback = page.getByTestId("live-contract-readback");
  await expect(readback).toHaveAttribute("data-ellipse-shape", "full");
  await expect(readback).toHaveAttribute("data-ellipse-mode", "center-major-minor");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /ellipse/u);

  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("EL A 200,200 600,200 120 ARC 15 240 CW");
  await command.press("Enter");
  await expect(readback).toHaveAttribute("data-ellipse-shape", "arc");
  await expect(readback).toHaveAttribute("data-ellipse-mode", "axis-endpoints");
  await page.reload();
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /ellipse,ellipse/u);
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-live-ellipse-after.png"), await page.screenshot());
  expect(errors).toEqual([]);
});

test("UNITS covers all formats, confirms coordinate preservation and survives reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("LINE 0,0 100,0");
  await command.press("Enter");

  await page.getByRole("button", { name: "Ribbon Units command" }).click();
  const panel = page.getByTestId("units-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Length format").locator("option")).toHaveCount(5);
  await expect(page.getByLabel("Angle format").locator("option")).toHaveCount(5);
  await expect(page.getByLabel("Drawing unit", { exact: true }).locator("option")).toHaveCount(6);
  await page.getByLabel("Length format").selectOption("fractional");
  await page.getByLabel("Length precision").fill("4");
  await page.getByLabel("Angle format").selectOption("surveyor");
  await page.getByLabel("Angle precision").fill("3");
  await page.getByLabel("Base angle").fill("30");
  await page.getByLabel("Clockwise angles").check();
  await page.getByLabel("Drawing unit", { exact: true }).selectOption("cm");
  await expect(page.getByLabel("Preserve existing coordinates")).toBeVisible();
  await expect(panel.getByRole("button", { name: "OK" })).toBeDisabled();
  if (captureRoot) {
    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    });
    await writeFile(resolve(captureRoot, "visual-live-units-confirmation.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-units-confirmation.json"), `${JSON.stringify({ viewport: [1920, 1080], geometry, lengthFormats: 5, angleFormats: 5, linearUnits: 6, requiresPreserveConfirmation: true, consoleErrors: errors }, null, 2)}\n`, "utf8");
  }
  await page.getByLabel("Preserve existing coordinates").check();
  await panel.getByRole("button", { name: "OK" }).click();
  const readback = page.getByTestId("live-contract-readback");
  await expect(readback).toHaveAttribute("data-units-drawing", "cm");
  await expect(readback).toHaveAttribute("data-units-length-format", "fractional");
  await expect(readback).toHaveAttribute("data-units-angle-format", "surveyor");
  await expect(readback).toHaveAttribute("data-units-clockwise", "true");
  await expect(readback).toHaveAttribute("data-units-coordinate-scale", "1");
  await expect(readback).toHaveAttribute("data-units-coordinates-preserved", "true");
  await page.reload();
  await expect(readback).toHaveAttribute("data-units-drawing", "cm");
  await expect(readback).toHaveAttribute("data-units-length-format", "fractional");
  await expect(readback).toHaveAttribute("data-units-angle-format", "surveyor");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-entity-kinds", /line/u);
  expect(errors).toEqual([]);
});

test("Model/Layout workspace creates, copies, renames, reorders, switches and reloads by keyboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const readback = page.getByTestId("live-contract-readback");
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-1");

  const model = page.getByRole("tab", { name: "Model" });
  await model.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Layout 1" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await expect(readback).toHaveAttribute("data-layout-workspace-active", "layout-2");
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-1,layout-2");
  await page.locator('summary[aria-label="Layout tools"]').click();
  await page.getByRole("button", { name: "Kopeeri paigutus" }).click();
  await expect(readback).toHaveAttribute("data-layout-workspace-active", "layout-3");
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-1,layout-3,layout-2");
  await page.getByLabel("Paigutuse nimi").fill("Kontroll-leht");
  await page.getByLabel("Paigutuse nimi").press("Enter");
  await expect(page.getByRole("tab", { name: "Kontroll-leht" })).toBeVisible();
  await page.getByRole("button", { name: "Liiguta vasakule" }).click();
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-3,layout-1,layout-2");
  const storedOrder = await page.evaluate(async () => {
    const { KDrawIndexedDb } = await import("/src/indexed-db.ts");
    const database = new KDrawIndexedDb(indexedDB, "kuubik-draw");
    const current = await database.loadDocument("local");
    const recovered = await database.recoverDocument("local");
    database.close();
    return {
      current: current?.layouts.map((layout) => layout.id).join(",") ?? "",
      recovered: recovered.document?.layouts.map((layout) => layout.id).join(",") ?? "",
      ignored: recovered.ignoredOperationIds,
      source: recovered.source,
    };
  });
  expect(storedOrder).toEqual({ current: "model,layout-3,layout-1,layout-2", recovered: "model,layout-3,layout-1,layout-2", ignored: [], source: "operation-log" });
  await page.reload();
  await expect(readback).toHaveAttribute("data-layout-workspace-active", "layout-3");
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-3,layout-1,layout-2");
  await expect(page.getByRole("tab", { name: "Kontroll-leht" })).toHaveAttribute("aria-selected", "true");
  const recoveryPanel = page.getByTestId("recovery-panel");
  if (await recoveryPanel.isVisible()) await page.getByRole("button", { name: "Sulge taastamispaneel" }).click();
  if (captureRoot) {
    const geometry = await page.evaluate(() => Object.fromEntries([".layoutbar", ".layout-tabs", ".paper-space-sheet"].map((selector) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }];
    })));
    await writeFile(resolve(captureRoot, "visual-live-layout-workspace.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-layout-workspace.json"), `${JSON.stringify({ viewport: [1920, 1080], geometry, storedOrder, consoleErrors: errors }, null, 2)}\n`, "utf8");
  }
  await page.locator('summary[aria-label="Layout tools"]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Kustuta paigutus" }).click();
  await expect(readback).toHaveAttribute("data-layout-workspace-order", "model,layout-1,layout-2");
  expect(errors).toEqual([]);
});

test("F-133 recovery panel reports corrupt snapshot, incomplete tail, quarantine and repeated reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  const command = page.getByRole("textbox", { name: "Command input" });
  await command.fill("LINE 0,0 100,0");
  await command.press("Enter");
  await expect(page.locator(".runtime-intent-readback")).toHaveAttribute("data-runtime-revision", "1");

  const seeded = await page.evaluate(async () => {
    const modulePath = "/src/indexed-db.ts";
    const { KDrawIndexedDb } = await import(modulePath);
    const database = new KDrawIndexedDb(indexedDB, "kuubik-draw");
    const compaction = await database.compactDocument("local", { minimumOperations: 1 }, "2026-08-31T20:30:00.000Z");
    database.close();
    if (!compaction.snapshotKey) throw new Error("Compaction snapshot was not created.");
    const raw = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const transaction = raw.transaction(["snapshots", "operations"], "readwrite");
    const snapshots = transaction.objectStore("snapshots");
    const snapshot = await new Promise<Record<string, unknown>>((resolveGet, rejectGet) => {
      const request = snapshots.get(compaction.snapshotKey!);
      request.onsuccess = () => resolveGet(request.result as Record<string, unknown>);
      request.onerror = () => rejectGet(request.error);
    });
    snapshot.sha256 = "0".repeat(64);
    snapshots.put(snapshot);
    transaction.objectStore("operations").add({
      opId: "local-incomplete-browser-tail",
      documentId: "local",
      revision: compaction.revision + 1,
      operation: { opId: "local-incomplete-browser-tail", baseRevision: compaction.revision, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] },
      recordedAt: "2026-08-31T20:31:00.000Z",
    });
    await new Promise<void>((resolveTransaction, rejectTransaction) => {
      transaction.oncomplete = () => resolveTransaction();
      transaction.onerror = () => rejectTransaction(transaction.error);
      transaction.onabort = () => rejectTransaction(transaction.error);
    });
    raw.close();
    return { snapshotKey: compaction.snapshotKey, revision: compaction.revision };
  });

  await page.reload();
  const panel = page.getByTestId("recovery-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-recovery-code", "RECOVERY_DEGRADED");
  await expect(panel).toHaveAttribute("data-recovery-revision", String(seeded.revision));
  await expect(panel).toHaveAttribute("data-incomplete-tail", "true");
  await expect(panel).toHaveAttribute("data-quarantined-count", "1");
  await expect(panel).toHaveAttribute("data-corrupt-snapshot-count", "1");
  await expect(panel).toHaveAttribute("data-corrupt-compaction-count", "1");
  await expect(panel).toContainText("local-incomplete-browser-tail");
  await expect(panel).toContainText(seeded.snapshotKey!);
  await expect(panel).toContainText("Midagi ei kustutatud automaatselt");
  await expect(panel).not.toContainText("PASS");
  await expect(panel).toHaveAttribute("data-repeated-recovery", "false");

  await page.reload();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-repeated-recovery", "true");
  await expect(panel).toHaveAttribute("data-quarantined-count", "1");
  if (captureRoot) {
    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    });
    await writeFile(resolve(captureRoot, "visual-live-recovery-panel.png"), await page.screenshot());
    await writeFile(resolve(captureRoot, "visual-live-recovery-panel.json"), `${JSON.stringify({ viewport: [1920, 1080], geometry, snapshotKey: seeded.snapshotKey, revision: seeded.revision, repeatedRecovery: true, quarantinedOperations: 1, consoleErrors: errors }, null, 2)}\n`, "utf8");
  }
  const operationCount = await page.evaluate(async () => {
    const raw = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const transaction = raw.transaction("operations", "readonly");
    const index = transaction.objectStore("operations").index("byDocument");
    const count = await new Promise<number>((resolveCount, rejectCount) => {
      const request = index.count("local");
      request.onsuccess = () => resolveCount(request.result);
      request.onerror = () => rejectCount(request.error);
    });
    raw.close();
    return count;
  });
  expect(operationCount).toBe(2);
  expect(errors).toEqual([]);
});
