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
  for (const evidencePath of [state.kuubikEvidence, state.supplementalKuubikEvidence, state.measuredReadback, state.supplementalMeasuredReadback, state.comparisonReadback, state.supplementalComparisonReadback]) {
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
  const surfaceMatch = ribbonComparison.surface.autoCad === "#3b4453"
    && ribbonComparison.surface.kuubik === "rgb(59, 68, 83)"
    && panelNames.length === 10
    && panelNames.every((name) => ribbon.panels[name].backgroundColor === "rgb(59, 68, 83)");
  const commandExtensionBounded = ribbon.commandPanel.x === 1673
    && ribbon.commandPanel.right === VISUAL_BASELINE.viewport.width
    && ribbon.commandPanel.height === 92;
  const interactionStatesDistinct = ribbon.disabled.color === "rgb(126, 135, 142)"
    && ribbon.hover.backgroundColor === "rgb(72, 81, 90)"
    && ribbon.active.backgroundColor === "rgb(23, 111, 159)"
    && ribbon.hover.backgroundColor !== ribbon.active.backgroundColor;
  if (!boundaryMatch || !surfaceMatch || !commandExtensionBounded || !interactionStatesDistinct || ribbonComparison.status !== "PASS") {
    throw new Error("Home ribbon supplement is outside the measured AutoCAD reference tolerance");
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
