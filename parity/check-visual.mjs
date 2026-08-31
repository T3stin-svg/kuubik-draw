import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VISUAL_ACCEPTANCE, VISUAL_BASELINE, VISUAL_STATES } from "./autocad-2024-visual.manifest.mjs";

function near(actual, expected, tolerance = 1e-10) {
  return Math.abs(actual - expected) <= tolerance;
}

if (VISUAL_BASELINE.categories.length !== VISUAL_ACCEPTANCE.categoryCount) {
  throw new Error(`Visual category denominator changed: ${VISUAL_BASELINE.categories.length}`);
}
if (VISUAL_STATES.length !== VISUAL_ACCEPTANCE.stateCount) {
  throw new Error(`Visual state denominator changed: ${VISUAL_STATES.length}`);
}

const categoryIds = new Set(VISUAL_BASELINE.categories.map(({ id }) => id));
const stateIds = new Set(VISUAL_STATES.map(({ id }) => id));
if (categoryIds.size !== VISUAL_BASELINE.categories.length || stateIds.size !== VISUAL_STATES.length) {
  throw new Error("Visual manifest contains duplicate ids");
}

const weight = VISUAL_BASELINE.categories.reduce((sum, row) => sum + row.weight, 0);
const score = VISUAL_BASELINE.categories.reduce((sum, row) => sum + row.weight * row.score, 0);
if (!near(weight, 1) || !near(score, VISUAL_BASELINE.baselineScore)) {
  throw new Error(`Visual baseline mismatch: weight=${weight}, score=${score}`);
}

const allStatesPassed = VISUAL_STATES.every((state) => state.status === VISUAL_ACCEPTANCE.requiredStatusForScoreIncrease
  && state.autoCadEvidence && state.kuubikEvidence && state.measuredReadback && state.comparisonReadback);
if (VISUAL_BASELINE.claimedScore > VISUAL_BASELINE.baselineScore && !allStatesPassed) {
  throw new Error("Visual score cannot increase before all six paired states and read-backs PASS");
}

for (const state of VISUAL_STATES) {
  for (const evidencePath of [state.kuubikEvidence, state.supplementalKuubikEvidence, state.measuredReadback, state.supplementalMeasuredReadback, state.comparisonReadback, state.supplementalComparisonReadback, state.chromeComparisonReadback, state.bottomComparisonReadback]) {
    if (evidencePath) await access(resolve(evidencePath));
  }
}

const shellState = VISUAL_STATES.find(({ id }) => id === "empty-workspace");
const shellMetrics = JSON.parse(await readFile(resolve(shellState.measuredReadback), "utf8"));
if (shellMetrics.viewport[0] !== VISUAL_BASELINE.viewport.width || shellMetrics.viewport[1] !== VISUAL_BASELINE.viewport.height) {
  throw new Error(`Visual shell viewport mismatch: ${shellMetrics.viewport.join("x")}`);
}
if (shellMetrics.consoleErrors.length !== 0) throw new Error("Visual shell capture contains console errors");

if (shellState.supplementalComparisonReadback && shellState.supplementalMeasuredReadback) {
  const browserReadback = JSON.parse(await readFile(resolve(shellState.supplementalMeasuredReadback), "utf8"));
  const ribbonComparison = JSON.parse(await readFile(resolve(shellState.supplementalComparisonReadback), "utf8"));
  const ribbon = browserReadback.states.ribbon;
  const panelNames = Object.keys(ribbon.panels);
  const boundaryMatch = ribbonComparison.panels.length === 10
    && ribbonComparison.panels.every(({ rightDeltaPx }) => Math.abs(rightDeltaPx) <= VISUAL_ACCEPTANCE.zoneTolerancePx);
  const largeIconKinds = new Set(["line", "text", "insert", "match-properties", "paste", "base-view"]);
  const iconographyExact = ribbonComparison.iconSource === "original-kuubik-inline-svg"
    && ribbonComparison.iconography.length === 35
    && ribbonComparison.iconography.every(({ kind, width, height, pathCount }) => {
      const expectedSize = largeIconKinds.has(kind) ? 34 : 18;
      return width === expectedSize && height === expectedSize && pathCount >= 1;
    });
  const surfaceMatch = ribbonComparison.surface.autoCad === "#3b4453"
    && ribbonComparison.surface.kuubik === "rgb(59, 68, 83)"
    && panelNames.length === 10
    && panelNames.every((name) => ribbon.panels[name].backgroundColor === "rgb(59, 68, 83)");
  const commandExtensionBounded = ribbon.commandPanel.x === 1673
    && ribbon.commandPanel.right === VISUAL_BASELINE.viewport.width
    && ribbon.commandPanel.height === 99;
  const interactionStatesDistinct = ribbon.disabled.color === "rgb(126, 135, 142)"
    && ribbon.hover.backgroundColor === "rgb(72, 81, 90)"
    && ribbon.active.backgroundColor === "rgb(23, 111, 159)"
    && ribbon.hover.backgroundColor !== ribbon.active.backgroundColor;
  if (!boundaryMatch || !surfaceMatch || !iconographyExact || !commandExtensionBounded || !interactionStatesDistinct || ribbonComparison.status !== "PASS") {
    throw new Error("Home ribbon supplement is outside the measured AutoCAD reference tolerance");
  }
}

if (shellState.chromeComparisonReadback && shellState.supplementalMeasuredReadback) {
  const browserReadback = JSON.parse(await readFile(resolve(shellState.supplementalMeasuredReadback), "utf8"));
  const chromeComparison = JSON.parse(await readFile(resolve(shellState.chromeComparisonReadback), "utf8"));
  const chrome = browserReadback.states.topChrome;
  const zoneNames = ["titlebar", "ribbonTabs", "ribbon", "documentTabs"];
  const zonesBounded = zoneNames.every((name) => Math.abs(chromeComparison.actualZones[name].y - chromeComparison.expectedZones[name].y) <= 1
    && Math.abs(chromeComparison.actualZones[name].height - chromeComparison.expectedZones[name].height) <= 1);
  const surfacesExact = chromeComparison.surfaces.titlebar.autoCad === "#222933"
    && chromeComparison.surfaces.titlebar.kuubik === "rgb(34, 41, 51)"
    && chromeComparison.surfaces.ribbonTabs.autoCad === "#222933"
    && chromeComparison.surfaces.ribbon.autoCad === "#3b4453"
    && chromeComparison.surfaces.ribbon.kuubik === "rgb(59, 68, 83)"
    && chromeComparison.surfaces.documentTabs.autoCad === "#222933";
  const controlsBounded = chrome.title.applicationMark.x === 15
    && chrome.title.applicationMark.width === 24
    && Math.abs(chrome.title.workspace.x - 574) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(chrome.title.workspace.width - 180) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && chrome.ribbonTabs.home.x === 0
    && chrome.ribbonTabs.home.right === 55
    && chrome.documentTabs.drawing.x === 90
    && Math.abs(chrome.documentTabs.drawing.right - 185) <= VISUAL_ACCEPTANCE.zoneTolerancePx;
  if (!zonesBounded || !surfacesExact || !controlsBounded || chromeComparison.status !== "PASS") {
    throw new Error("Top application chrome supplement is outside the measured AutoCAD reference tolerance");
  }
}

if (shellState.bottomComparisonReadback && shellState.supplementalMeasuredReadback) {
  const browserReadback = JSON.parse(await readFile(resolve(shellState.supplementalMeasuredReadback), "utf8"));
  const bottomComparison = JSON.parse(await readFile(resolve(shellState.bottomComparisonReadback), "utf8"));
  const bottom = browserReadback.states.bottomChrome;
  const geometryBounded = Math.abs(bottom.layoutStatus.y - 1043) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(bottom.layoutStatus.height - 37) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(bottom.statusbar.y - 1047) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(bottom.statusbar.height - 32) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(bottom.statusbar.bottom - 1079) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx;
  const surfacesExact = bottomComparison.surfaces.separator.autoCad === "#3b4453"
    && bottomComparison.surfaces.separator.kuubik === "rgb(59, 68, 83)"
    && bottomComparison.surfaces.content.autoCad === "#222933"
    && bottomComparison.surfaces.content.kuubik === "rgb(34, 41, 51)"
    && bottomComparison.surfaces.accent.autoCad === "#0696d7"
    && bottomComparison.surfaces.accent.kuubik === "rgb(6, 150, 215)";
  const controlsHonest = bottomComparison.statusControls.grid.disabled === false
    && bottomComparison.statusControls.grid.pressed === "true"
    && ["ortho", "osnap", "otrack", "dyn"].every((name) => bottomComparison.statusControls[name].disabled === true
      && bottomComparison.statusControls[name].pressed === null);
  if (!geometryBounded || !surfacesExact || !controlsHonest || bottomComparison.status !== "PASS") {
    throw new Error("Shared bottom chrome is outside the measured AutoCAD reference tolerance");
  }
}

const activeDrawingState = VISUAL_STATES.find(({ id }) => id === "active-drawing-command");
if (activeDrawingState.comparisonReadback) {
  const browserReadback = JSON.parse(await readFile(resolve(activeDrawingState.measuredReadback), "utf8"));
  const activeComparison = JSON.parse(await readFile(resolve(activeDrawingState.comparisonReadback), "utf8"));
  const fixture = browserReadback.states.activeFixture;
  const grid = browserReadback.states.activeModelDisplayReadback;
  const fixtureExact = fixture.previewCommand === "LINE"
    && fixture.entityCount === 3
    && fixture.handles.join(",") === "B1,B2,B3"
    && fixture.selectedHandles.length === 0
    && Math.abs(fixture.crosshair.centerX - 846.5) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(fixture.crosshair.centerY - 984.5) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx;
  const gridExact = grid.verticalGridRuns.length === 121 && grid.horizontalGridRuns.length === 84;
  const activeUiExact = activeComparison.activeUi?.ribbon?.backgroundColor === "rgb(23, 111, 159)"
    && activeComparison.activeUi?.ribbon?.borderColor === "rgb(104, 180, 223)"
    && activeComparison.activeUi?.commandLine?.width === 0
    && activeComparison.activeUi?.commandLine?.height === 0;
  if (!fixtureExact || !gridExact || !activeUiExact || activeComparison.status !== "PASS") {
    throw new Error("Active LINE fixture is outside the measured AutoCAD reference tolerance");
  }
}

const selectedPropertiesState = VISUAL_STATES.find(({ id }) => id === "selected-properties");
if (selectedPropertiesState.status === "PASS") {
  const browserReadback = JSON.parse(await readFile(resolve(selectedPropertiesState.measuredReadback), "utf8"));
  const selectedComparison = JSON.parse(await readFile(resolve(selectedPropertiesState.comparisonReadback), "utf8"));
  const fixture = browserReadback.states.selectedFixture;
  const geometry = browserReadback.states.selectedProperties?.geometry;
  const fixtureExact = fixture.handles.join(",") === "A1,A2,A3"
    && fixture.selectedHandles.join(",") === "A1,A2,A3"
    && fixture.entityKinds.join(",") === "circle,polyline,text"
    && fixture.polyline.closed
    && Math.abs(fixture.circle.center.x - 1298) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(fixture.circle.center.y - 503) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(fixture.circle.radiusPx - 123.5) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx;
  const paletteExact = geometry.generalRows.length === 9
    && Math.abs(geometry.palette.width - 680) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(geometry.layerManager.height - 513) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(geometry.propertiesHeader.y - 694) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(geometry.dataHeader.bottom - 1043) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx;
  const gripsExact = selectedComparison.selectionFeedback?.expectedSelectionColor === "#0478ec"
    && selectedComparison.selectionFeedback?.expectedGripFill === "#007fff"
    && selectedComparison.selectionFeedback?.expectedGripStroke === "#283747"
    && selectedComparison.selectionFeedback?.gripCenters?.length === 14
    && selectedComparison.selectionFeedback.gripCenters.every(({ autoCad, kuubik }) => autoCad === "#007fff" && kuubik === "#007fff");
  const viewIndicatorExact = JSON.stringify(selectedComparison.actualViewIndicator) === JSON.stringify(selectedComparison.expectedViewIndicator);
  const paletteIconsExact = selectedComparison.paletteIconSource === "original-kuubik-inline-svg"
    && selectedComparison.paletteIconography.length === 20
    && selectedComparison.paletteIconography.every(({ pathCount }) => pathCount >= 1);
  if (!fixtureExact || !paletteExact || !gripsExact || !viewIndicatorExact || !paletteIconsExact || selectedComparison.status !== "PASS") {
    throw new Error("Selected-object and Properties state is outside the measured AutoCAD reference tolerance");
  }
}

const layoutState = VISUAL_STATES.find(({ id }) => id === "layout-paper-space");
if (layoutState.comparisonReadback) {
  const browserReadback = JSON.parse(await readFile(resolve(layoutState.measuredReadback), "utf8"));
  const layoutComparison = JSON.parse(await readFile(resolve(layoutState.comparisonReadback), "utf8"));
  const geometry = browserReadback.states.layoutGeometry;
  const fixture = browserReadback.states.layoutReadback?.projectedFixture;
  const geometryBounded = Math.abs(geometry.sheet.x - 727) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(geometry.sheet.y - 212) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(geometry.printable.x - 803) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(geometry.printable.y - 238) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(geometry.viewportFrame.x - 902) <= VISUAL_ACCEPTANCE.zoneTolerancePx
    && Math.abs(geometry.viewportFrame.y - 314) <= VISUAL_ACCEPTANCE.zoneTolerancePx;
  const fixtureLive = fixture?.polyline?.closed === true
    && fixture?.text?.value === "KUUBIK AUDIT"
    && Math.abs(fixture.circle.radiusPx - 95) <= VISUAL_ACCEPTANCE.zoneTolerancePx;
  const layoutToolsExact = layoutComparison.layoutTools?.compactByDefault === true
    && layoutComparison.layoutTools?.openStateVerified === true
    && layoutComparison.layoutTools?.pageSetupStillReachable === true;
  if (!geometryBounded || !fixtureLive || !layoutToolsExact || layoutComparison.status !== "PASS") {
    throw new Error("Layout/paper-space fixture is outside the measured AutoCAD reference tolerance");
  }
}

const commandHistoryState = VISUAL_STATES.find(({ id }) => id === "command-history-context");
if (commandHistoryState.status === "PASS") {
  const browserReadback = JSON.parse(await readFile(resolve(commandHistoryState.measuredReadback), "utf8"));
  const comparisonReadback = JSON.parse(await readFile(resolve(commandHistoryState.comparisonReadback), "utf8"));
  const actual = browserReadback.states.commandHistoryGeometry;
  const reference = comparisonReadback.measuredReference.commandHistory;
  const bounded = ["x", "y", "width", "height", "contentTop", "contentBottom", "promptTop"]
    .every((key) => Math.abs(actual[key] - reference[key]) <= VISUAL_ACCEPTANCE.zoneTolerancePx);
  const colorsExact = actual.titlebarBackgroundColor === "rgb(255, 255, 255)"
    && actual.menubarBackgroundColor === "rgb(255, 255, 255)"
    && actual.contentBackgroundColor === "rgb(200, 200, 200)"
    && actual.promptBackgroundColor === "rgb(255, 255, 255)";
  if (!bounded || !colorsExact || comparisonReadback.nativeCapture.status !== "PASS") {
    throw new Error("Command-history paired visual state is outside the measured AutoCAD reference tolerance");
  }

  const contextMenu = browserReadback.states.contextMenu?.geometry;
  const contextReference = comparisonReadback.measuredReference.contextMenu;
  const contextDimensionsExact = Math.abs(contextMenu.width - contextReference.width) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx
    && Math.abs(contextMenu.height - contextReference.height) <= VISUAL_ACCEPTANCE.repeatedControlTolerancePx;
  const contextColorsExact = contextMenu.backgroundColor === `rgb(${contextReference.backgroundRgb.join(", ")})`
    && contextMenu.borderColor === `rgb(${contextReference.borderRgb.join(", ")})`;
  const interactionStatesComplete = browserReadback.states.contextMenu.activeCommand
    && browserReadback.states.contextMenu.selectedObject
    && browserReadback.states.contextMenu.keyboardNavigation
    && browserReadback.states.contextMenu.escapeDismissalPreservesCommandAndSelection
    && browserReadback.states.contextMenu.cancelAction
    && browserReadback.states.contextMenu.countAction;
  if (!contextDimensionsExact || !contextColorsExact || !interactionStatesComplete || comparisonReadback.nativeContextCapture.status !== "PASS") {
    throw new Error("Drawing context-menu supplement is outside the measured AutoCAD reference tolerance");
  }
}

console.log(`Visual parity: ${(VISUAL_BASELINE.claimedScore * 100).toFixed(1)}% (baseline held; ${VISUAL_STATES.filter(({ status }) => status === "PASS").length}/${VISUAL_STATES.length} paired states PASS)`);
