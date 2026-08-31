import type { CadBlockDefinition, CadBlockReference, CadEntity, CadPoint2 } from "@kuubik/cad-schema";

const EPSILON = 1e-9;

export function transformBlockPoint(point: CadPoint2, definition: CadBlockDefinition, insert: CadBlockReference): CadPoint2 {
  const localX = (point.x - definition.basePoint.x) * insert.scale.x;
  const localY = (point.y - definition.basePoint.y) * insert.scale.y;
  const cosine = Math.cos(insert.rotationRad);
  const sine = Math.sin(insert.rotationRad);
  return {
    x: insert.insertion.x + localX * cosine - localY * sine,
    y: insert.insertion.y + localX * sine + localY * cosine,
  };
}

function transformVector(vector: CadPoint2, insert: CadBlockReference): CadPoint2 {
  const scaledX = vector.x * insert.scale.x;
  const scaledY = vector.y * insert.scale.y;
  const cosine = Math.cos(insert.rotationRad);
  const sine = Math.sin(insert.rotationRad);
  return { x: scaledX * cosine - scaledY * sine, y: scaledX * sine + scaledY * cosine };
}

export function transformExplodedEntity(entity: CadEntity, definition: CadBlockDefinition, insert: CadBlockReference): CadEntity {
  const next = structuredClone(entity);
  switch (next.kind) {
    case "line": return { ...next, start: transformBlockPoint(next.start, definition, insert), end: transformBlockPoint(next.end, definition, insert) };
    case "ray":
    case "xline": return { ...next, basePoint: transformBlockPoint(next.basePoint, definition, insert), direction: transformVector(next.direction, insert) };
    case "polyline": return { ...next, vertices: next.vertices.map((vertex) => ({ ...vertex, ...transformBlockPoint(vertex, definition, insert) })) };
    case "circle": {
      const center = transformBlockPoint(next.center, definition, insert);
      if (Math.abs(Math.abs(insert.scale.x) - Math.abs(insert.scale.y)) <= EPSILON) return { ...next, center, radius: next.radius * Math.abs(insert.scale.x) };
      const majorAlongX = Math.abs(insert.scale.x) >= Math.abs(insert.scale.y);
      const major = next.radius * (majorAlongX ? Math.abs(insert.scale.x) : Math.abs(insert.scale.y));
      const minor = next.radius * (majorAlongX ? Math.abs(insert.scale.y) : Math.abs(insert.scale.x));
      const baseAxis = majorAlongX ? { x: next.radius, y: 0 } : { x: 0, y: next.radius };
      const axis = transformVector(baseAxis, insert);
      const length = Math.hypot(axis.x, axis.y);
      return { kind: "ellipse", handle: next.handle, layerId: next.layerId, center, majorAxis: { x: axis.x / length * major, y: axis.y / length * major }, ratio: minor / major, startParameter: 0, endParameter: Math.PI * 2, ...(next.appearance ? { appearance: next.appearance } : {}), ...(next.extensionData ? { extensionData: next.extensionData } : {}) };
    }
    case "arc": {
      if (Math.abs(Math.abs(insert.scale.x) - Math.abs(insert.scale.y)) > EPSILON) throw new RangeError("Non-uniformly scaled arc cannot be exploded without an elliptical-arc schema type.");
      return { ...next, center: transformBlockPoint(next.center, definition, insert), radius: next.radius * Math.abs(insert.scale.x), startAngleRad: next.startAngleRad + insert.rotationRad, endAngleRad: next.endAngleRad + insert.rotationRad };
    }
    case "ellipse": {
      const axis = transformVector(next.majorAxis, insert);
      const majorScale = Math.hypot(axis.x, axis.y) / Math.hypot(next.majorAxis.x, next.majorAxis.y);
      const perpendicular = transformVector({ x: -next.majorAxis.y * next.ratio, y: next.majorAxis.x * next.ratio }, insert);
      const minorScale = Math.hypot(perpendicular.x, perpendicular.y) / (Math.hypot(next.majorAxis.x, next.majorAxis.y) * next.ratio);
      const orthogonality = Math.abs(axis.x * perpendicular.x + axis.y * perpendicular.y) / (Math.hypot(axis.x, axis.y) * Math.hypot(perpendicular.x, perpendicular.y));
      if (orthogonality > EPSILON) throw new RangeError("Non-uniform ellipse transform would require a shear-capable schema type.");
      return { ...next, center: transformBlockPoint(next.center, definition, insert), majorAxis: axis, ratio: next.ratio * minorScale / majorScale, startParameter: next.startParameter, endParameter: next.endParameter };
    }
    case "spline": return { ...next, controlPoints: next.controlPoints.map((point) => transformBlockPoint(point, definition, insert)) };
    case "text":
    case "mtext": return { ...next, position: transformBlockPoint(next.position, definition, insert), height: next.height * Math.sqrt(Math.abs(insert.scale.x * insert.scale.y)), rotationRad: next.rotationRad + insert.rotationRad };
    case "leader": return { ...next, vertices: next.vertices.map((point) => transformBlockPoint(point, definition, insert)) };
    case "dimension": return { ...next, definitionPoints: next.definitionPoints.map((point) => transformBlockPoint(point, definition, insert)) };
    case "hatch": return { ...next, loops: next.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => transformBlockPoint(point, definition, insert)) })) };
    case "blockRef": {
      if (Math.abs(Math.abs(insert.scale.x) - Math.abs(insert.scale.y)) > EPSILON && Math.abs(next.rotationRad) > EPSILON) throw new RangeError("Nested rotated INSERT under non-uniform scale would require a shear transform.");
      return {
        ...next,
        insertion: transformBlockPoint(next.insertion, definition, insert),
        scale: { x: next.scale.x * insert.scale.x, y: next.scale.y * insert.scale.y },
        rotationRad: next.rotationRad + insert.rotationRad,
      };
    }
    case "proxy": {
      if (!next.bounds) return next;
      const corners = [next.bounds.min, next.bounds.max, { x: next.bounds.min.x, y: next.bounds.max.y }, { x: next.bounds.max.x, y: next.bounds.min.y }].map((point) => transformBlockPoint(point, definition, insert));
      return { ...next, bounds: { min: { x: Math.min(...corners.map((point) => point.x)), y: Math.min(...corners.map((point) => point.y)) }, max: { x: Math.max(...corners.map((point) => point.x)), y: Math.max(...corners.map((point) => point.y)) } } };
    }
  }
}
