import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeOracles } from "./probe-tools.mjs";
import { readPdfPaintedGeometry, runOracleFixtures } from "./run-fixtures.mjs";
import { verifyNetworkIsolationAttestation } from "./network-isolation.mjs";

const libreCadPaintedPaths = `
0 9994.95 m 9920 9994.95 l
9920.05 9994.95 9920.05 9995 9920 9995.05 c
0 9995.05 l -0.05 9995.05 -0.05 9995 0 9994.95 c h f
5951.84696 5035.16919 m
5951.84696 5583.03768 5507.69930 6027.18535 4959.83080 6027.18535 c
4411.96231 6027.18535 3967.81464 5583.03768 3967.81464 5035.16919 c
3967.81464 4487.30069 4411.96231 4043.15303 4959.83080 4043.15303 c
5507.69930 4043.15303 5951.84696 4487.30069 5951.84696 5035.16919 c
5951.74696 5035.16919 m
5951.74696 4487.34211 5507.65788 4043.25303 4959.83080 4043.25303 c
4412.00373 4043.25303 3967.91464 4487.34211 3967.91464 5035.16919 c
3967.91464 5582.99626 4412.00373 6027.08535 4959.83080 6027.08535 c
5507.65788 6027.08535 5951.74696 5582.99626 5951.74696 5035.16919 c h f`;

describe("oracle availability is never fabricated", () => {
  it("returns NOT_RUN for explicitly missing executables", async () => {
    const report = await probeOracles({
      ...process.env,
      LIBRECAD_CMD: "Z:\\missing\\LibreCAD.exe",
      FREECAD_CMD: "Z:\\missing\\FreeCADCmd.exe",
    });
    expect(report).toEqual([
      expect.objectContaining({ oracle: "librecad", status: "NOT_RUN", certificationAuthority: false }),
      expect.objectContaining({ oracle: "freecad", status: "NOT_RUN", certificationAuthority: false }),
    ]);
  });

  it("never executes an available-looking binary whose SHA-256 is not pinned", async () => {
    const report = await runOracleFixtures([{
      oracle: "librecad",
      status: "AVAILABLE",
      versionMatchesPin: true,
      executableSha256MatchesPin: false,
      executable: "Z:\\unapproved\\LibreCAD.exe",
    }]);
    expect(report).toEqual([expect.objectContaining({
      oracle: "librecad",
      status: "AVAILABLE",
      executableSha256MatchesPin: false,
    })]);
  });

  it("pins both developer oracle executables by SHA-256", async () => {
    const pins = JSON.parse(await readFile(new URL("./pins.json", import.meta.url), "utf8"));
    expect(pins.librecad.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(pins.freecad.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reads the exact LibreCAD LINE/CIRCLE relationship instead of counting PDF operators", () => {
    const geometry = readPdfPaintedGeometry(libreCadPaintedPaths);
    expect(geometry.line.length).toBeCloseTo(9920, 6);
    expect(geometry.circle.cubicSegments).toBe(4);
    expect(geometry.inferredUniformTransform.centerErrorNormalized).toBeLessThan(0.00005);
    expect(geometry.inferredUniformTransform.radiusErrorNormalized).toBeLessThan(0.00005);

    const displaced = readPdfPaintedGeometry(libreCadPaintedPaths.replaceAll("5035.16919", "5535.16919").replaceAll("6027.18535", "6527.18535").replaceAll("4043.15303", "4543.15303").replaceAll("4043.25303", "4543.25303").replaceAll("6027.08535", "6527.08535"));
    expect(displaced.inferredUniformTransform.centerErrorNormalized).toBeGreaterThan(0.01);
  });

  it("accepts only a fresh protected-runner attestation bound to both executable hashes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kuubik-oracle-attestation-test-"));
    const path = join(directory, "network.json");
    const key = "unit-test-protected-secret";
    const now = Date.parse("2026-08-29T04:00:00.000Z");
    const payload = {
      schemaVersion: 1,
      kind: "kuubik-cad-oracle-network-isolation",
      networkIsolationProven: true,
      method: "os-egress-deny",
      runnerName: "cad-runner-1",
      issuedAt: "2026-08-29T03:55:00.000Z",
      expiresAt: "2026-08-29T05:00:00.000Z",
      executables: [
        { oracle: "librecad", executableSha256: "a".repeat(64) },
        { oracle: "freecad", executableSha256: "b".repeat(64) },
      ],
    };
    const signatureHmacSha256 = createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
    const tools = payload.executables.map((entry) => ({ ...entry, status: "AVAILABLE", executableSha256MatchesPin: true }));
    try {
      await writeFile(path, `${JSON.stringify({ payload, signatureHmacSha256 })}\n`, "utf8");
      await expect(verifyNetworkIsolationAttestation(tools, {
        KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH: path,
        KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY: key,
        RUNNER_NAME: payload.runnerName,
      }, now)).resolves.toEqual(expect.objectContaining({ proven: true, method: "os-egress-deny" }));

      await expect(verifyNetworkIsolationAttestation(tools, {
        KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH: path,
        KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY: key,
      }, now)).resolves.toEqual(expect.objectContaining({
        proven: false,
        reason: expect.stringContaining("both current and attested runner names"),
      }));

      await expect(verifyNetworkIsolationAttestation(tools, {
        KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH: path,
        KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY: key,
        RUNNER_NAME: "different-cad-runner",
      }, now)).resolves.toEqual(expect.objectContaining({
        proven: false,
        reason: expect.stringContaining("different runner"),
      }));

      const emptyRunnerPayload = { ...payload, runnerName: "" };
      const emptyRunnerSignature = createHmac("sha256", key).update(JSON.stringify(emptyRunnerPayload)).digest("hex");
      await writeFile(path, `${JSON.stringify({ payload: emptyRunnerPayload, signatureHmacSha256: emptyRunnerSignature })}\n`, "utf8");
      await expect(verifyNetworkIsolationAttestation(tools, {
        KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH: path,
        KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY: key,
        RUNNER_NAME: payload.runnerName,
      }, now)).resolves.toEqual(expect.objectContaining({
        proven: false,
        reason: expect.stringContaining("both current and attested runner names"),
      }));

      await writeFile(path, `${JSON.stringify({ payload: { ...payload, runnerName: "tampered" }, signatureHmacSha256 })}\n`, "utf8");
      await expect(verifyNetworkIsolationAttestation(tools, {
        KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH: path,
        KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY: key,
        RUNNER_NAME: payload.runnerName,
      }, now)).resolves.toEqual(expect.objectContaining({ proven: false, reason: expect.stringContaining("signature") }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
