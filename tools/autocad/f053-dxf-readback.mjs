const REQUIRED_HEADER_VARIABLES = Object.freeze({
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
  if (lines.length % 2 !== 0) throw new TypeError("F-053 DXF has an unpaired group-code line.");
  const result = [];
  for (let index = 0; index < lines.length; index += 2) {
    const codeText = lines[index]?.trim() ?? "";
    if (!/^-?\d+$/u.test(codeText)) throw new TypeError(`F-053 DXF group code at line ${index + 1} is malformed.`);
    result.push({ code: Number(codeText), value: lines[index + 1]?.trim() ?? "" });
  }
  return result;
}

function numeric(value, name) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) {
    throw new TypeError(`F-053 DXF ${name} value is not numeric.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`F-053 DXF ${name} value is not finite.`);
  return parsed;
}

function headerVariables(groups) {
  const sectionStart = groups.findIndex((group, index) => group.code === 0 && group.value === "SECTION"
    && groups[index + 1]?.code === 2 && groups[index + 1]?.value === "HEADER");
  if (sectionStart < 0) throw new TypeError("F-053 DXF HEADER section is missing.");
  const end = groups.findIndex((group, index) => index > sectionStart && group.code === 0 && group.value === "ENDSEC");
  if (end < 0) throw new TypeError("F-053 DXF HEADER section is unterminated.");
  const values = {};
  for (let index = sectionStart + 2; index < end; index += 1) {
    const group = groups[index];
    if (group?.code !== 9 || !(group.value in REQUIRED_HEADER_VARIABLES)) continue;
    if (Object.hasOwn(values, group.value)) throw new TypeError(`F-053 DXF repeats ${group.value}.`);
    const data = groups[index + 1];
    const expectedCode = REQUIRED_HEADER_VARIABLES[group.value];
    if (!data || data.code !== expectedCode) throw new TypeError(`F-053 DXF ${group.value} requires group ${expectedCode}.`);
    values[group.value] = numeric(data.value, group.value);
  }
  for (const name of Object.keys(REQUIRED_HEADER_VARIABLES)) {
    if (!Object.hasOwn(values, name)) throw new TypeError(`F-053 DXF ${name} is missing.`);
  }
  return values;
}

function lineEntities(groups) {
  const result = [];
  let current = null;
  const flush = () => {
    if (!current || current.type !== "LINE") return;
    const one = (code) => {
      const values = current.groups.filter((group) => group.code === code);
      if (values.length !== 1) throw new TypeError(`F-053 DXF LINE ${current.handle ?? "?"} requires one group ${code}.`);
      return numeric(values[0].value, `LINE group ${code}`);
    };
    if (!current.handle) throw new TypeError("F-053 DXF LINE handle is missing.");
    result.push({
      handle: current.handle,
      start: [one(10), one(20), one(30)],
      end: [one(11), one(21), one(31)],
    });
  };
  for (const group of groups) {
    if (group.code === 0) {
      flush();
      current = { type: group.value, groups: [], handle: null };
      continue;
    }
    if (!current) continue;
    current.groups.push(group);
    if (group.code === 5) current.handle = group.value;
  }
  flush();
  return result;
}

export function parseF053Dxf(bytes) {
  const groups = pairs(bytes);
  return { header: headerVariables(groups), lines: lineEntities(groups) };
}

export function validateF053Dxf(bytes, matrix) {
  const parsed = parseF053Dxf(bytes);
  const expected = matrix?.observations?.committed;
  const expectedGeometry = matrix?.observations?.geometry?.committed;
  const line = parsed.lines.find((candidate) => candidate.handle === expectedGeometry?.handle);
  const pointMatches = (actual, reference) => Array.isArray(actual) && Array.isArray(reference)
    && actual.length === reference.length && actual.every((value, index) => close(value, reference[index]));
  const settingsMatch = Boolean(expected)
    && close(parsed.header.$INSUNITS, expected.insunits)
    && close(parsed.header.$LUNITS, expected.lunits)
    && close(parsed.header.$LUPREC, expected.luprec)
    && close(parsed.header.$AUNITS, expected.aunits)
    && close(parsed.header.$AUPREC, expected.auprec)
    && close(parsed.header.$ANGBASE, expected.angbase * 180 / Math.PI)
    && close(parsed.header.$ANGDIR, expected.angdir);
  return {
    ...parsed,
    requiredHeaderVariablesExact: settingsMatch,
    geometryCoordinatesWithinEightUlps: Boolean(line) && pointMatches(line.start, expectedGeometry.start) && pointMatches(line.end, expectedGeometry.end),
  };
}
