import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-9) => Math.abs(left - right) <= tolerance;

export async function isolatedEnvironment(environment, directory) {
  const profile = join(directory, "profile");
  const appData = join(profile, "AppData", "Roaming");
  const localAppData = join(profile, "AppData", "Local");
  const temporary = join(directory, "temp");
  const pythonCache = join(directory, "python-cache");
  await Promise.all([
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(temporary, { recursive: true }),
    mkdir(pythonCache, { recursive: true }),
  ]);
  const output = {
    ALL_PROXY: "http://127.0.0.1:9",
    APPDATA: appData,
    HOME: profile,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    LOCALAPPDATA: localAppData,
    NO_PROXY: "",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: pythonCache,
    TEMP: temporary,
    TMP: temporary,
    USERPROFILE: profile,
  };
  for (const name of ["ComSpec", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "SystemRoot", "WINDIR"]) {
    if (typeof environment[name] === "string") output[name] = environment[name];
  }
  return output;
}

export function run(executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} exited ${result.status}: ${(result.stderr ?? result.stdout ?? "").slice(0, 2000)}`);
  }
  return result;
}

const libreCadFixturePath = new URL("./fixtures/librecad-line-circle.dxf", import.meta.url);

function countOperator(content, operator) {
  return (content.match(new RegExp(`(?:^|\\s)${operator}(?=\\s|$)`, "gu")) ?? []).length;
}

function parsePaintedPaths(content) {
  const painted = [];
  const operands = [];
  let path = { moves: [], lines: [], curves: [] };
  let current = null;
  let subpath = -1;
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
  const paintOperators = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
  const resetPath = () => { path = { moves: [], lines: [], curves: [] }; current = null; subpath = -1; };
  for (const token of content.split(/\s+/u).filter(Boolean)) {
    if (number.test(token)) { operands.push(Number(token)); continue; }
    if (token === "m" && operands.length >= 2) {
      const point = operands.slice(-2);
      subpath += 1;
      path.moves.push({ point, subpath });
      current = point;
    } else if (token === "l" && operands.length >= 2 && current) {
      const point = operands.slice(-2);
      path.lines.push({ from: current, to: point, subpath });
      current = point;
    } else if (token === "c" && operands.length >= 6 && current) {
      const values = operands.slice(-6);
      const point = values.slice(4);
      path.curves.push({ from: current, controls: [values.slice(0, 2), values.slice(2, 4)], to: point, subpath });
      current = point;
    } else if (paintOperators.has(token)) {
      if (path.moves.length > 0) painted.push(path);
      resetPath();
    } else if (token === "n") {
      resetPath();
    }
    operands.length = 0;
  }
  return painted;
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

export function readPdfPaintedGeometry(content) {
  const paths = parsePaintedPaths(content);
  const linePath = paths
    .filter((path) => path.lines.length >= 2)
    .map((path) => ({ path, longest: path.lines.toSorted((left, right) => distance(right.from, right.to) - distance(left.from, left.to)).slice(0, 2) }))
    .toSorted((left, right) => distance(right.longest[0].from, right.longest[0].to) - distance(left.longest[0].from, left.longest[0].to))[0];
  const circlePath = paths.find((path) => path.moves.length >= 2 && path.curves.filter((curve) => curve.subpath === 0).length === 4);
  if (!linePath || linePath.longest.length !== 2 || !circlePath) return null;

  const orient = (segment) => segment.from[0] < segment.to[0] || (segment.from[0] === segment.to[0] && segment.from[1] <= segment.to[1])
    ? segment
    : { ...segment, from: segment.to, to: segment.from };
  const lineEdges = linePath.longest.map(orient);
  const lineStart = [(lineEdges[0].from[0] + lineEdges[1].from[0]) / 2, (lineEdges[0].from[1] + lineEdges[1].from[1]) / 2];
  const lineEnd = [(lineEdges[0].to[0] + lineEdges[1].to[0]) / 2, (lineEdges[0].to[1] + lineEdges[1].to[1]) / 2];
  const outerCurves = circlePath.curves.filter((curve) => curve.subpath === 0);
  const circlePoints = [circlePath.moves.find((move) => move.subpath === 0).point, ...outerCurves.map((curve) => curve.to)];
  const xs = circlePoints.map((point) => point[0]);
  const ys = circlePoints.map((point) => point[1]);
  const circleCenter = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const circleRadius = ((Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys))) / 4;
  const lineLength = distance(lineStart, lineEnd);
  const unit = [(lineEnd[0] - lineStart[0]) / lineLength, (lineEnd[1] - lineStart[1]) / lineLength];
  const normal = [-unit[1], unit[0]];
  const midpoint = [(lineStart[0] + lineEnd[0]) / 2, (lineStart[1] + lineEnd[1]) / 2];
  const expectedCenters = [1, -1].map((sign) => [midpoint[0] + sign * normal[0] * lineLength / 2, midpoint[1] + sign * normal[1] * lineLength / 2]);
  const centerError = Math.min(...expectedCenters.map((expected) => distance(expected, circleCenter)));
  const radiusError = Math.abs(circleRadius - lineLength / 10);
  return {
    line: { start: lineStart, end: lineEnd, length: lineLength },
    circle: { center: circleCenter, radius: circleRadius, cubicSegments: outerCurves.length },
    inferredUniformTransform: {
      scale: lineLength / 100,
      centerError,
      centerErrorNormalized: centerError / lineLength,
      radiusError,
      radiusErrorNormalized: radiusError / lineLength,
    },
  };
}

function readPdfStreams(bytes) {
  const text = bytes.toString("latin1");
  const decoded = [];
  const streams = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gsu;
  for (const match of text.matchAll(streams)) {
    const dictionary = match[1] ?? "";
    let stream = Buffer.from(match[2] ?? "", "latin1");
    if (/\/FlateDecode\b/u.test(dictionary)) {
      try {
        stream = inflateSync(stream);
      } catch {
        continue;
      }
    } else if (/\/Filter\b/u.test(dictionary)) {
      continue;
    }
    decoded.push(stream.toString("latin1"));
  }
  const content = decoded.join("\n");
  const paintedPathOperators = ["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]
    .reduce((total, operator) => total + countOperator(content, operator.replace("*", "\\*")), 0);
  return {
    decodedStreams: decoded.length,
    moveToOperators: countOperator(content, "m"),
    lineToOperators: countOperator(content, "l"),
    cubicCurveOperators: countOperator(content, "c"),
    paintedPathOperators,
    geometry: readPdfPaintedGeometry(content),
  };
}

export function readPdf(bytes) {
  const text = bytes.toString("latin1");
  const media = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(text);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    hasPdfHeader: text.startsWith("%PDF-"),
    hasEof: /%%EOF\s*$/u.test(text),
    pages: (text.match(/\/Type\s*\/Page(?!s)\b/gu) ?? []).length,
    imageXObjects: (text.match(/\/Subtype\s*\/Image\b/gu) ?? []).length,
    mediaBox: media ? media.slice(1).map(Number) : null,
    vectorOperators: readPdfStreams(bytes),
  };
}

async function runLibreCad(tool, environment, directory) {
  const input = join(directory, "librecad-oracle.dxf");
  const output = join(directory, "librecad-oracle.pdf");
  const fixtureBytes = await readFile(libreCadFixturePath);
  await writeFile(input, fixtureBytes);
  const processEnvironment = await isolatedEnvironment(environment, directory);
  const process = run(tool.executable, ["dxf2pdf", "--fit", "--paper", "210x297", "-o", output, input], {
    cwd: directory,
    env: processEnvironment,
  });
  const pdf = readPdf(await readFile(output));
  const checks = {
    exitCodeZero: process.status === 0,
    exactSyntheticInput: sha256(fixtureBytes) === sha256(await readFile(input)),
    validSinglePageVectorPdf: pdf.hasPdfHeader && pdf.hasEof && pdf.pages === 1 && pdf.imageXObjects === 0,
    exactA4MediaBox: Array.isArray(pdf.mediaBox) && close(pdf.mediaBox[0], 0) && close(pdf.mediaBox[1], 0) && close(pdf.mediaBox[2], 595, 0.01) && close(pdf.mediaBox[3], 842, 0.01),
    lineAndCircleGeometryReadBack: pdf.vectorOperators.geometry?.circle?.cubicSegments === 4
      && pdf.vectorOperators.geometry?.line?.length > 0
      && pdf.vectorOperators.geometry?.inferredUniformTransform?.centerErrorNormalized < 0.00005
      && pdf.vectorOperators.geometry?.inferredUniformTransform?.radiusErrorNormalized < 0.00005,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`LibreCAD fixture mismatch: ${JSON.stringify({ checks, pdf })}`);
  return {
    fixture: "synthetic LINE + CIRCLE DXF to A4 vector PDF",
    inputSha256: sha256(fixtureBytes),
    output: pdf,
    checks,
  };
}

async function runFreeCad(tool, environment, directory) {
  const payload = {
    operation: "intersections",
    a: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    b: [{ x: 0, y: 10 }, { x: 10, y: 0 }],
  };
  const input = `${JSON.stringify(payload)}\n`;
  const sourceScript = resolve(import.meta.dirname, "freecad-headless.py");
  const script = join(directory, "freecad-headless.py");
  await writeFile(script, await readFile(sourceScript));
  const processEnvironment = await isolatedEnvironment(environment, directory);
  const process = run(tool.executable, [
    "--safe-mode",
    "-u", join(directory, "freecad-user.cfg"),
    "-s", join(directory, "freecad-system.cfg"),
    script,
  ], {
    cwd: directory,
    env: processEnvironment,
    input,
  });
  const jsonLine = process.stdout.split(/\r?\n/u).find((line) => line.trimStart().startsWith("{"));
  if (!jsonLine) throw new Error(`FreeCAD fixture did not emit JSON: ${process.stdout.slice(0, 2000)}`);
  const output = JSON.parse(jsonLine);
  const version = output.freecadVersion;
  const intersection = output.result?.[0];
  const checks = {
    exitCodeZero: process.status === 0,
    statusPass: output.status === "PASS",
    notCertificationAuthority: output.certificationAuthority === false,
    exactPinnedVersion: Array.isArray(version) && version[0] === "1" && version[1] === "1" && version[2] === "3",
    exactPinnedCommit: Array.isArray(version) && version.includes("145529fe741292ff0b3977a01195bf0247425794"),
    exactIntersection: output.result?.length === 1 && close(intersection?.x, 5) && close(intersection?.y, 5),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`FreeCAD fixture mismatch: ${JSON.stringify({ checks, output })}`);
  return {
    fixture: "synthetic crossing-line OCCT intersection",
    inputSha256: sha256(input),
    output,
    checks,
  };
}

export async function runOracleFixtures(tools, environment = process.env, networkIsolation = { proven: false }) {
  const results = [];
  for (const tool of tools) {
    if (tool.status !== "AVAILABLE" || tool.versionMatchesPin !== true || tool.executableSha256MatchesPin !== true) {
      results.push(tool);
      continue;
    }
    const directory = await mkdtemp(join(tmpdir(), `kuubik-${tool.oracle}-oracle-`));
    try {
      const fixtureReport = tool.oracle === "librecad"
        ? await runLibreCad(tool, environment, directory)
        : await runFreeCad(tool, environment, directory);
      results.push({
        ...tool,
        status: networkIsolation.proven === true ? "PASS" : "FIXTURE_PASS_NOT_NETWORK_ISOLATED",
        certificationAuthority: false,
        sandbox: {
          disposableDirectory: true,
          workingAndIoDirectoryIsDisposable: true,
          inheritedEnvironmentAllowlisted: true,
          filesystemProfileIsDisposable: true,
          windowsRegistryProfileIsolationProven: false,
          inputPolicy: "synthetic-only",
          networkIsolationProven: networkIsolation.proven === true,
          networkPolicy: networkIsolation.proven === true ? "signed protected-runner os-egress-deny attestation" : "not isolated; dead-proxy variables are defense in depth only",
          networkAttestation: networkIsolation.proven === true ? networkIsolation : undefined,
          timeoutMs: 30_000,
          oneProcessPerFixture: true,
        },
        fixtureReport,
      });
    } catch (error) {
      results.push({
        ...tool,
        status: "FAIL",
        certificationAuthority: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return results;
}
