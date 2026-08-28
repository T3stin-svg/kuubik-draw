#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifact = async (name) => JSON.parse(await readFile(resolve(root, "evidence/artifacts", name), "utf8"));
const [autoCad, browser, independent] = await Promise.all([
  artifact("F-101-autocad-readback.json"),
  artifact("F-101-browser-readback.json"),
  artifact("F-101-independent-readback.json"),
]);
const sameViewportCamera = (a, b) => JSON.stringify({
  center: a?.viewCenter,
  height: a?.viewHeight,
  scale: a?.customScale,
  twist: a?.twistAngleRad,
  target: a?.target,
}) === JSON.stringify({
  center: b?.viewCenter,
  height: b?.viewHeight,
  scale: b?.customScale,
  twist: b?.twistAngleRad,
  target: b?.target,
});

if (
  autoCad.status !== "PASS" || browser.status !== "PASS" || independent.status !== "PASS" ||
  autoCad.initial?.displayLocked !== false || autoCad.locked?.displayLocked !== true ||
  !sameViewportCamera(autoCad.locked, autoCad.afterLockedZoom) || !sameViewportCamera(autoCad.locked, autoCad.afterLockedPan) ||
  autoCad.afterLockedEdit?.line?.start?.x !== 100 || autoCad.afterLockedEdit?.line?.start?.y !== 50 ||
  autoCad.unlocked?.displayLocked !== false || autoCad.relocked?.displayLocked !== true || autoCad.afterReopen?.displayLocked !== true ||
  browser.matrix?.locked?.locked !== true || browser.matrix?.locked?.navigationEnabled !== false ||
  JSON.stringify(browser.matrix?.afterLockedWheel) !== JSON.stringify(browser.matrix?.locked) ||
  JSON.stringify(browser.matrix?.afterLockedPan) !== JSON.stringify(browser.matrix?.locked) ||
  JSON.stringify(browser.matrix?.afterLockedDirect) !== JSON.stringify(browser.matrix?.locked) ||
  browser.matrix?.afterLockedEdit?.entityCount !== 2 || browser.matrix?.zoomed?.navigationEnabled !== true ||
  browser.matrix?.relocked?.locked !== true || browser.document?.viewport?.locked !== true ||
  independent.lockedViewport?.locked !== true || independent.refusals?.zoom?.code !== "VIEWPORT_LOCKED" || independent.refusals?.pan?.code !== "VIEWPORT_LOCKED" || independent.refusals?.direct?.code !== "VIEWPORT_LOCKED" ||
  independent.refusals?.revisionBefore !== independent.refusals?.revisionAfter || independent.refusals?.cameraUnchanged !== true ||
  independent.modelEdit?.entity?.start?.x !== 100 || independent.modelEdit?.entity?.start?.y !== 50 ||
  independent.unlockedViewport?.locked !== false || independent.relockedViewport?.locked !== true || independent.document?.viewport?.locked !== true
) throw new Error("F-101 AutoCAD, Chromium and independent display-lock evidence no longer agree.");

console.log("F-101 cross-evidence PASS (native DisplayLocked = browser/core lock lifecycle and display-only boundary). ");
