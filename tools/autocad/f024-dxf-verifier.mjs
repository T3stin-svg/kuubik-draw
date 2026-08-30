const near = (actual, expected, tolerance = 1e-6) => Number.isFinite(actual)
  && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;

const normalizedAngle = (angle) => ((angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
const sameAngle = (actual, expected) => near(normalizedAngle(actual), normalizedAngle(expected));
const point = (value) => Array.isArray(value) ? value : [value?.x, value?.y];
const samePoint = (actual, expected) => near(point(actual)[0], expected?.[0]) && near(point(actual)[1], expected?.[1]);
const samePoints = (actual, expected) => Array.isArray(actual) && Array.isArray(expected)
  && actual.length === expected.length && actual.every((value, index) => samePoint(value, expected[index]));
const sameNumbers = (actual, expected) => Array.isArray(actual) && Array.isArray(expected)
  && actual.length === expected.length && actual.every((value, index) => near(value, expected[index]));
const normalizedSplineWeights = (actual, controlPointCount) => {
  const values = Array.isArray(actual) && actual.length > 0
    ? actual
    : Array.from({ length: controlPointCount }, () => 1);
  if (values.length !== controlPointCount || values.some((value) => !Number.isFinite(value))
    || Math.abs(values[0]) <= 1e-12) return null;
  return values.map((value) => value / values[0]);
};
const sameSplineWeights = (actual, expected, controlPointCount) => sameNumbers(
  normalizedSplineWeights(actual, controlPointCount),
  normalizedSplineWeights(expected, controlPointCount),
);
const dxfLineweight = (entity) => entity?.lineweight ?? -1;
const liveType = (entity) => ({
  AcDbLine: "LINE",
  AcDbCircle: "CIRCLE",
  AcDbArc: "ARC",
  AcDbEllipse: "ELLIPSE",
  AcDbSpline: "SPLINE",
})[entity?.objectName];

function exactGeometry(entity, expected) {
  if (expected.type === "LINE") return samePoints(entity.vertices, expected.vertices);
  if (expected.type === "CIRCLE") return samePoint(entity.center, expected.center) && near(entity.radius, expected.radius);
  if (expected.type === "ARC") return samePoint(entity.center, expected.center) && near(entity.radius, expected.radius)
    && sameAngle(entity.startAngle, expected.startAngle) && sameAngle(entity.endAngle, expected.endAngle);
  if (expected.type === "ELLIPSE") return samePoint(entity.center, expected.center)
    && samePoint(entity.majorAxis, expected.majorAxis) && near(entity.ratio, expected.ratio)
    && near(entity.startAngle, expected.startParameter) && near(entity.endAngle, expected.endParameter);
  if (expected.type === "SPLINE") return entity.degree === expected.degree && entity.closed === expected.closed
    && samePoints(entity.controlPoints, expected.controlPoints)
    && samePoints(entity.fitPoints ?? [], expected.savedFitPoints ?? expected.fitPoints)
    && sameNumbers(entity.knots, expected.knots)
    && sameSplineWeights(entity.weights, expected.weights, expected.controlPoints.length);
  return false;
}

function exactLiveGeometry(entity, expected) {
  const details = entity?.details ?? {};
  if (expected.type === "LINE") return samePoints([details.start, details.end], expected.vertices);
  if (expected.type === "CIRCLE") return samePoint(details.center, expected.center) && near(details.radius, expected.radius);
  if (expected.type === "ARC") return samePoint(details.center, expected.center) && near(details.radius, expected.radius)
    && sameAngle(details.startAngle, expected.startAngle) && sameAngle(details.endAngle, expected.endAngle);
  if (expected.type === "ELLIPSE") return samePoint(details.center, expected.center)
    && samePoint(details.majorAxis, expected.majorAxis) && near(details.radiusRatio, expected.ratio)
    && near(details.startParameter, expected.startParameter) && near(details.endParameter, expected.endParameter);
  if (expected.type === "SPLINE") return details.degree === expected.degree && details.closed === expected.closed
    && samePoints(details.controlPoints, expected.controlPoints) && samePoints(details.fitPoints, expected.fitPoints)
    && sameNumbers(details.knots, expected.knots)
    && sameSplineWeights(details.weights, expected.weights, expected.controlPoints.length);
  return false;
}

export function exactDirectFamilyGeometry(readback, observations, expectedFamilies) {
  const layers = readback?.selectedLayerEntities ?? {};
  if (!expectedFamilies || typeof expectedFamilies !== "object") return false;
  const usedHandles = new Set();
  return Object.entries(expectedFamilies).every(([layer, expectedEntities]) => {
    const savedEntities = layers[layer] ?? [];
    const liveEntities = observations?.[layer] ?? [];
    if (savedEntities.length !== expectedEntities.length || liveEntities.length !== expectedEntities.length) return false;
    return expectedEntities.every((expected) => {
      const saved = savedEntities.find((entity) => entity.type === expected.type && exactGeometry(entity, expected));
      if (!saved || usedHandles.has(saved.handle) || !/^[A-F0-9]+$/u.test(saved.handle ?? "")) return false;
      usedHandles.add(saved.handle);
      const live = liveEntities.find((entity) => entity.handle === saved.handle);
      return saved.layer === layer && live?.layer === layer && liveType(live) === expected.type
        && saved.colorNumber === expected.colorNumber && dxfLineweight(saved) === expected.lineweight
        && live.color === expected.colorNumber && live.lineweight === expected.lineweight
        && exactLiveGeometry(live, expected);
    });
  });
}
