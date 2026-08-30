import { describe, expect, it } from "vitest";
import { UNCERTIFIED_ROW_DEPENDENCIES } from "../../parity/rows.mjs";
import { PACKAGE_SEMANTIC_MIGRATION_TARGET, affectedRows, buildPackageSemanticMigrationReceipt, canonicalJson, checkoutStepsUseFullHistory, exactContentAddress, exactSchemaAndYamlParserMigration, exactSchemaPinMigration, exactYamlParserAddition, executableStages, inferredRowIds, packageContractForRow, semanticContentAddress, semanticValue, sourceContentAddress, sourceToRows, staleEvidenceBindings, workflowJobContainsOrderedRuns } from "./core.mjs";

describe("parity kit", () => {
  it("pins the completed package migration to its immutable target commit", async () => {
    expect(PACKAGE_SEMANTIC_MIGRATION_TARGET).toBe("44626312ad7ce26bd6c0a03c4098e17ad197400f");
    const receipt = await buildPackageSemanticMigrationReceipt("2026-08-30T00:31:23.996Z");
    expect(receipt.status).toBe("PASS");
    expect(receipt.changedScripts).not.toContain("parity:f025:autocad");
    expect(receipt.checks.onlyF023AndF024StageCommandsAdded).toBe(true);
  });

  it("gives timestamp-only JSON reruns the same semantic content address", () => {
    const first = Buffer.from(JSON.stringify({ status: "PASS", observedAt: "2026-01-01T00:00:00Z", artifactSha256: "a".repeat(64), geometry: { x: 5, y: 7 } }));
    const second = Buffer.from(JSON.stringify({ geometry: { y: 7, x: 5 }, artifactSha256: "b".repeat(64), observedAt: "2027-02-03T04:05:06Z", status: "PASS" }));
    expect(semanticContentAddress(first, "evidence.json")).toBe(semanticContentAddress(second, "evidence.json"));
  });

  it("retains material semantic hashes while ignoring only known provenance hashes", () => {
    const first = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "a".repeat(64) }, sourceSha256: { app: "b".repeat(64) } }));
    const sourceOnly = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "a".repeat(64) }, sourceSha256: { app: "c".repeat(64) } }));
    const semanticChange = Buffer.from(JSON.stringify({ semanticSha256ByHandle: { A: "d".repeat(64) }, sourceSha256: { app: "b".repeat(64) } }));
    expect(semanticContentAddress(first, "evidence.json")).toBe(semanticContentAddress(sourceOnly, "evidence.json"));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(semanticChange, "evidence.json"));
  });

  it("retains result and geometry fields whose names merely resemble timestamps", () => {
    const first = Buffer.from(JSON.stringify({ created: ["10"], a3TitleAt: [25, 40], generatedAt: "2026-01-01T00:00:00Z" }));
    const changedResult = Buffer.from(JSON.stringify({ created: ["11"], a3TitleAt: [25, 40], generatedAt: "2027-01-01T00:00:00Z" }));
    const changedPosition = Buffer.from(JSON.stringify({ created: ["10"], a3TitleAt: [26, 40], generatedAt: "2027-01-01T00:00:00Z" }));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(changedResult, "evidence.json"));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(changedPosition, "evidence.json"));
  });

  it("gives KDRAW1 containers with timestamp-only document changes the same semantic address", () => {
    const container = (updatedAt) => Buffer.from(`KDRAW1\n${JSON.stringify({
      manifest: { entries: [{ path: "document.json", sha256: updatedAt }] },
      files: {
        "document.json": Buffer.from(JSON.stringify({ schemaVersion: 1, metadata: { updatedAt }, entities: [{ handle: "10", kind: "line" }] })).toString("base64"),
      },
    })}`);
    const first = container("2026-01-01T00:00:00.000Z");
    const second = container("2027-02-03T04:05:06.000Z");
    expect(semanticContentAddress(first, "drawing.kdraw")).toBe(semanticContentAddress(second, "drawing.kdraw"));
  });

  it("changes the semantic address when measured content changes", () => {
    const first = Buffer.from(JSON.stringify({ geometry: { x: 5, y: 7 } }));
    const second = Buffer.from(JSON.stringify({ geometry: { x: 6, y: 7 } }));
    expect(semanticContentAddress(first, "evidence.json")).not.toBe(semanticContentAddress(second, "evidence.json"));
  });

  it("gives LF and CRLF source files the same content address", () => {
    expect(sourceContentAddress(Buffer.from("const value = 1;\nexport { value };\n")))
      .toBe(sourceContentAddress(Buffer.from("const value = 1;\r\nexport { value };\r\n")));
  });

  it("requires every pinned checkout step to fetch the migration base history", () => {
    const valid = `steps:\n  - uses: actions/checkout@pinned\n    with:\n      fetch-depth: 0\n  - uses: actions/setup-node@pinned\n`;
    const namedValid = `steps:\n  - name: Checkout\n    uses: actions/checkout@pinned\n    with:\n      fetch-depth: "0"\n`;
    const shallow = `steps:\n  - uses: actions/checkout@pinned\n  - uses: actions/setup-node@pinned\n`;
    const mixed = `${valid}other:\n  - uses: actions/checkout@pinned\n    with:\n      fetch-depth: 1\n`;
    const wrongScope = `steps:\n  - uses: actions/checkout@pinned\n    env:\n      fetch-depth: 0\n`;
    const namedShallow = `${valid}other:\n  - name: Hidden shallow checkout\n    uses: actions/checkout@pinned\n`;
    expect(checkoutStepsUseFullHistory(valid)).toBe(true);
    expect(checkoutStepsUseFullHistory(namedValid)).toBe(true);
    expect(checkoutStepsUseFullHistory(shallow)).toBe(false);
    expect(checkoutStepsUseFullHistory(mixed)).toBe(false);
    expect(checkoutStepsUseFullHistory(wrongScope)).toBe(false);
    expect(checkoutStepsUseFullHistory(namedShallow)).toBe(false);
  });

  it("requires the complete F-024 evidence chain in the protected jobs and preserves order", () => {
    const valid = `jobs:\n  required-oracles:\n    steps:\n      - run: npm run parity:f024:oracles\n      - run: npm run parity:f024:cross-evidence\n  autocad-2024-certification:\n    steps:\n      - run: npm run parity:f024:browser-artifact\n      - run: npm run parity:f024:readback\n      - run: npm run parity:f024:autocad\n      - run: npm run parity:f024:oracles\n      - run: npm run parity:f024:cross-evidence\n  next-job:\n    steps:\n      - run: npm run parity:f024:browser-artifact\n`;
    const autoCadChain = ["npm run parity:f024:browser-artifact", "npm run parity:f024:readback", "npm run parity:f024:autocad", "npm run parity:f024:oracles", "npm run parity:f024:cross-evidence"];
    expect(workflowJobContainsOrderedRuns(valid, "autocad-2024-certification", autoCadChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid, "required-oracles", ["npm run parity:f024:oracles", "npm run parity:f024:cross-evidence"])).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f024:autocad\n", ""), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f024:autocad\n      - run: npm run parity:f024:oracles", "      - run: npm run parity:f024:oracles\n      - run: npm run parity:f024:autocad"), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid, "next-job", autoCadChain)).toBe(false);
    const blockScalarSpoof = valid.replace(
      "      - run: npm run parity:f024:autocad\n",
      "      - run: |\n          echo preparing\n          - run: npm run parity:f024:autocad\n",
    );
    expect(workflowJobContainsOrderedRuns(blockScalarSpoof, "autocad-2024-certification", autoCadChain)).toBe(false);
    const nestedMappingSpoof = valid.replace(
      "      - run: npm run parity:f024:autocad\n",
      "      - name: Fake nested command\n        env:\n          - run: npm run parity:f024:autocad\n",
    );
    expect(workflowJobContainsOrderedRuns(nestedMappingSpoof, "autocad-2024-certification", autoCadChain)).toBe(false);
    const jobEnvBlockScalarSpoof = valid.replace(
      "      - run: npm run parity:f024:autocad\n",
      "      - run: echo real job has no AutoCAD step\n",
    ).replace(
      "  autocad-2024-certification:\n    steps:\n",
      "  autocad-2024-certification:\n    env:\n      SPOOF: |\n        steps:\n          - run: npm run parity:f024:browser-artifact\n          - run: npm run parity:f024:readback\n          - run: npm run parity:f024:autocad\n          - run: npm run parity:f024:oracles\n          - run: npm run parity:f024:cross-evidence\n    steps:\n",
    );
    expect(workflowJobContainsOrderedRuns(jobEnvBlockScalarSpoof, "autocad-2024-certification", autoCadChain)).toBe(false);
    const topLevelBlockScalarSpoof = `env:\n  SPOOF: |\n    autocad-2024-certification:\n      steps:\n        - run: npm run parity:f024:browser-artifact\n        - run: npm run parity:f024:readback\n        - run: npm run parity:f024:autocad\n        - run: npm run parity:f024:oracles\n        - run: npm run parity:f024:cross-evidence\njobs:\n  autocad-2024-certification:\n    steps:\n      - run: echo real job has no certification chain\n`;
    expect(workflowJobContainsOrderedRuns(topLevelBlockScalarSpoof, "autocad-2024-certification", autoCadChain)).toBe(false);
    const multilineQuotedScalarSpoof = `env:\n  SPOOF: "\njobs:\n  autocad-2024-certification:\n    steps:\n      - run: npm run parity:f024:browser-artifact\n      - run: npm run parity:f024:readback\n      - run: npm run parity:f024:autocad\n      - run: npm run parity:f024:oracles\n      - run: npm run parity:f024:cross-evidence\n"\njobs:\n  autocad-2024-certification:\n    steps:\n      - run: echo actual missing\n`;
    expect(workflowJobContainsOrderedRuns(multilineQuotedScalarSpoof, "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(`${valid}\njobs:\n  duplicate:\n    steps: []\n`, "autocad-2024-certification", autoCadChain)).toBe(false);
  });

  it("requires the complete ordered F-025 evidence chain in both protected jobs", () => {
    const valid = `jobs:\n  required-oracles:\n    steps:\n      - run: npm run parity:f025:oracles\n      - run: npm run parity:f025:cross-evidence\n  autocad-2024-certification:\n    steps:\n      - run: npm run parity:f025:browser-artifact\n      - run: npm run parity:f025:readback\n      - run: npm run parity:f025:autocad\n      - run: npm run parity:f025:oracles\n      - run: npm run parity:f025:cross-evidence\n`;
    const autoCadChain = ["npm run parity:f025:browser-artifact", "npm run parity:f025:readback", "npm run parity:f025:autocad", "npm run parity:f025:oracles", "npm run parity:f025:cross-evidence"];
    const oracleChain = ["npm run parity:f025:oracles", "npm run parity:f025:cross-evidence"];
    expect(workflowJobContainsOrderedRuns(valid, "autocad-2024-certification", autoCadChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid, "required-oracles", oracleChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f025:autocad\n", ""), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f025:autocad\n      - run: npm run parity:f025:oracles", "      - run: npm run parity:f025:oracles\n      - run: npm run parity:f025:autocad"), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f025:cross-evidence\n", ""), "required-oracles", oracleChain)).toBe(false);
  });

  it("requires the complete ordered F-026 evidence chain in both protected jobs", () => {
    const valid = `jobs:\n  required-oracles:\n    steps:\n      - run: npm run parity:f026:oracles\n      - run: npm run parity:f026:cross-evidence\n  autocad-2024-certification:\n    steps:\n      - run: npm run parity:f026:browser-artifact\n      - run: npm run parity:f026:readback\n      - run: npm run parity:f026:autocad\n      - run: npm run parity:f026:oracles\n      - run: npm run parity:f026:cross-evidence\n`;
    const autoCadChain = ["npm run parity:f026:browser-artifact", "npm run parity:f026:readback", "npm run parity:f026:autocad", "npm run parity:f026:oracles", "npm run parity:f026:cross-evidence"];
    const oracleChain = ["npm run parity:f026:oracles", "npm run parity:f026:cross-evidence"];
    expect(workflowJobContainsOrderedRuns(valid, "autocad-2024-certification", autoCadChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid, "required-oracles", oracleChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f026:autocad\n", ""), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f026:autocad\n      - run: npm run parity:f026:oracles", "      - run: npm run parity:f026:oracles\n      - run: npm run parity:f026:autocad"), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f026:cross-evidence\n", ""), "required-oracles", oracleChain)).toBe(false);
  });

  it("requires the complete ordered F-027 evidence chain in both protected jobs", () => {
    const valid = `jobs:\n  required-oracles:\n    steps:\n      - run: npm run parity:f027:oracles\n      - run: npm run parity:f027:cross-evidence\n  autocad-2024-certification:\n    steps:\n      - run: npm run parity:f027:browser-artifact\n      - run: npm run parity:f027:readback\n      - run: npm run parity:f027:autocad\n      - run: npm run parity:f027:oracles\n      - run: npm run parity:f027:cross-evidence\n`;
    const autoCadChain = ["npm run parity:f027:browser-artifact", "npm run parity:f027:readback", "npm run parity:f027:autocad", "npm run parity:f027:oracles", "npm run parity:f027:cross-evidence"];
    const oracleChain = ["npm run parity:f027:oracles", "npm run parity:f027:cross-evidence"];
    expect(workflowJobContainsOrderedRuns(valid, "autocad-2024-certification", autoCadChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid, "required-oracles", oracleChain)).toBe(true);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f027:autocad\n", ""), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f027:autocad\n      - run: npm run parity:f027:oracles", "      - run: npm run parity:f027:oracles\n      - run: npm run parity:f027:autocad"), "autocad-2024-certification", autoCadChain)).toBe(false);
    expect(workflowJobContainsOrderedRuns(valid.replace("      - run: npm run parity:f027:cross-evidence\n", ""), "required-oracles", oracleChain)).toBe(false);
  });

  it("accepts only the exact pinned schema migration and lock integrity", () => {
    const oldPin = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/5eab9934aec937b679f0614382b8f947d3f21e8e.tar.gz";
    const newPin = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/b9964e0991884151784d1b262ded8c5c14706d9c.tar.gz";
    const integrity = "sha512-tRBLFC3Bh5+Hul4c5mfVgng4cFEWy02xTveQf6VJ4m0Xkir8AVrMlGlXqzazQeB9EnYgvWXFc3uxCEEALdmwzQ==";
    const previousManifest = { dependencies: { "@kuubik/cad-schema": oldPin, react: "19" } };
    const currentManifest = { dependencies: { "@kuubik/cad-schema": newPin, react: "19" } };
    expect(exactSchemaPinMigration(previousManifest, currentManifest)).toBe(true);
    expect(exactSchemaPinMigration(previousManifest, { ...currentManifest, private: true })).toBe(false);
    expect(exactSchemaPinMigration(previousManifest, { dependencies: { "@kuubik/cad-schema": oldPin, react: "19" } })).toBe(false);
    const previousLock = { packages: { "": { dependencies: { "@kuubik/cad-schema": oldPin } }, "node_modules/@kuubik/cad-schema": { resolved: oldPin } } };
    const currentLock = { packages: { "": { dependencies: { "@kuubik/cad-schema": newPin } }, "node_modules/@kuubik/cad-schema": { resolved: newPin, integrity } } };
    expect(exactSchemaPinMigration(previousLock, currentLock, { lockfile: true })).toBe(true);
    currentLock.packages["node_modules/@kuubik/cad-schema"].integrity = "sha512-wrong";
    expect(exactSchemaPinMigration(previousLock, currentLock, { lockfile: true })).toBe(false);
  });

  it("accepts only the exact pinned YAML parser addition", () => {
    const yamlEntry = {
      version: "2.9.0",
      resolved: "https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz",
      integrity: "sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==",
      dev: true,
      license: "ISC",
      bin: { yaml: "bin.mjs" },
      engines: { node: ">= 14.6" },
      funding: { url: "https://github.com/sponsors/eemeli" },
    };
    const previousManifest = { private: true, devDependencies: { vitest: "3.2.4" } };
    const currentManifest = { private: true, devDependencies: { vitest: "3.2.4", yaml: "2.9.0" } };
    expect(exactYamlParserAddition(previousManifest, currentManifest)).toBe(true);
    expect(exactYamlParserAddition(previousManifest, { ...currentManifest, private: false })).toBe(false);
    expect(exactYamlParserAddition(previousManifest, { ...currentManifest, devDependencies: { ...currentManifest.devDependencies, yaml: "2.9.1" } })).toBe(false);

    const oldPin = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/5eab9934aec937b679f0614382b8f947d3f21e8e.tar.gz";
    const newPin = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/b9964e0991884151784d1b262ded8c5c14706d9c.tar.gz";
    const schemaIntegrity = "sha512-tRBLFC3Bh5+Hul4c5mfVgng4cFEWy02xTveQf6VJ4m0Xkir8AVrMlGlXqzazQeB9EnYgvWXFc3uxCEEALdmwzQ==";
    const previousLock = { packages: { "": { dependencies: { "@kuubik/cad-schema": oldPin }, devDependencies: { vitest: "3.2.4" } }, "node_modules/@kuubik/cad-schema": { resolved: oldPin } } };
    const currentLock = { packages: { "": { dependencies: { "@kuubik/cad-schema": newPin }, devDependencies: { vitest: "3.2.4", yaml: "2.9.0" } }, "node_modules/@kuubik/cad-schema": { resolved: newPin, integrity: schemaIntegrity }, "node_modules/yaml": yamlEntry } };
    expect(exactSchemaAndYamlParserMigration(previousLock, currentLock)).toBe(true);
    currentLock.packages["node_modules/yaml"].integrity = "sha512-wrong";
    expect(exactSchemaAndYamlParserMigration(previousLock, currentLock)).toBe(false);
    currentLock.packages["node_modules/yaml"] = yamlEntry;
    currentLock.packages["node_modules/extra"] = { version: "1.0.0" };
    expect(exactSchemaAndYamlParserMigration(previousLock, currentLock)).toBe(false);
  });

  it("gives LF and CRLF exact JSON evidence the same repository address", () => {
    expect(exactContentAddress(Buffer.from('{\n  "status": "PASS"\n}\n'), "evidence.json"))
      .toBe(exactContentAddress(Buffer.from('{\r\n  "status": "PASS"\r\n}\r\n'), "evidence.json"));
    expect(exactContentAddress(Buffer.from("A\n"), "drawing.dxf"))
      .not.toBe(exactContentAddress(Buffer.from("A\r\n"), "drawing.dxf"));
  });

  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: [2, 1] })).toBe('{"a":[2,1],"b":2}');
    expect(canonicalJson({ "ä": 4, z: 3, a: 2, A: 1 })).toBe('{"A":1,"a":2,"z":3,"ä":4}');
    expect(semanticValue({ generatedAt: "now", value: 1 })).toEqual({ value: 1 });
  });

  it("maps shared modify sources through certified F-027/F-029, uncertified F-028/F-030 and package locks to every relevant row", () => {
    expect(affectedRows(["packages/cad-core/src/trim.ts"]).rows).toEqual(["F-022", "F-023", "F-024", "F-026", "F-027", "F-028", "F-029"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).toEqual(["F-015", "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022", "F-023", "F-024", "F-025", "F-026", "F-027", "F-028", "F-029", "F-030"]);
    expect(affectedRows(["apps/web/src/workflows/modify-command.ts"]).rows).not.toContain("F-114");
    expect(affectedRows(["package-lock.json"]).rows).toHaveLength(31);
    expect(affectedRows(["package-lock.json"]).rows).toContain("F-024");
    expect(affectedRows(["package-lock.json"]).rows).toContain("F-025");
    expect(affectedRows(["package-lock.json"]).rows).toContain("F-026");
    expect(affectedRows(["package-lock.json"]).rows).toContain("F-027");
    expect(affectedRows(["package-lock.json"]).rows).toContain("F-030");
    expect(affectedRows(["package.json"]).rows).toHaveLength(31);
    expect(affectedRows(["apps/web/package.json"]).rows).toHaveLength(30);
    expect(affectedRows(["packages/cad-core/package.json"]).rows).toHaveLength(30);
    expect(sourceToRows().get("packages/cad-core/src/trim.ts")).toEqual(["F-022", "F-023", "F-024", "F-026", "F-027", "F-028", "F-029"]);
    expect(sourceToRows().get("packages/cad-core/src/stretch.ts")).toEqual(["F-027"]);
    expect(sourceToRows().get("packages/cad-core/src/lengthen.ts")).toEqual(["F-028"]);
    expect(sourceToRows().get("packages/cad-core/src/commands.ts")).toContain("F-029");
    expect(sourceToRows().get("packages/cad-core/src/match-properties.ts")).toEqual(["F-030"]);
    expect(sourceToRows().get("packages/cad-core/src/transaction.ts")).toContain("F-030");
    expect(sourceToRows().get("tools/autocad/f022-shift-click.ps1")).toEqual(["F-022", "F-023", "F-024", "F-025"]);
    expect(sourceToRows().get("packages/cad-core/src/chamfer.ts")).toEqual(["F-025"]);
    expect(sourceToRows().get("packages/cad-core/src/break.ts")).toEqual(["F-026"]);
    expect(sourceToRows().get("tools/autocad/process-ownership.mjs")).toContain("F-026");
    expect(sourceToRows().get("tools/autocad/process-ownership.mjs")).toContain("F-027");
    for (const sharedSource of ["tools/autocad/f109-desktop-readback.ps1", "tools/autocad/f109-runner.test.mjs", "parity/expected/F-109.json"]) {
      expect(affectedRows([sharedSource]).rows).toEqual(["F-109", "F-111"]);
      expect(affectedRows([sharedSource]).unmappedRuntime).toEqual([]);
    }
  });

  it("keeps F-030 special-object and cross-document UI gaps attached to their owning audit rows", () => {
    expect(UNCERTIFIED_ROW_DEPENDENCIES["F-030"]).toEqual(["F-060", "F-069", "F-071", "F-108", "F-128"]);
  });

  it("fails closed for a new unmapped runtime source", () => {
    expect(affectedRows(["apps/web/src/workflows/new-command.ts"]).unmappedRuntime).toEqual(["apps/web/src/workflows/new-command.ts"]);
  });

  it("maps row-specific E2E, checker and AutoCAD fixture sources", () => {
    expect(affectedRows(["tools/parity/run-f114-readback.mjs"]).rows).toEqual(["F-114"]);
    expect(affectedRows(["e2e/f022-trim.spec.ts"]).rows).toEqual(["F-022"]);
    expect(affectedRows(["tools/autocad/f102-page-setup.ps1"]).rows).toEqual(["F-102"]);
    expect(inferredRowIds("tools/parity/check-f020-f021-runner-evidence.mjs")).toEqual(["F-020", "F-021"]);
    expect(affectedRows(["tools/parity/new-shared-checker.mjs"]).unmappedRuntime).toEqual(["tools/parity/new-shared-checker.mjs"]);
  });

  it("maps the certified F-024 implementation and shared runtime sources", () => {
    expect(sourceToRows().get("packages/cad-core/src/fillet.ts")).toEqual(["F-024"]);
    expect(affectedRows(["e2e/f024-fillet.spec.ts"]).rows).toEqual(["F-024"]);
    expect(affectedRows(["packages/cad-core/src/fillet.ts"]).unmappedRuntime).toEqual([]);
    expect(sourceToRows().get("packages/cad-core/src/container.ts")).toContain("F-024");
    expect(sourceToRows().get("packages/cad-renderer/src/renderer.ts")).toContain("F-024");
    expect(sourceToRows().get("packages/cad-dxf/src/import.ts")).toContain("F-024");
    expect(sourceToRows().get("packages/cad-print/src/index.ts")).toContain("F-024");
  });

  it("refreshes only authorities that can be affected by a runtime source", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { cross: { sha256: "cross-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "apps/web/src/App.tsx": "old" }, evidence, receipts }] };
    const stale = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "apps/web/src/App.tsx": "new" }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, stale)).toEqual([
      "F-023: source changed without refreshed browser evidence.",
      "F-023: source changed without refreshed readback evidence.",
      "F-023: source changed without refreshed cross stage receipt.",
    ]);
    const refreshed = structuredClone(stale);
    refreshed.rows[0].evidence.browser.descriptorSha256 = "new-browser-descriptor";
    refreshed.rows[0].evidence.readback.artifactSha256 = "new-readback-artifact";
    refreshed.rows[0].receipts.cross.sha256 = "new-cross-receipt";
    expect(staleEvidenceBindings(previous, refreshed)).toEqual([]);
  });

  it("keeps AutoCAD-only source changes scoped to native evidence plus cross-check", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { cross: { sha256: "cross-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "tools/autocad/run-f023.mjs": "old" }, evidence, receipts }] };
    const stale = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "tools/autocad/run-f023.mjs": "new" }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, stale)).toEqual([
      "F-023: source changed without refreshed autocad evidence.",
      "F-023: source changed without refreshed cross stage receipt.",
    ]);
  });

  it("treats a row scope document as cross-contract provenance, not executable geometry", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "parity/F-023-scope.md": "old" }, evidence, receipts: { cross: { sha256: "old-cross" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-023", sources: { "parity/F-023-scope.md": "new" }, evidence, receipts: { cross: { sha256: "old-cross" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual(["F-023: source changed without refreshed cross stage receipt."]);
  });

  it("fails closed across every authority when the package dependency surface changes", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const receipts = { global: { sha256: "global-receipt" } };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "old", stages: {} } }, evidence, receipts }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "new", stages: {} } }, evidence, receipts }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("scopes a package stage-command change to its authority, cross-check and global receipt", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{
      rowId: "F-003",
      sources: { "package.json": { schemaVersion: 1, packageSurfaceSha256: "same", stages: { autocad: { rootScript: "parity:f003:autocad", closureSha256: "old" } } } },
      evidence,
      receipts: { cross: { sha256: "old-cross" }, global: { sha256: "old-global" } },
    }] };
    const current = structuredClone(previous);
    current.rows[0].sources["package.json"].stages.autocad.closureSha256 = "new";
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed cross stage receipt.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("keeps unrelated package scripts out of a row package contract", () => {
    const row = { stages: { autocad: "parity:f003:autocad" } };
    const before = {
      name: "kuubik-draw",
      scripts: { "parity:f003:autocad": "node tools/autocad/run-f003.mjs", "test:mutation": "vitest run old.test.ts" },
    };
    const after = structuredClone(before);
    after.scripts["test:mutation"] = "vitest run old.test.ts new-f023.test.ts";
    after.scripts["parity:f023:autocad"] = "node tools/autocad/run-f023.mjs";
    expect(packageContractForRow(before, row)).toEqual(packageContractForRow(after, row));
  });

  it("includes transitively invoked npm scripts in a row package contract", () => {
    const row = { stages: { readback: "parity:f003:readback" } };
    const before = {
      name: "kuubik-draw",
      scripts: { "parity:f003:readback": "npm run build && node readback.mjs", build: "tsc -b" },
    };
    const after = structuredClone(before);
    after.scripts.build = "tsc -b --force";
    expect(packageContractForRow(before, row)).not.toEqual(packageContractForRow(after, row));
  });

  it("fails closed across every authority when a workspace package manifest changes", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "packages/cad-core/package.json": "old" }, evidence, receipts: { global: { sha256: "global" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "packages/cad-core/package.json": "new" }, evidence, receipts: { global: { sha256: "global" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed autocad evidence.",
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
      "F-003: source changed without refreshed global stage receipt.",
    ]);
  });

  it("checks non-package source bindings during the v3 to v4 migration", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 3, rows: [{ rowId: "F-003", sources: { "apps/web/src/App.tsx": "old", "package.json": "old-package" }, evidence, receipts: {} }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "apps/web/src/App.tsx": "new", "package.json": { schemaVersion: 1, packageSurfaceSha256: "same", stages: {} } }, evidence: structuredClone(evidence), receipts: {} }] };
    expect(staleEvidenceBindings(previous, current, { allowV3ToV4: true, ignoredSourcePaths: ["package.json"] })).toEqual([
      "F-003: source changed without refreshed browser evidence.",
      "F-003: source changed without refreshed readback evidence.",
    ]);
    current.rows[0].evidence.browser.descriptorSha256 = "new-browser";
    current.rows[0].evidence.readback.artifactSha256 = "new-readback";
    expect(staleEvidenceBindings(previous, current, { allowV3ToV4: true, ignoredSourcePaths: ["package.json"] })).toEqual([]);
  });

  it("requires a refreshed global receipt when CI or parity topology changes on a row without cross evidence", () => {
    const evidence = {
      autocad: { descriptorSha256: "autocad-descriptor", artifactSha256: "autocad-artifact" },
      browser: { descriptorSha256: "browser-descriptor", artifactSha256: "browser-artifact" },
      readback: { descriptorSha256: "readback-descriptor", artifactSha256: "readback-artifact" },
    };
    const previous = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "parity/rows.mjs": "old", ".github/workflows/ci.yml": "old" }, evidence, receipts: { global: { sha256: "old-global" } } }] };
    const current = { schemaVersion: 4, rows: [{ rowId: "F-003", sources: { "parity/rows.mjs": "new", ".github/workflows/ci.yml": "new" }, evidence, receipts: { global: { sha256: "old-global" } } }] };
    expect(staleEvidenceBindings(previous, current)).toEqual([
      "F-003: source changed without refreshed global stage receipt.",
    ]);
    current.rows[0].receipts.global.sha256 = "new-global";
    expect(staleEvidenceBindings(previous, current)).toEqual([]);
  });

  it("orchestrates a synthetic row without requiring a copied cross checker", () => {
    const row = {
      id: "F-023",
      stages: {
        browser: "parity:f023:browser-artifact",
        readback: "parity:f023:readback",
        autocad: "parity:f023:autocad",
      },
    };
    expect(executableStages(row).map(({ stage }) => stage)).toEqual(["browser", "readback", "autocad"]);
    expect(executableStages(row, { portable: true }).map(({ stage }) => stage)).toEqual(["browser", "readback"]);
  });
});
