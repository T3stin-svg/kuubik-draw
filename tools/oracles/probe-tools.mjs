import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

const pins = JSON.parse(await readFile(new URL("./pins.json", import.meta.url), "utf8"));

async function existing(path) {
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

async function findExecutable(configured, names, commonPaths, environment) {
  if (configured) return existing(configured);
  for (const directory of (environment.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const found = await existing(join(directory, name));
      if (found) return found;
    }
  }
  for (const path of commonPaths) {
    const found = await existing(path);
    if (found) return found;
  }
  return null;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function versionOutput(executable, args) {
  try {
    return execFileSync(executable, args, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    return [stdout, stderr].filter(Boolean).join("\n").slice(0, 2000);
  }
}

export async function probeOracles(environment = process.env) {
  const libreCad = await findExecutable(
    environment.LIBRECAD_CMD,
    ["librecad.exe", "librecad"],
    [
      "C:\\Program Files\\LibreCAD\\LibreCAD.exe",
      "C:\\Program Files (x86)\\LibreCAD\\LibreCAD.exe",
    ],
    environment,
  );
  const freeCad = await findExecutable(
    environment.FREECAD_CMD,
    ["FreeCADCmd.exe", "FreeCADCmd", "freecadcmd"],
    [
      join(environment.LOCALAPPDATA ?? "", "Programs", "FreeCAD 1.1", "bin", "freecadcmd.exe"),
      "C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe",
      "C:\\Program Files\\FreeCAD 1.1.3\\bin\\FreeCADCmd.exe",
    ],
    environment,
  );

  const report = [];
  if (!libreCad) {
    report.push({ oracle: "librecad", expected: "2.2.1.5", status: "NOT_RUN", certificationAuthority: false, reason: "Executable not found." });
  } else {
    const executableSha256 = await sha256(libreCad);
    const executableSha256MatchesPin = executableSha256 === pins.librecad.executableSha256;
    const output = executableSha256MatchesPin ? versionOutput(libreCad, ["dxf2pdf", "--version"]) : "NOT_EXECUTED_UNAPPROVED_SHA256";
    const versionMatchesPin = executableSha256MatchesPin && /LibreCAD\s+v?2\.2\.1\.5\b/u.test(output);
    report.push({
      oracle: "librecad",
      expected: "2.2.1.5",
      status: versionMatchesPin && executableSha256MatchesPin ? "AVAILABLE" : "AVAILABLE_UNVERIFIED",
      versionMatchesPin,
      executableSha256MatchesPin,
      certificationAuthority: false,
      executable: libreCad,
      executableSha256,
      expectedExecutableSha256: pins.librecad.executableSha256,
      versionOutput: output,
    });
  }
  if (!freeCad) {
    report.push({ oracle: "freecad", expected: "1.1.3", status: "NOT_RUN", certificationAuthority: false, reason: "Executable not found." });
  } else {
    const executableSha256 = await sha256(freeCad);
    const executableSha256MatchesPin = executableSha256 === pins.freecad.executableSha256;
    const output = executableSha256MatchesPin ? versionOutput(freeCad, ["--version"]) : "NOT_EXECUTED_UNAPPROVED_SHA256";
    const versionMatchesPin = executableSha256MatchesPin && /FreeCAD\s+1\.1\.3\b/u.test(output);
    report.push({
      oracle: "freecad",
      expected: "1.1.3",
      status: versionMatchesPin && executableSha256MatchesPin ? "AVAILABLE" : "AVAILABLE_UNVERIFIED",
      versionMatchesPin,
      executableSha256MatchesPin,
      certificationAuthority: false,
      executable: freeCad,
      executableSha256,
      expectedExecutableSha256: pins.freecad.executableSha256,
      versionOutput: output,
    });
  }
  return report;
}
