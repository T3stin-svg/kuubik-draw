import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createEmptyDocument } from "../packages/cad-core/src/index.js";
import { exportDxf } from "../packages/cad-dxf/src/index.js";

const captureRoot = process.env.PARITY_CAPTURE_DIR;

test("AutoCAD-style shell keeps all eight primary zones visible at 1920x1080", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/d/local");
  await expect(page.getByRole("navigation", { name: "Ribbon vahelehed" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" })).toBeVisible();
  const commandLine = page.locator(".command-line");
  await expect(commandLine).toBeHidden();
  await expect(commandLine).toHaveAttribute("data-display-mode", "hidden");

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
      x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(34, 41, 51, 0.96)", borderTopColor: "rgb(78, 90, 104)", borderTopWidth: "1px",
      borderBottomColor: "rgb(78, 90, 104)", borderBottomWidth: "1px",
    },
  });
  await page.keyboard.press("Control+9");
  await expect(commandLine).toBeVisible();
  await expect(commandLine).toHaveAttribute("data-display-mode", "shown");
  await expect(commandLine).toHaveCSS("width", "600px");
  await expect(commandLine).toHaveCSS("height", "50px");
  await page.keyboard.press("Control+9");
  await expect(commandLine).toBeHidden();
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
  const ribbonIconography = await page.locator("[data-cad-icon]").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      kind: element.getAttribute("data-cad-icon"),
      width: rect.width,
      height: rect.height,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      pathCount: element.querySelectorAll("path,polyline,rect,circle").length,
    };
  }));
  expect(ribbonIconography).toHaveLength(35);
  expect(ribbonIconography.map(({ kind }) => kind)).toEqual([
    "line", "rectangle", "polyline", "circle", "arc", "hatch", "spline",
    "move", "copy", "rotate", "mirror", "trim", "offset", "stretch", "scale", "fillet",
    "text", "dimension", "leader", "table", "new-layer", "layer-lock", "make-current", "match-layer",
    "insert", "create-block", "edit-block", "attributes", "match-properties", "group", "ungroup",
    "measure", "count", "paste", "base-view",
  ]);
  expect(ribbonIconography[0]).toMatchObject({ kind: "line", width: 34, height: 34, stroke: "rgb(241, 244, 246)", pathCount: 3 });
  const largeRibbonIconKinds = new Set(["line", "text", "insert", "match-properties", "paste", "base-view"]);
  expect(ribbonIconography.every(({ kind, width, height, pathCount }) => {
    const expectedSize = largeRibbonIconKinds.has(kind ?? "") ? 34 : 18;
    return width === expectedSize && height === expectedSize && pathCount >= 1;
  })).toBe(true);
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
    viewIndicatorGeometry: await page.getByTestId("view-orientation-indicator").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const face = getComputedStyle(element, "::before");
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        face: {
          top: face.top, left: face.left, width: face.width, height: face.height,
          backgroundColor: face.backgroundColor, borderColor: face.borderColor, transform: face.transform,
        },
      };
    }),
  };
  expect(modelNavigation.viewIndicatorGeometry).toEqual({
    x: 1794, y: 228, width: 76, height: 155,
    face: {
      top: "38px", left: "12px", width: "52px", height: "52px",
      backgroundColor: "rgba(86, 96, 105, 0.12)", borderColor: "rgba(122, 130, 137, 0.46)", transform: "none",
    },
  });
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

  const activeSceneViewport = await modelCanvas.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return {
      width: element.clientWidth,
      height: element.clientHeight,
      worldCenter: { x: Number(element.dataset.worldCenterX), y: Number(element.dataset.worldCenterY) },
      worldUnitsPerPixel: Number(element.dataset.worldUnitsPerPixel),
    };
  });
  const activeSceneWorldPoint = (x: number, y: number) => ({
    x: activeSceneViewport.worldCenter.x + (x - activeSceneViewport.width / 2) * activeSceneViewport.worldUnitsPerPixel,
    y: activeSceneViewport.worldCenter.y - (y - activeSceneViewport.height / 2) * activeSceneViewport.worldUnitsPerPixel,
  });
  const activeSceneDocument = createEmptyDocument({ documentId: "visual-shell-active", now: "2026-08-31T11:05:00.000Z" });
  const activeOuterTopLeft = activeSceneWorldPoint(785, 195);
  const activeOuterBottomRight = activeSceneWorldPoint(1812, 811);
  const activeCircleCenter = activeSceneWorldPoint(1298, 503);
  activeSceneDocument.entities = [
    {
      kind: "polyline", handle: "B1", layerId: "0", closed: true,
      vertices: [activeOuterTopLeft, { x: activeOuterBottomRight.x, y: activeOuterTopLeft.y }, activeOuterBottomRight, { x: activeOuterTopLeft.x, y: activeOuterBottomRight.y }],
    },
    { kind: "circle", handle: "B2", layerId: "0", center: activeCircleCenter, radius: 123.5 * activeSceneViewport.worldUnitsPerPixel },
    { kind: "text", handle: "B3", layerId: "0", position: activeSceneWorldPoint(1032, 134), text: "KUUBIK AUDIT", height: 75 * activeSceneViewport.worldUnitsPerPixel, rotationRad: 0 },
  ];
  await page.getByLabel("DXF import").setInputFiles({ name: "visual-shell-active.dxf", mimeType: "application/dxf", buffer: Buffer.from(exportDxf(activeSceneDocument).bytes) });
  await expect(commandLine).toContainText("DXF imporditud: 3 objekti · 1 kihti · mm");

  await lineRibbonTool.click();
  await expect(lineRibbonTool).toHaveAttribute("aria-pressed", "true");
  const activeRibbonState = await lineRibbonTool.evaluate((element) => ({
    color: getComputedStyle(element).color,
    backgroundColor: getComputedStyle(element).backgroundColor,
    borderColor: getComputedStyle(element).borderColor,
  }));
  await expect(commandLine).toContainText("LINE Specify first point");
  await modelCanvas.hover({ position: { x: 846, y: 803 } });
  await expect(commandLine).toContainText("LINE Specify first point");
  const activeModelDisplayReadback = await modelCanvas.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true })!;
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
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
      verticalGridRuns: runs("x", 219, 680, element.width - 1),
      horizontalGridRuns: runs("y", 700, 0, element.height - 1),
      clearPixelRgba: pixel(707, 25),
      majorGridPixelRgba: pixel(682, 219),
      xAxisPixelRgba: pixel(900, 812),
      yAxisPixelRgba: pixel(785, 100),
    };
  });
  expect(activeModelDisplayReadback.verticalGridRuns).toHaveLength(121);
  expect(activeModelDisplayReadback.verticalGridRuns.slice(0, 10).map(([start, end]) => Math.round((start + end) / 2))).toEqual([682, 692, 703, 713, 723, 733, 744, 754, 764, 775]);
  expect(activeModelDisplayReadback.horizontalGridRuns).toHaveLength(84);
  expect(activeModelDisplayReadback.clearPixelRgba[3]).toBe(0);
  expect(activeModelDisplayReadback.majorGridPixelRgba[3]).toBeGreaterThan(140);
  expect(activeModelDisplayReadback.xAxisPixelRgba.slice(0, 3)).toEqual([170, 130, 132]);
  expect(activeModelDisplayReadback.yAxisPixelRgba.slice(0, 3)).toEqual([139, 175, 145]);
  const activeFixture = await modelCanvas.evaluate(async (canvas) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
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
    const crosshair = globalThis.document.querySelector<HTMLElement>('[data-testid="cad-crosshair"]')!;
    const crosshairRect = crosshair.getBoundingClientRect();
    return {
      entityKinds: document.entities.map((entity: any) => entity.kind).sort(),
      handles: document.entities.map((entity: any) => entity.handle).sort(),
      selectedHandles: (element.dataset.selectedHandles ?? "").split(",").filter(Boolean).sort(),
      previewCommand: element.dataset.previewCommand ?? "",
      entityCount: Number(element.dataset.entityCount),
      polyline: { closed: polyline.closed, vertices: polyline.vertices.map(project) },
      circle: { center: project(circle.center), radiusPx: circle.radius / scale },
      text: { value: text.text, insertion: project(text.position), heightPx: text.height / scale },
      crosshair: { x: crosshairRect.x, y: crosshairRect.y, width: crosshairRect.width, height: crosshairRect.height, centerX: crosshairRect.x + crosshairRect.width / 2, centerY: crosshairRect.y + crosshairRect.height / 2 },
    };
  });
  expect(activeFixture.entityKinds).toEqual(["circle", "polyline", "text"]);
  expect(activeFixture.handles).toEqual(["B1", "B2", "B3"]);
  expect(activeFixture).toMatchObject({ selectedHandles: [], previewCommand: "LINE", entityCount: 3, crosshair: { width: 23, height: 23, centerX: 846.5, centerY: 984.5 } });
  expect(activeFixture.polyline.vertices[0]!.x).toBeCloseTo(785, 6);
  expect(activeFixture.polyline.vertices[0]!.y).toBeCloseTo(195, 6);
  expect(activeFixture.polyline.vertices[2]!.x).toBeCloseTo(1812, 6);
  expect(activeFixture.polyline.vertices[2]!.y).toBeCloseTo(811, 6);
  expect(activeFixture.circle.center.x).toBeCloseTo(1298, 6);
  expect(activeFixture.circle.center.y).toBeCloseTo(503, 6);
  expect(activeFixture.circle.radiusPx).toBeCloseTo(123.5, 6);
  expect(activeFixture.text.value).toBe("KUUBIK AUDIT");
  expect(activeFixture.text.insertion.x).toBeCloseTo(1032, 6);
  expect(activeFixture.text.insertion.y).toBeCloseTo(134, 6);
  expect(activeFixture.text.heightPx).toBeCloseTo(75, 6);
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
  await expect(commandLine).toContainText("Command: *Cancel* (LINE)");

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
  await expect(commandLine).toContainText("DXF imporditud: 3 objekti · 1 kihti · mm");
  await page.getByRole("button", { name: "Vali kõik", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("3 selected")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("All (3)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-selected-handles", /.+/);
  await expect(page.getByLabel("Kuubik Draw joonestusala")).toHaveAttribute("data-preview-command", "");
  const selectedFixture = await modelCanvas.evaluate(async (canvas) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
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
    palette: { x: 0, y: 181, width: 680, height: 862, bottom: 1043 },
    layerManager: { x: 0, y: 181, width: 678, height: 513, bottom: 694 },
    propertiesHeader: { x: 0, y: 694, width: 678, height: 20, bottom: 714 },
    selectionSummary: { x: 20, y: 727, width: 638, height: 22, bottom: 749 },
    generalHeader: { x: 0, y: 753, width: 678, height: 20, bottom: 773 },
    threeDHeader: { x: 0, y: 944, width: 678, height: 20, bottom: 964 },
    materialRow: { x: 0, y: 964, width: 678, height: 19, bottom: 983 },
    plotStyleHeader: { x: 0, y: 983, width: 678, height: 20, bottom: 1003 },
    viewHeader: { x: 0, y: 1003, width: 678, height: 20, bottom: 1023 },
    dataHeader: { x: 0, y: 1023, width: 678, height: 20, bottom: 1043 },
  });
  expect(selectedPropertiesGeometry.generalRows).toHaveLength(9);
  expect(selectedPropertiesGeometry.generalRows.every(({ height }) => height === 19)).toBe(true);
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
  await expect(commandLine).toContainText("Count: 3 objects");
  await expect(page.getByRole("complementary", { name: "Properties palette" }).getByText("3 selected")).toBeVisible();

  await page.getByLabel("Layer Properties Manager").getByRole("button", { name: "Uus kiht", exact: true }).click();
  await expect(page.getByRole("table", { name: "Kihtide loend" }).getByText("Layer 1")).toBeVisible();
  const paletteIconography = await page.locator("[data-palette-icon]").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const surface = element.closest(".layer-toolbar") ? "toolbar"
      : element.closest(".layer-filter-rail") ? "filter-rail"
        : element.closest(".layer-grid-row") ? "layer-row"
          : element.closest(".properties-selection-tools") ? "properties-tools"
            : "unknown";
    return {
      kind: element.getAttribute("data-palette-icon"),
      surface,
      width: rect.width,
      height: rect.height,
      pathCount: element.querySelectorAll("path,polyline,rect,circle").length,
    };
  }));
  expect(paletteIconography).toHaveLength(20);
  expect(paletteIconography.filter(({ surface, width, height }) => surface === "toolbar" && width === 16 && height === 16)).toHaveLength(6);
  expect(paletteIconography.filter(({ surface, width, height }) => surface === "filter-rail" && width === 13 && height === 13)).toHaveLength(2);
  expect(paletteIconography.filter(({ surface, width, height }) => surface === "layer-row" && width === 13 && height === 13)).toHaveLength(9);
  expect(paletteIconography.filter(({ surface, width, height }) => surface === "properties-tools" && width === 15 && height === 15)).toHaveLength(3);
  expect(paletteIconography.every(({ pathCount }) => pathCount >= 1)).toBe(true);
  if (captureRoot) await writeFile(resolve(captureRoot, "visual-shell-layer-manager.png"), await page.screenshot());

  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await page.getByRole("button", { name: "Layout 1", exact: true }).click();
  const layoutTools = page.getByTestId("layout-tools");
  await page.getByLabel("Layout tools").click();
  await page.getByLabel("Paigutuse nimi").fill("Layout1");
  await page.getByRole("button", { name: "Nimeta paigutus" }).click();
  await expect(page.getByRole("button", { name: "Layout1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(100);
  await page.getByLabel("Layout tools").click();
  await page.getByRole("button", { name: "Lisa paigutus" }).click();
  await expect(page.getByRole("button", { name: "Layout 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Layout tools").click();
  await page.getByLabel("Paigutuse nimi").fill("Layout2");
  await page.getByRole("button", { name: "Nimeta paigutus" }).click();
  await expect(page.getByRole("button", { name: "Layout2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Layout tools").click();
  await page.getByRole("button", { name: "Layout1", exact: true }).click();
  await expect(page.getByTestId("paper-space-sheet")).toBeVisible();
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
      viewportFrame: bounds("[data-testid='paper-space-viewport']"),
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
  expect(layoutGeometry.sheet).toMatchObject({ x: 727.828125, y: 212, width: 1141.328125, height: 807 });
  expect(layoutGeometry.printable).toMatchObject({ x: 803.046875, y: 237.90625, width: 992.234375, height: 752.3125 });
  expect(layoutGeometry.viewportFrame).toMatchObject({ x: 902.40625, y: 314.59375, width: 792.15625, height: 601.828125 });
  expect(layoutGeometry.layoutbar.height).toBe(37);
  const layoutReadback = await page.getByTestId("paper-space-viewport").evaluate(async (viewportElement) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw", 1);
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<any>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get("local");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    const paper = document.layouts.find((layout: any) => layout.kind === "paper");
    const viewport = paper.viewports[0];
    const canvas = viewportElement.querySelector("canvas")!;
    const worldWidth = viewport.viewHeight * (viewport.width / viewport.height);
    const worldUnitsPerPixel = Math.max(worldWidth / canvas.clientWidth, viewport.viewHeight / canvas.clientHeight);
    const project = (point: { x: number; y: number }) => ({
      x: (point.x - viewport.viewCenter.x) / worldUnitsPerPixel + canvas.clientWidth / 2,
      y: (viewport.viewCenter.y - point.y) / worldUnitsPerPixel + canvas.clientHeight / 2,
    });
    const polyline = document.entities.find((entity: any) => entity.kind === "polyline");
    const circle = document.entities.find((entity: any) => entity.kind === "circle");
    const text = document.entities.find((entity: any) => entity.kind === "text");
    return {
      entityKinds: document.entities.map((entity: any) => entity.kind).sort(),
      paper: paper.paper,
      viewport,
      canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
      renderedViewCenter: viewportElement.getAttribute("data-view-center"),
      renderedViewHeight: Number(viewportElement.getAttribute("data-view-height")),
      projectedFixture: {
        polyline: { closed: polyline.closed, vertices: polyline.vertices.map(project) },
        circle: { center: project(circle.center), radiusPx: circle.radius / worldUnitsPerPixel },
        text: { value: text.text, insertion: project(text.position), heightPx: text.height / worldUnitsPerPixel },
      },
    };
  });
  expect(layoutReadback.entityKinds).toEqual(["circle", "polyline", "text"]);
  expect(layoutReadback.paper).toEqual({ widthMm: 297, heightMm: 210, marginsMm: { top: 6.5, right: 19, bottom: 7.25, left: 19.35 } });
  expect(layoutReadback.viewport).toMatchObject({ center: { x: 148.5, y: 105 }, width: 206.5, height: 157, twistAngleRad: 0, locked: false });
  expect(layoutReadback.canvas).toEqual({ width: 790, height: 600 });
  expect(layoutReadback.renderedViewCenter).toBe(`${layoutReadback.viewport.viewCenter.x},${layoutReadback.viewport.viewCenter.y}`);
  expect(layoutReadback.renderedViewHeight).toBe(layoutReadback.viewport.viewHeight);
  expect(layoutReadback.projectedFixture.polyline.closed).toBe(true);
  expect(layoutReadback.projectedFixture.text.value).toBe("KUUBIK AUDIT");
  const layoutTabGeometry = await page.evaluate(() => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, backgroundColor: style.backgroundColor, color: style.color };
    };
    const tabs = Array.from(document.querySelectorAll<HTMLElement>(".layout-tab"));
    return {
      menu: box(document.querySelector(".layout-tab-menu")!),
      divider: box(document.querySelector(".layout-tab-divider")!),
      tabs: Object.fromEntries(tabs.map((tab) => [tab.textContent?.trim() ?? "", box(tab)])),
      add: box(document.querySelector(".layout-add")!),
      tools: box(document.querySelector(".layout-tools > summary")!),
    };
  });
  expect(Object.keys(layoutTabGeometry.tabs)).toEqual(["Model", "Layout1", "Layout2"]);
  expect(layoutTabGeometry).toMatchObject({
    menu: { x: 8, y: 1047, width: 28, height: 32, right: 36, bottom: 1079 },
    divider: { x: 36, y: 1047, width: 10, height: 32, right: 46, bottom: 1079 },
    tabs: {
      Model: { x: 48, y: 1047, width: 64, height: 32, right: 112, bottom: 1079, backgroundColor: "rgba(0, 0, 0, 0)" },
      Layout1: { x: 112, y: 1047, width: 68, height: 32, right: 180, bottom: 1079, backgroundColor: "rgb(59, 68, 83)" },
      Layout2: { x: 180, y: 1047, width: 64, height: 32, right: 244, bottom: 1079, backgroundColor: "rgba(0, 0, 0, 0)" },
    },
    add: { x: 244, y: 1047, width: 38, height: 32, right: 282, bottom: 1079 },
  });
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
        activeFixture,
        activeModelDisplayReadback,
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
          iconography: ribbonIconography,
          disabled: disabledRibbonState,
          hover: hoverRibbonState,
          active: activeRibbonState,
        },
        modelNavigation,
        modelDisplayReadback,
        selectedProperties: { visible: true, geometry: selectedPropertiesGeometry },
        paletteIconography,
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
        layoutReadback,
        layoutTabGeometry,
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
