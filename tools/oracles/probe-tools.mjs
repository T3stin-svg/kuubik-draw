import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

async function existing(path) {
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

async function findExecutable(configured, names, commonPaths) {
  if (configured) return existing(configured);
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
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
  );
  const freeCad = await findExecutable(
    environment.FREECAD_CMD,
    ["FreeCADCmd.exe", "FreeCADCmd", "freecadcmd"],
    [
      "C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe",
      "C:\\Program Files\\FreeCAD 1.1.3\\bin\\FreeCADCmd.exe",
    ],
  );

  const report = [];
  if (!libreCad) {
    report.push({ oracle: "librecad", expected: "2.2.1.5", status: "NOT_RUN", certificationAuthority: false, reason: "Executable not found." });
  } else {
    const output = versionOutput(libreCad, ["--version"]);
    report.push({
      oracle: "librecad",
      expected: "2.2.1.5",
      status: "AVAILABLE_UNVERIFIED",
      versionMatchesPin: output.includes("2.2.1.5"),
      certificationAuthority: false,
      executable: libreCad,
      executableSha256: await sha256(libreCad),
      versionOutput: output,
    });
  }
  if (!freeCad) {
    report.push({ oracle: "freecad", expected: "1.1.3", status: "NOT_RUN", certificationAuthority: false, reason: "Executable not found." });
  } else {
    const output = versionOutput(freeCad, ["--version"]);
    report.push({
      oracle: "freecad",
      expected: "1.1.3",
      status: "AVAILABLE_UNVERIFIED",
      versionMatchesPin: output.includes("1.1.3"),
      certificationAuthority: false,
      executable: freeCad,
      executableSha256: await sha256(freeCad),
      versionOutput: output,
    });
  }
  return report;
}
