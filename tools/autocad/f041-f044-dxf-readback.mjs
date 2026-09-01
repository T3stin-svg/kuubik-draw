const REQUIRED_HEADERS = Object.freeze({
  $INSUNITS: 70,
  $LUNITS: 70,
  $LUPREC: 70,
  $AUNITS: 70,
  $AUPREC: 70,
  $ANGBASE: 50,
  $ANGDIR: 70,
});

function close(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-15, Number.EPSILON * 8 * Math.max(1, Math.abs(left), Math.abs(right)));
}

function pairs(bytes) {
  const text = Buffer.from(bytes).toString("utf8").replaceAll("\r", "");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2 !== 0) throw new TypeError("Coordinate DXF has an unpaired group-code line.");
  return Array.from({ length: lines.length / 2 }, (_, index) => {
    const code = lines[index * 2]?.trim() ?? "";
    if (!/^-?\d+$/u.test(code)) throw new TypeError(`Coordinate DXF group code at line ${index * 2 + 1} is malformed.`);
    return { code: Number(code), value: lines[index * 2 + 1]?.trim() ?? "" };
  });
}

function numeric(value, label) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) throw new TypeError(`Coordinate DXF ${label} is not numeric.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`Coordinate DXF ${label} is not finite.`);
  return result;
}

function header(groups) {
  const start = groups.findIndex((group, index) => group.code === 0 && group.value === "SECTION"
    && groups[index + 1]?.code === 2 && groups[index + 1]?.value === "HEADER");
  const end = groups.findIndex((group, index) => index > start && group.code === 0 && group.value === "ENDSEC");
  if (start < 0 || end < 0) throw new TypeError("Coordinate DXF HEADER section is missing or unterminated.");
  const result = {};
  for (let index = start + 2; index < end; index += 1) {
    const group = groups[index];
    if (group?.code !== 9 || !(group.value in REQUIRED_HEADERS)) continue;
    if (Object.hasOwn(result, group.value)) throw new TypeError(`Coordinate DXF repeats ${group.value}.`);
    const next = groups[index + 1];
    if (next?.code !== REQUIRED_HEADERS[group.value]) throw new TypeError(`Coordinate DXF ${group.value} requires group ${REQUIRED_HEADERS[group.value]}.`);
    result[group.value] = numeric(next.value, group.value);
  }
  for (const name of Object.keys(REQUIRED_HEADERS)) if (!Object.hasOwn(result, name)) throw new TypeError(`Coordinate DXF ${name} is missing.`);
  return result;
}

function entities(groups) {
  const result = [];
  let current = null;
  const one = (entity, code) => {
    const values = entity.groups.filter((group) => group.code === code);
    if (values.length !== 1) throw new TypeError(`Coordinate DXF ${entity.type} ${entity.handle ?? "?"} requires one group ${code}.`);
    return numeric(values[0].value, `${entity.type} group ${code}`);
  };
  const flush = () => {
    if (!current || !["LINE", "LWPOLYLINE"].includes(current.type)) return;
    if (!current.handle || !current.layer) throw new TypeError(`Coordinate DXF ${current.type} requires handle and layer.`);
    if (result.some((entity) => entity.handle === current.handle)) throw new TypeError(`Coordinate DXF repeats handle ${current.handle}.`);
    if (current.type === "LINE") {
      result.push({ type: "LINE", handle: current.handle, layer: current.layer, start: [one(current, 10), one(current, 20), one(current, 30)], end: [one(current, 11), one(current, 21), one(current, 31)] });
      return;
    }
    const vertices = [];
    for (let index = 0; index < current.groups.length; index += 1) {
      if (current.groups[index]?.code !== 10) continue;
      const y = current.groups.slice(index + 1).find((group) => group.code === 20 || group.code === 10);
      if (y?.code !== 20) throw new TypeError(`Coordinate DXF LWPOLYLINE ${current.handle} vertex lacks group 20.`);
      vertices.push([numeric(current.groups[index].value, "LWPOLYLINE X"), numeric(y.value, "LWPOLYLINE Y"), 0]);
    }
    const declared = one(current, 90);
    if (declared !== vertices.length || vertices.length < 2) throw new TypeError(`Coordinate DXF LWPOLYLINE ${current.handle} vertex count disagrees.`);
    const flags = current.groups.find((group) => group.code === 70);
    result.push({ type: "LWPOLYLINE", handle: current.handle, layer: current.layer, vertices, closed: Boolean(Number(flags?.value ?? 0) & 1) });
  };
  for (const group of groups) {
    if (group.code === 0) { flush(); current = { type: group.value, groups: [], handle: null, layer: null }; continue; }
    if (!current) continue;
    current.groups.push(group);
    if (group.code === 5) current.handle = group.value;
    if (group.code === 8) current.layer = group.value;
  }
  flush();
  return result;
}

export function parseCoordinateDxf(bytes) {
  const groups = pairs(bytes);
  return { header: header(groups), entities: entities(groups) };
}

function pointMatches(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((value, index) => close(value, expected[index]));
}

export function validateCoordinateDxf(bytes, matrix) {
  const parsed = parseCoordinateDxf(bytes);
  const context = matrix?.observations?.coordinateContext;
  const expected = matrix?.observations?.redone ?? [];
  const headersExact = Boolean(context)
    && close(parsed.header.$INSUNITS, context.insunits) && close(parsed.header.$LUNITS, context.lunits)
    && close(parsed.header.$LUPREC, context.luprec) && close(parsed.header.$AUNITS, context.aunits)
    && close(parsed.header.$AUPREC, context.auprec) && close(parsed.header.$ANGDIR, context.angdir)
    && close(parsed.header.$ANGBASE, context.angbase * 180 / Math.PI);
  const match = (actual, reference) => actual.type === (reference.objectName === "AcDbLine" ? "LINE" : "LWPOLYLINE")
    && actual.handle === reference.handle && actual.layer === reference.layer
    && (actual.type === "LINE"
      ? pointMatches(actual.start, reference.start) && pointMatches(actual.end, reference.end)
      : actual.closed === reference.closed && actual.vertices.length === reference.vertices.length
        && actual.vertices.every((point, index) => pointMatches(point, reference.vertices[index])));
  const entitiesExact = parsed.entities.length === expected.length
    && expected.every((reference) => parsed.entities.some((actual) => match(actual, reference)));
  return { ...parsed, requiredHeaderVariablesExact: headersExact, entityCountExact: parsed.entities.length === expected.length, entityCoordinatesWithinEightUlps: entitiesExact };
}
