#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const localPath = resolve(root, "parity/local-certifications.json");
const rowIds = process.argv.slice(2);
if (rowIds.length === 0 || rowIds.some((rowId) => !/^F-\d{3}$/u.test(rowId))) {
  throw new Error("Usage: node tools/parity/refresh-local-certification-evidence.mjs F-015 [F-016 ...]");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const local = JSON.parse(await readFile(localPath, "utf8"));
const certifications = new Map(local.certifications.map((entry) => [entry.rowId, entry]));

for (const rowId of rowIds) {
  const certification = certifications.get(rowId);
  if (!certification || certification.score !== 1) throw new Error(`${rowId} is not an existing score-1 local certification.`);
  for (const kind of ["autocad", "browser", "readback"]) {
    const descriptorPath = resolve(root, `evidence/${kind}/${rowId}.json`);
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    if (descriptor.schemaVersion !== 1 || descriptor.rowId !== rowId || descriptor.kind !== kind || descriptor.status !== "PASS") {
      throw new Error(`${rowId} ${kind} descriptor is not a valid PASS descriptor.`);
    }
    const artifactPath = resolve(root, descriptor.artifact);
    if (!artifactPath.startsWith(`${artifactRoot}${sep}`) || !descriptor.artifact.startsWith(`evidence/artifacts/${rowId}-`)) {
      throw new Error(`${rowId} ${kind} artifact escaped the evidence directory.`);
    }
    const artifactBytes = await readFile(artifactPath);
    const artifact = JSON.parse(artifactBytes.toString("utf8"));
    if (artifact.status !== "PASS" && artifact.passed !== true) throw new Error(`${rowId} ${kind} artifact is not PASS.`);
    descriptor.artifactSha256 = sha256(artifactBytes);
    descriptor.observedAt = artifact.observedAt ?? (await stat(artifactPath)).mtime.toISOString();
    const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    await writeFile(descriptorPath, descriptorBytes);
    certification.evidenceSha256[kind] = sha256(descriptorBytes);
  }
}
await writeFile(localPath, `${JSON.stringify(local, null, 2)}\n`, "utf8");
console.log(`Refreshed immutable artifact and descriptor SHA-256 links for ${rowIds.join(", ")}.`);
