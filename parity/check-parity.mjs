#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { parityManifest } from "./autocad-2024-2d.manifest.mjs";

const lock = JSON.parse(await readFile(new URL("./snapshot-lock.json", import.meta.url), "utf8"));
const local = JSON.parse(await readFile(new URL("./local-certifications.json", import.meta.url), "utf8"));
const scores = new Set([0, 0.25, 0.5, 0.75, 1]);
const errors = [];
if (parityManifest.denominator !== 133 || parityManifest.rows.length !== 133) {
  errors.push(`Denominator changed: ${parityManifest.rows.length}/${parityManifest.denominator}.`);
}
if (parityManifest.sourceCommit !== lock.sourceCommit) errors.push("Source commit changed.");
const expectedIds = Array.from({ length: 133 }, (_, index) => `F-${String(index + 1).padStart(3, "0")}`);
if (parityManifest.rows.map((row) => row.id).join("|") !== expectedIds.join("|")) errors.push("F-row ids or order changed.");
for (const row of parityManifest.rows) {
  if (!scores.has(row.baselineScore) || !scores.has(row.currentScore)) errors.push(`${row.id}: invalid score.`);
  if (![1, 3, 5].includes(row.weight)) errors.push(`${row.id}: invalid weight ${row.weight}.`);
  if (row.currentScore < row.baselineScore) errors.push(`${row.id}: score ratchet regressed.`);
  if (row.currentScore === 1 && row.evidence.status !== "verified") errors.push(`${row.id}: score 1 requires verified evidence.`);
  if (Object.values(row.evidence).some((value) => value === "N/A")) errors.push(`${row.id}: N/A is forbidden.`);
}

function metrics(key) {
  const total = parityManifest.rows.reduce((sum, row) => sum + row[key], 0);
  const weight = parityManifest.rows.reduce((sum, row) => sum + row.weight, 0);
  const weighted = parityManifest.rows.reduce((sum, row) => sum + row[key] * row.weight, 0);
  return {
    raw: (total / parityManifest.denominator) * 100,
    weighted: (weighted / weight) * 100,
  };
}

const baseline = metrics("baselineScore");
const current = metrics("currentScore");
const rounded = (value) => Number(value.toFixed(1));
if (rounded(baseline.raw) !== lock.baseline.rawPercentRounded) errors.push("Baseline raw percentage changed.");
if (rounded(baseline.weighted) !== lock.baseline.weightedPercentRounded) errors.push("Baseline weighted percentage changed.");

const baselineFingerprint = createHash("sha256")
  .update(JSON.stringify(parityManifest.rows.map(({ id, baselineScore, weight }) => ({ id, baselineScore, weight }))))
  .digest("hex");
const localRows = new Map();
for (const certification of local.certifications ?? []) {
  if (!expectedIds.includes(certification.rowId) || certification.score !== 1) {
    errors.push(`Invalid local certification: ${certification.rowId ?? "missing row"}.`);
    continue;
  }
  if (localRows.has(certification.rowId)) errors.push(`Duplicate local certification: ${certification.rowId}.`);
  const requiredEvidence = [
    ["autocad", "autocad-2024.1.2-live"],
    ["browser", "kuubik-draw-browser"],
    ["readback", "independent-parser"],
  ];
  for (const [kind, authority] of requiredEvidence) {
    const ref = `evidence/${kind}/${certification.rowId}.json`;
    try {
      const url = new URL(`../${ref}`, import.meta.url);
      await access(url);
      const bytes = await readFile(url);
      const evidence = JSON.parse(bytes.toString("utf8"));
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (certification.evidenceSha256?.[kind] !== actualHash) errors.push(`${certification.rowId}: ${kind} evidence hash mismatch.`);
      if (
        evidence.schemaVersion !== 1 ||
        evidence.rowId !== certification.rowId ||
        evidence.kind !== kind ||
        evidence.authority !== authority ||
        evidence.status !== "PASS" ||
        !/^[a-f0-9]{64}$/.test(evidence.artifactSha256 ?? "") ||
        !Number.isFinite(Date.parse(evidence.observedAt ?? ""))
      ) {
        errors.push(`${certification.rowId}: invalid ${kind} evidence schema.`);
      }
      if (!new RegExp(`^evidence/artifacts/${certification.rowId}-[A-Za-z0-9._-]+$`).test(evidence.artifact ?? "")) {
        errors.push(`${certification.rowId}: invalid ${kind} artifact path.`);
      } else {
        const artifactBytes = await readFile(new URL(`../${evidence.artifact}`, import.meta.url));
        const artifactHash = createHash("sha256").update(artifactBytes).digest("hex");
        if (artifactHash !== evidence.artifactSha256) errors.push(`${certification.rowId}: ${kind} artifact hash mismatch.`);
      }
      if (kind === "browser") {
        const testPrefix = certification.rowId.toLowerCase().replace("-", "");
        if (!new RegExp(`^e2e/${testPrefix}-[A-Za-z0-9._-]+\\.spec\\.ts$`).test(evidence.test ?? "")) {
          errors.push(`${certification.rowId}: invalid browser test path.`);
        } else {
          await access(new URL(`../${evidence.test}`, import.meta.url));
        }
      }
    } catch (error) {
      errors.push(`${certification.rowId}: missing or unreadable local evidence ${ref}: ${error.message}`);
    }
  }
  localRows.set(certification.rowId, certification);
}
const localRaw = (localRows.size / parityManifest.denominator) * 100;
const localWeightedNumerator = parityManifest.rows.reduce(
  (sum, row) => sum + (localRows.has(row.id) ? row.weight : 0),
  0,
);
const totalWeight = parityManifest.rows.reduce((sum, row) => sum + row.weight, 0);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({
  benchmark: parityManifest.benchmark,
  denominator: parityManifest.denominator,
  legacyAuditSnapshot: {
    verifiedRows: parityManifest.rows.filter((row) => row.evidence.status === "verified").length,
    rawPercent: rounded(current.raw),
    weightedPercent: rounded(current.weighted),
  },
  newApplicationCertification: {
    verifiedRows: localRows.size,
    rawPercent: rounded(localRaw),
    weightedPercent: rounded((localWeightedNumerator / totalWeight) * 100),
  },
  baseline: { rawPercent: rounded(baseline.raw), weightedPercent: rounded(baseline.weighted) },
  visualPercent: lock.importedSnapshot.visualPercent,
  baselineFingerprint,
  inheritanceWarning: lock.note,
}, null, 2));
