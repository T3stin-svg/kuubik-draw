#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifact = async (name) => JSON.parse(await readFile(resolve(root, "evidence/artifacts", name), "utf8"));
const [autoCad, browser, independent] = await Promise.all([
  artifact("F-100-autocad-readback.json"),
  artifact("F-100-browser-readback.json"),
  artifact("F-100-independent-readback.json"),
]);
const close = (a, b, tolerance = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const samePoint = (a, b, tolerance = 1e-9) => close(a?.x, b?.x, tolerance) && close(a?.y, b?.y, tolerance);

if (
  autoCad.status !== "PASS" || browser.status !== "PASS" || independent.status !== "PASS" ||
  !samePoint(autoCad.nativeTransform?.anchorWorld, independent.cursorZoom?.anchorModel) ||
  !samePoint(autoCad.nativeTransform?.zoom?.state?.target, independent.cursorZoom?.viewport?.viewCenter) ||
  !samePoint(autoCad.nativeTransform?.pan?.expectedTarget, independent.rotatedPan?.viewport?.viewCenter) ||
  !samePoint(autoCad.customPanned?.target, independent.rotatedPan?.viewport?.viewCenter) ||
  !samePoint(autoCad.nativeTransform?.normalizedBefore, independent.cursorZoom?.normalizedCursor) ||
  !samePoint(autoCad.nativeTransform?.normalizedAfter, independent.cursorZoom?.normalizedCursor) ||
  !close(autoCad.nativeTransform?.axisDevice?.screenSlope, -Math.tan(Math.PI / 6), 1e-9) ||
  !close(browser.matrix?.presetPixels?.slope, autoCad.nativeTransform?.axisDevice?.screenSlope, 0.002) ||
  Math.abs(browser.matrix?.cursorZoom?.markerPixelDelta?.x) > 0.5 ||
  Math.abs(browser.matrix?.cursorZoom?.markerPixelDelta?.y) > 0.5 ||
  !samePoint(browser.matrix?.panned?.center, browser.matrix?.pan?.expectedCenter)
) throw new Error("F-100 AutoCAD, Chromium and independent camera evidence no longer agree.");

console.log("F-100 cross-evidence PASS (native DisplayDCS = core transform; painted twist and cursor marker agree). ");
