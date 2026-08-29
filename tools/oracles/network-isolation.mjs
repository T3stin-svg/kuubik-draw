import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedKind = "kuubik-cad-oracle-network-isolation";

function refused(reason) {
  return { proven: false, reason };
}

export async function verifyNetworkIsolationAttestation(tools, environment = process.env, now = Date.now()) {
  const path = environment.KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH;
  const key = environment.KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY;
  if (!path || !key) return refused("A protected signed network-isolation attestation was not configured.");
  let bytes;
  let document;
  try {
    bytes = await readFile(path);
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return refused(`Network-isolation attestation could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = document?.payload;
  const signature = document?.signatureHmacSha256;
  if (!payload || typeof signature !== "string" || !/^[a-f0-9]{64}$/u.test(signature)) return refused("Network-isolation attestation has no valid HMAC signature.");
  const expectedSignature = createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"))) return refused("Network-isolation attestation signature mismatch.");
  const issuedAt = Date.parse(payload.issuedAt ?? "");
  const expiresAt = Date.parse(payload.expiresAt ?? "");
  if (
    payload.schemaVersion !== 1 || payload.kind !== expectedKind || payload.networkIsolationProven !== true
    || payload.method !== "os-egress-deny" || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > now + 300_000 || expiresAt <= now || expiresAt - issuedAt > 86_400_000
  ) return refused("Network-isolation attestation payload or validity window is invalid.");
  const currentRunnerName = typeof environment.RUNNER_NAME === "string" ? environment.RUNNER_NAME.trim() : "";
  const attestedRunnerName = typeof payload.runnerName === "string" ? payload.runnerName.trim() : "";
  if (!currentRunnerName || !attestedRunnerName) return refused("Network-isolation attestation requires both current and attested runner names.");
  if (attestedRunnerName !== currentRunnerName) return refused("Network-isolation attestation belongs to a different runner.");
  const attested = new Map((payload.executables ?? []).map((entry) => [entry.oracle, entry.executableSha256]));
  const required = tools.filter((tool) => tool.status === "AVAILABLE" && tool.executableSha256MatchesPin === true);
  if (required.length === 0 || required.some((tool) => attested.get(tool.oracle) !== tool.executableSha256)) {
    return refused("Network-isolation attestation does not bind every pinned oracle executable.");
  }
  return {
    proven: true,
    method: payload.method,
    runnerName: attestedRunnerName,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    attestationSha256: sha256(bytes),
  };
}
