export function markerValue(stdout, name) {
  const matches = [...stdout.matchAll(new RegExp(`F012_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
}

export function markerPoint(stdout, name) {
  const value = markerValue(stdout, name);
  if (!value) return null;
  const coordinates = value.split(",").map(Number);
  return coordinates.length === 2 && coordinates.every(Number.isFinite) ? coordinates : null;
}

export function markerPoints(stdout, name) {
  const value = markerValue(stdout, name);
  if (!value) return [];
  return value.split(";").filter(Boolean).map((pair) => pair.split(",").map(Number));
}

export function markerNumbers(stdout, name) {
  const value = markerValue(stdout, name);
  if (!value) return [];
  return value.split(";").filter(Boolean).map(Number);
}

export function parseF012CoreOutput(stdout) {
  return {
    engineVersion: markerValue(stdout, "ACADVER"),
    created: {
      entityType: markerValue(stdout, "CREATED_TYPE"),
      flags: Number(markerValue(stdout, "CREATED_FLAGS")),
      start: markerPoint(stdout, "ORIGINAL_START"),
      end: markerPoint(stdout, "ORIGINAL_END"),
    },
    reversed: {
      start: markerPoint(stdout, "REVERSED_START"),
      end: markerPoint(stdout, "REVERSED_END"),
    },
    closed: {
      flags: Number(markerValue(stdout, "CLOSED_FLAGS")),
      seamDistance: Number(markerValue(stdout, "CLOSED_SEAM_DISTANCE")),
    },
    opened: { flags: Number(markerValue(stdout, "OPENED_FLAGS")) },
    commandUndo: {
      start: markerPoint(stdout, "COMMAND_UNDO_START"),
      expectedStart: markerPoint(stdout, "COMMAND_UNDO_EXPECTED"),
    },
    tolerance: {
      zeroToleranceControlPoints: markerPoints(stdout, "ZERO_TOLERANCE_CONTROL_POINTS"),
      zeroToleranceKnots: markerNumbers(stdout, "ZERO_TOLERANCE_KNOTS"),
      value: Number(markerValue(stdout, "TOLERANCE_VALUE")),
      fitPointCount: Number(markerValue(stdout, "TOLERANCE_FIT_COUNT")),
      controlPointCount: Number(markerValue(stdout, "TOLERANCE_CONTROL_COUNT")),
      controlPoints: markerPoints(stdout, "TOLERANCE_CONTROL_POINTS"),
      knots: markerNumbers(stdout, "TOLERANCE_KNOTS"),
      closestPoints: markerPoints(stdout, "TOLERANCE_CLOSEST_POINTS"),
      deviations: markerNumbers(stdout, "TOLERANCE_DEVIATIONS"),
    },
    toleranceMirror: {
      controlPoints: markerPoints(stdout, "TOLERANCE_MIRROR_CONTROL_POINTS"),
      knots: markerNumbers(stdout, "TOLERANCE_MIRROR_KNOTS"),
      closestPoints: markerPoints(stdout, "TOLERANCE_MIRROR_CLOSEST_POINTS"),
      deviations: markerNumbers(stdout, "TOLERANCE_MIRROR_DEVIATIONS"),
    },
    pointerTangents: {
      startTangent: markerPoint(stdout, "POINTER_TANGENT_START"),
      endTangent: markerPoint(stdout, "POINTER_TANGENT_END"),
      controlPoints: markerPoints(stdout, "POINTER_TANGENT_CONTROL_POINTS"),
      knots: markerNumbers(stdout, "POINTER_TANGENT_KNOTS"),
      startPoint: markerPoint(stdout, "POINTER_TANGENT_START_POINT"),
      endPoint: markerPoint(stdout, "POINTER_TANGENT_END_POINT"),
    },
    fitKink: {
      handleBefore: markerValue(stdout, "KINK_HANDLE_BEFORE"),
      handleAfter: markerValue(stdout, "KINK_HANDLE_AFTER"),
      targetPoint: markerPoint(stdout, "KINK_TARGET_POINT"),
      pointAfter: markerPoint(stdout, "KINK_POINT_AFTER"),
      fitPointCountBefore: Number(markerValue(stdout, "KINK_FIT_COUNT_BEFORE")),
      fitPointCountAfter: Number(markerValue(stdout, "KINK_FIT_COUNT_AFTER")),
      flagsAfter: Number(markerValue(stdout, "KINK_FLAGS_AFTER")),
      degreeAfter: Number(markerValue(stdout, "KINK_DEGREE_AFTER")),
      targetParameter: Number(markerValue(stdout, "KINK_TARGET_PARAMETER")),
      controlPoints: markerPoints(stdout, "KINK_CONTROL_POINTS"),
      fitPoints: markerPoints(stdout, "KINK_FIT_POINTS"),
      knots: markerNumbers(stdout, "KINK_KNOTS"),
      leftDerivative: markerPoint(stdout, "KINK_LEFT_DERIVATIVE"),
      rightDerivative: markerPoint(stdout, "KINK_RIGHT_DERIVATIVE"),
      sampleDeviations: markerNumbers(stdout, "KINK_SAMPLE_DEVIATIONS"),
      maximumDeviation: Number(markerValue(stdout, "KINK_MAX_DEVIATION")),
    },
    cvRefine: {
      handleBefore: markerValue(stdout, "CV_HANDLE_BEFORE"),
      handleAfterAdd: markerValue(stdout, "CV_HANDLE_AFTER_ADD"),
      handleAfterElevate: markerValue(stdout, "CV_HANDLE_AFTER_ELEVATE"),
      sourceDegree: Number(markerValue(stdout, "CV_SOURCE_DEGREE")),
      sourceControlPointCount: Number(markerValue(stdout, "CV_SOURCE_CONTROL_COUNT")),
      sourceKnotCount: Number(markerValue(stdout, "CV_SOURCE_KNOT_COUNT")),
      sourceControlPoints: markerPoints(stdout, "CV_SOURCE_CONTROL_POINTS"),
      sourceKnots: markerNumbers(stdout, "CV_SOURCE_KNOTS"),
      targetParameter: Number(markerValue(stdout, "CV_ADD_TARGET_PARAMETER")),
      targetPoint: markerPoint(stdout, "CV_ADD_TARGET_POINT"),
      pointAfterAdd: markerPoint(stdout, "CV_ADD_POINT_AFTER"),
      addDegree: Number(markerValue(stdout, "CV_ADD_DEGREE")),
      addControlPointCount: Number(markerValue(stdout, "CV_ADD_CONTROL_COUNT")),
      addKnotCount: Number(markerValue(stdout, "CV_ADD_KNOT_COUNT")),
      addControlPoints: markerPoints(stdout, "CV_ADD_CONTROL_POINTS"),
      addKnots: markerNumbers(stdout, "CV_ADD_KNOTS"),
      addSampleDeviations: markerNumbers(stdout, "CV_ADD_SAMPLE_DEVIATIONS"),
      addMaximumDeviation: Number(markerValue(stdout, "CV_ADD_MAX_DEVIATION")),
      elevatedOrder: Number(markerValue(stdout, "CV_ELEVATE_ORDER")),
      elevatedDegree: Number(markerValue(stdout, "CV_ELEVATE_DEGREE")),
      elevatedControlPointCount: Number(markerValue(stdout, "CV_ELEVATE_CONTROL_COUNT")),
      elevatedKnotCount: Number(markerValue(stdout, "CV_ELEVATE_KNOT_COUNT")),
      elevatedControlPoints: markerPoints(stdout, "CV_ELEVATE_CONTROL_POINTS"),
      elevatedKnots: markerNumbers(stdout, "CV_ELEVATE_KNOTS"),
      elevatedSampleDeviations: markerNumbers(stdout, "CV_ELEVATE_SAMPLE_DEVIATIONS"),
      elevatedMaximumDeviation: Number(markerValue(stdout, "CV_ELEVATE_MAX_DEVIATION")),
    },
    objectConversion: {
      sourceType: markerValue(stdout, "OBJECT_SOURCE_TYPE"),
      sourceHandle: markerValue(stdout, "OBJECT_SOURCE_HANDLE"),
      sourceAfter: markerValue(stdout, "OBJECT_SOURCE_AFTER"),
      resultType: markerValue(stdout, "OBJECT_RESULT_TYPE"),
      resultHandle: markerValue(stdout, "OBJECT_RESULT_HANDLE"),
      resultFlags: Number(markerValue(stdout, "OBJECT_RESULT_FLAGS")),
      resultControlPointCount: Number(markerValue(stdout, "OBJECT_RESULT_CONTROL_COUNT")),
      resultFitPointCount: Number(markerValue(stdout, "OBJECT_RESULT_FIT_COUNT")),
      resultControlPoints: markerPoints(stdout, "OBJECT_RESULT_CONTROL_POINTS"),
      resultKnots: markerNumbers(stdout, "OBJECT_RESULT_KNOTS"),
    },
    polylineConversion: {
      sourceHandle: markerValue(stdout, "POLYLINE_SOURCE_HANDLE"),
      sourceAfter: markerValue(stdout, "POLYLINE_SOURCE_AFTER"),
      resultType: markerValue(stdout, "POLYLINE_RESULT_TYPE"),
      resultHandle: markerValue(stdout, "POLYLINE_RESULT_HANDLE"),
      vertexCount: Number(markerValue(stdout, "POLYLINE_RESULT_VERTEX_COUNT")),
      vertices: markerPoints(stdout, "POLYLINE_RESULT_VERTICES"),
      sampleDeviations: markerNumbers(stdout, "POLYLINE_SAMPLE_DEVIATIONS"),
      maximumDeviation: Number(markerValue(stdout, "POLYLINE_MAX_DEVIATION")),
      systemVariablesRestored: markerValue(stdout, "POLYLINE_SYSTEM_VARS_RESTORED") === "1",
    },
    done: markerValue(stdout, "DONE") === "1",
  };
}

function samePoint(left, right, tolerance = 1e-8) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 2 && right.length === 2
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

export function validateF012CoreResult(result) {
  return {
    exactAutoCad2024CommandEngine: result.engineVersion?.startsWith("24.3") === true,
    splineCreated: result.created.entityType === "SPLINE" && result.created.flags === 1064,
    reverseSwapsEndpoints: samePoint(result.reversed.start, result.created.end) && samePoint(result.reversed.end, result.created.start),
    closeCreatesPeriodicClosedSpline: result.closed.flags === 3115 && Math.abs(result.closed.seamDistance) <= 1e-9,
    openRestoresOpenFitSpline: result.opened.flags === 1064,
    commandLocalUndoRestoresDirection: samePoint(result.commandUndo.start, result.commandUndo.expectedStart),
    nonZeroFitToleranceStored: result.tolerance.value === 10 && result.tolerance.fitPointCount === 5 && result.tolerance.controlPointCount === 7,
    toleranceChangesEvaluatedGeometry: result.tolerance.zeroToleranceControlPoints.length === 7 && result.tolerance.controlPoints.length === 7
      && result.tolerance.zeroToleranceControlPoints.some((point, index) => !samePoint(point, result.tolerance.controlPoints[index], 1e-6))
      && result.tolerance.zeroToleranceKnots.length === 11 && result.tolerance.knots.length === 11
      && result.tolerance.zeroToleranceKnots.some((value, index) => Math.abs(value - result.tolerance.knots[index]) > 1e-6)
      && result.tolerance.closestPoints.length === 5
      && result.tolerance.deviations.length === 5
      && result.tolerance.deviations.every((value) => Number.isFinite(value) && value <= 10 + 1e-8)
      && result.tolerance.deviations.some((value) => value > 1e-6),
    mirroredToleranceIsBounded: result.toleranceMirror.controlPoints.length === 7
      && result.toleranceMirror.knots.length === 11
      && result.toleranceMirror.closestPoints.length === 5
      && result.toleranceMirror.deviations.length === 5
      && result.toleranceMirror.deviations.every((value) => Number.isFinite(value) && value <= 10 + 1e-8)
      && result.toleranceMirror.deviations.some((value) => value > 1e-6),
    pointerTangentsFollowSpecifiedDirections: samePoint(result.pointerTangents.startPoint, [0, -500])
      && samePoint(result.pointerTangents.endPoint, [100, -500])
      && samePoint(result.pointerTangents.startTangent, [-1, 0], 1e-6)
      && samePoint(result.pointerTangents.endTangent, [120 / Math.hypot(120, 80), -80 / Math.hypot(120, 80)], 1e-6)
      && result.pointerTangents.controlPoints.length === 5
      && result.pointerTangents.knots.length === 9
      && samePoint([
        3 * (result.pointerTangents.controlPoints[1][0] - result.pointerTangents.controlPoints[0][0]) / (result.pointerTangents.knots[4] - result.pointerTangents.knots[0]),
        3 * (result.pointerTangents.controlPoints[1][1] - result.pointerTangents.controlPoints[0][1]) / (result.pointerTangents.knots[4] - result.pointerTangents.knots[0]),
      ], result.pointerTangents.startTangent, 1e-6)
      && samePoint([
        3 * (result.pointerTangents.controlPoints.at(-1)[0] - result.pointerTangents.controlPoints.at(-2)[0]) / (result.pointerTangents.knots.at(-1) - result.pointerTangents.knots.at(-5)),
        3 * (result.pointerTangents.controlPoints.at(-1)[1] - result.pointerTangents.controlPoints.at(-2)[1]) / (result.pointerTangents.knots.at(-1) - result.pointerTangents.knots.at(-5)),
      ], result.pointerTangents.endTangent, 1e-6),
    fitKinkPreservesGeometryAndCreatesC0Capacity: result.fitKink.handleBefore === result.fitKink.handleAfter
      && result.fitKink.fitPointCountBefore === 5
      && result.fitKink.fitPointCountAfter === 0
      && result.fitKink.flagsAfter === 1288
      && result.fitKink.degreeAfter === 3
      && samePoint(result.fitKink.targetPoint, result.fitKink.pointAfter, 1e-6)
      && result.fitKink.controlPoints.length === 10
      && result.fitKink.fitPoints.length === 0
      && result.fitKink.knots.length === 14
      && result.fitKink.knots.filter((value) => Math.abs(value - result.fitKink.targetParameter) <= 1e-6).length === 3
      && result.fitKink.controlPoints.some((point) => samePoint(point, result.fitKink.targetPoint, 1e-6))
      && result.fitKink.sampleDeviations.length === 21
      && result.fitKink.sampleDeviations.every((value) => Number.isFinite(value) && value <= 1e-9)
      && result.fitKink.maximumDeviation <= 1e-9,
    cvAddAndElevatePreserveGeometry: result.cvRefine.handleBefore === result.cvRefine.handleAfterAdd
      && result.cvRefine.handleBefore === result.cvRefine.handleAfterElevate
      && result.cvRefine.sourceDegree === 3
      && result.cvRefine.sourceControlPointCount === 4
      && result.cvRefine.sourceKnotCount === 8
      && result.cvRefine.sourceControlPoints.length === 4
      && result.cvRefine.sourceKnots.length === 8
      && samePoint(result.cvRefine.targetPoint, result.cvRefine.pointAfterAdd, 1e-6)
      && result.cvRefine.addDegree === 3
      && result.cvRefine.addControlPointCount === 5
      && result.cvRefine.addKnotCount === 9
      && result.cvRefine.addControlPoints.length === 5
      && result.cvRefine.addKnots.length === 9
      && result.cvRefine.addKnots.filter((value) => Math.abs(value - result.cvRefine.targetParameter) <= 1e-6).length === 1
      && result.cvRefine.addSampleDeviations.length === 21
      && result.cvRefine.addSampleDeviations.every((value) => Number.isFinite(value) && value <= 1e-9)
      && result.cvRefine.addMaximumDeviation <= 1e-9
      && result.cvRefine.elevatedOrder === 5
      && result.cvRefine.elevatedDegree === 4
      && result.cvRefine.elevatedControlPointCount === 7
      && result.cvRefine.elevatedKnotCount === 12
      && result.cvRefine.elevatedControlPoints.length === 7
      && result.cvRefine.elevatedKnots.length === 12
      && result.cvRefine.elevatedKnots.filter((value) => Math.abs(value - result.cvRefine.targetParameter) <= 1e-6).length === 2
      && result.cvRefine.elevatedSampleDeviations.length === 21
      && result.cvRefine.elevatedSampleDeviations.every((value) => Number.isFinite(value) && value <= 1e-9)
      && result.cvRefine.elevatedMaximumDeviation <= 1e-9,
    objectConversionCreatesSpline: result.objectConversion.sourceType === "POLYLINE"
      && result.objectConversion.sourceAfter === "ERASED"
      && result.objectConversion.resultType === "SPLINE"
      && typeof result.objectConversion.sourceHandle === "string"
      && typeof result.objectConversion.resultHandle === "string"
      && result.objectConversion.resultFlags === 8
      && result.objectConversion.resultControlPointCount === 4
      && result.objectConversion.resultFitPointCount === 0
      && result.objectConversion.resultControlPoints.length === 4
      && result.objectConversion.resultKnots.length === 8,
    convertToPolylineCreatesBoundedLinearApproximation: result.polylineConversion.sourceAfter === "ERASED"
      && result.polylineConversion.resultType === "LWPOLYLINE"
      && typeof result.polylineConversion.sourceHandle === "string"
      && typeof result.polylineConversion.resultHandle === "string"
      && result.polylineConversion.resultHandle !== result.polylineConversion.sourceHandle
      && result.polylineConversion.vertexCount === result.polylineConversion.vertices.length
      && result.polylineConversion.vertexCount > 4
      && result.polylineConversion.sampleDeviations.length === 21
      && result.polylineConversion.sampleDeviations.every((value) => Number.isFinite(value) && value >= 0)
      && result.polylineConversion.maximumDeviation > 0
      && result.polylineConversion.maximumDeviation < 1
      && result.polylineConversion.systemVariablesRestored === true,
    scriptCompleted: result.done === true,
  };
}
