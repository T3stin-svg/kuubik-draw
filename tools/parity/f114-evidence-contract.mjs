#!/usr/bin/env node

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const close = (actual, expected, tolerance) => finite(actual) && finite(expected) && Math.abs(actual - expected) <= tolerance;
const arrayClose = (actual, expected, tolerance) =>
  Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => close(value, expected[index], tolerance));
const segmentsClose = (actual, expected, tolerance) =>
  Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((segment, index) => {
    const wanted = expected[index];
    return segment?.operator === wanted?.operator && Array.isArray(segment?.points) && Array.isArray(wanted?.points) && segment.points.length === wanted.points.length &&
      segment.points.every((point, pointIndex) => arrayClose(point, wanted.points[pointIndex], tolerance));
  });

function findPath(page, colour, operators) {
  return page?.strokedPaths?.find((path) =>
    arrayClose(path?.strokeColor, colour, 0.000001) && path?.segments?.map((segment) => segment.operator).join("|") === operators.join("|"));
}

function expectedCircleSegments(circle) {
  const [cx, cy] = circle.centerPt;
  const radius = circle.radiusPt;
  const control = radius * circle.bezierKappa;
  return [
    { operator: "m", points: [[cx + radius, cy]] },
    { operator: "c", points: [[cx + radius, cy + control], [cx + control, cy + radius], [cx, cy + radius]] },
    { operator: "c", points: [[cx - control, cy + radius], [cx - radius, cy + control], [cx - radius, cy]] },
    { operator: "c", points: [[cx - radius, cy - control], [cx - control, cy - radius], [cx, cy - radius]] },
    { operator: "c", points: [[cx + control, cy - radius], [cx + radius, cy - control], [cx + radius, cy]] },
  ];
}

export function evaluateF114KuubikPdf(document, renderedPixels, expectedRoot) {
  const expected = expectedRoot?.kuubikPdf;
  const pages = document?.pageDetails ?? [];
  const reasons = [];
  if (!expected) reasons.push("expected-contract-missing");
  if (document?.strictParsed !== expected?.strict) reasons.push("strict-parse");
  if (document?.pages !== expected?.pages || pages.length !== expected?.pages) reasons.push("page-count");
  const geometryTolerance = expected?.geometryTolerancePt ?? 0;
  const renderTolerance = expected?.renderTolerancePx ?? 0;
  const alphaTolerance = expected?.alphaTolerance ?? 0;
  for (let index = 0; index < (expected?.pages ?? 0); index += 1) {
    const page = pages[index];
    const size = expected.pageSizesPt[index];
    if (!page || !arrayClose([page.mediaBox?.[2], page.mediaBox?.[3]], size, geometryTolerance)) reasons.push(`page-${index + 1}-size`);
    if (page?.rotation !== expected.pageRotations[index]) reasons.push(`page-${index + 1}-rotation`);
    if (page?.imageXObjects !== expected.maxImageXObjects || page?.plumberImages !== expected.maxImageXObjects) reasons.push(`page-${index + 1}-raster`);
  }
  for (const text of expected?.requiredText ?? []) {
    if (!pages.some((page) => page?.text?.includes(text))) reasons.push(`text:${text}`);
  }
  const transparency = expected?.transparency;
  const transparencyPage = pages[(transparency?.page ?? 0) - 1];
  const transparencyState = transparencyPage?.extGStateValues?.[transparency?.resource];
  if (!close(transparencyState?.strokeAlpha, transparency?.strokeAlpha, alphaTolerance) || !close(transparencyState?.fillAlpha, transparency?.fillAlpha, alphaTolerance)) reasons.push("extgstate-alpha");

  const lineExpected = expected?.modelLine;
  const linePage = pages[(lineExpected?.page ?? 0) - 1];
  const line = findPath(linePage, lineExpected?.strokeColour, lineExpected?.segments?.map((segment) => segment.operator) ?? []);
  if (!line || line.gState !== lineExpected.gState || !close(line.strokeAlpha, transparency?.strokeAlpha, alphaTolerance) || !segmentsClose(line.segments, lineExpected.segments, geometryTolerance) || !arrayClose(line.bbox, lineExpected.bboxPt, geometryTolerance)) reasons.push("model-line-geometry-alpha");

  const circleExpected = expected?.modelCircle;
  const circlePage = pages[(circleExpected?.page ?? 0) - 1];
  const circleOperators = ["m", ...Array(circleExpected?.curveSegments ?? 0).fill("c")];
  const circle = findPath(circlePage, circleExpected?.strokeColour, circleOperators);
  const circleSegments = circleExpected ? expectedCircleSegments(circleExpected) : [];
  if (!circle || circle.gState !== circleExpected?.gState || !segmentsClose(circle.segments, circleSegments, geometryTolerance) || !arrayClose(circle.bbox, circleExpected?.bboxPt, geometryTolerance)) reasons.push("model-circle-bezier");

  for (const borderExpected of expected?.borders ?? []) {
    const page = pages[borderExpected.page - 1];
    const border = findPath(page, [0, 0, 0], ["m", "l", "l", "l", "h"]);
    if (!border || border.insideMediaBox !== true || !arrayClose(border.bbox, borderExpected.bboxPt, geometryTolerance)) reasons.push(`page-${borderExpected.page}-border-vector-bbox`);
    if (renderedPixels) {
      const rendered = renderedPixels.images?.[`page${borderExpected.page}`];
      if (!arrayClose(rendered?.bboxes?.black, borderExpected.renderedBlackBBoxPx, renderTolerance)) reasons.push(`page-${borderExpected.page}-border-poppler-bbox`);
    }
  }
  if (renderedPixels && !(renderedPixels.images?.page1?.counts?.redAlphaOnWhite > 0)) reasons.push("page-1-poppler-alpha");
  return { pass: reasons.length === 0, reasons };
}

export function assertF114KuubikPdf(document, renderedPixels, expectedRoot, label) {
  const result = evaluateF114KuubikPdf(document, renderedPixels, expectedRoot);
  if (!result.pass) throw new Error(`${label} violates F-114 PDF contract: ${result.reasons.join(", ")}`);
  return result;
}
