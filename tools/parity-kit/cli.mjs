#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PARITY_ROWS } from "../../parity/rows.mjs";
import { GLOBAL_TOPOLOGY_RECEIPT_PATH, PACKAGE_SEMANTIC_MIGRATION_BASE_MANIFEST_SHA256, PACKAGE_SEMANTIC_MIGRATION_PATH, PACKAGE_WORKSPACE_MANIFEST_PATHS, REPO_ROOT, affectedRows, buildContentAddressManifest, buildGlobalTopologyReceipt, buildPackageSemanticMigrationReceipt, changedFiles, exactContentAddress, executableStages, sourceToRows, staleEvidenceBindings, validateParityKit, verifyGlobalTopologyReceipt, verifyPackageSemanticMigrationReceipt } from "./core.mjs";

const [command = "validate", ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function npmRun(script, forwardedArgs = []) {
  const npmArgs = ["run", script, ...(forwardedArgs.length ? ["--", ...forwardedArgs] : [])];
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...npmArgs], { cwd: REPO_ROOT, stdio: "inherit" })
    : spawnSync("npm", npmArgs, { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Parity stage failed: npm run ${script}`);
}

if (command === "validate") {
  const result = await validateParityKit();
  if (result.errors.length) fail(result.errors.join("\n"));
  console.log(`Parity kit PASS (${result.rows} certified rows, ${result.runtimeSources} mapped runtime sources).`);
} else if (command === "graph") {
  const graph = Object.fromEntries(sourceToRows());
  console.log(JSON.stringify(graph, null, 2));
} else if (command === "affected") {
  const baseIndex = args.indexOf("--base");
  const filesIndex = args.indexOf("--files");
  if (baseIndex >= 0 && filesIndex >= 0) fail("Use either --base or --files, not both.");
  let files;
  let source;
  if (filesIndex >= 0) {
    files = (args[filesIndex + 1] ?? "").split(",").filter(Boolean);
    source = "explicit";
  } else {
    const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
    if (baseIndex >= 0 && !base) fail("--base requires a Git revision.");
    files = changedFiles(base);
    source = base ? `git:${base}...HEAD+worktree` : "git:HEAD+worktree";
  }
  const result = affectedRows(files);
  if (result.unmappedRuntime.length) fail(`Unmapped runtime sources:\n${result.unmappedRuntime.join("\n")}`);
  console.log(JSON.stringify({ source, files, affectedRows: result.rows }, null, 2));
} else if (command === "content-addresses") {
  const manifest = await buildContentAddressManifest();
  const outputPath = resolve(REPO_ROOT, "parity/content-addresses.json");
  if (args.includes("--write")) {
    const previousBytes = await readFile(outputPath);
    const previous = JSON.parse(previousBytes.toString("utf8"));
    const migrationAllowed = (previous.schemaVersion === 1 && args.includes("--migrate-v1"))
      || (previous.schemaVersion === 2 && args.includes("--migrate-v2"))
      || (previous.schemaVersion === 3 && args.includes("--migrate-v3"));
    if (previous.schemaVersion !== 4 && !migrationAllowed) fail(`Content-address schema ${previous.schemaVersion} migration requires its one-time migration flag.`);
    if (previous.schemaVersion === 3) {
      if (exactContentAddress(previousBytes, "parity/content-addresses.json") !== PACKAGE_SEMANTIC_MIGRATION_BASE_MANIFEST_SHA256) {
        fail("Content-address v3 migration source is not the pinned base manifest.");
      }
      await verifyPackageSemanticMigrationReceipt();
    }
    const trackingWorkspacePackages = previous.schemaVersion === 4 && args.includes("--track-workspace-packages");
    if (trackingWorkspacePackages) await verifyPackageSemanticMigrationReceipt();
    const stale = staleEvidenceBindings(previous, manifest, {
      allowV3ToV4: previous.schemaVersion === 3,
      ignoredSourcePaths: previous.schemaVersion === 3
        ? ["package.json", ...PACKAGE_WORKSPACE_MANIFEST_PATHS]
        : trackingWorkspacePackages ? PACKAGE_WORKSPACE_MANIFEST_PATHS : [],
    });
    if (stale.length) fail(stale.join("\n"));
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Content addresses written for ${manifest.rows.length} rows.`);
  } else {
    const stored = JSON.parse(await readFile(outputPath, "utf8"));
    if (JSON.stringify(stored) !== JSON.stringify(manifest)) fail("Content-address manifest is stale.");
    console.log(`Content-address manifest PASS (${manifest.rows.length} rows).`);
  }
} else if (command === "global-topology") {
  if (args.includes("--write")) {
    const receipt = await buildGlobalTopologyReceipt();
    await writeFile(resolve(REPO_ROOT, GLOBAL_TOPOLOGY_RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    console.log(`Global topology receipt written (${receipt.certifiedRowIds.length} rows).`);
  } else {
    const receipt = await verifyGlobalTopologyReceipt();
    console.log(`Global topology receipt PASS (${receipt.certifiedRowIds.length} rows).`);
  }
} else if (command === "package-semantic-migration") {
  if (args.includes("--write")) {
    const receipt = await buildPackageSemanticMigrationReceipt();
    await writeFile(resolve(REPO_ROOT, PACKAGE_SEMANTIC_MIGRATION_PATH), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    console.log(`Package semantic migration receipt written (${receipt.stageChanges.length} stage changes).`);
  } else {
    const receipt = await verifyPackageSemanticMigrationReceipt();
    console.log(`Package semantic migration receipt PASS (${receipt.stageChanges.length} stage changes).`);
  }
} else if (command === "run-row") {
  const rowId = args.find((arg) => /^F-\d{3}$/u.test(arg));
  const row = PARITY_ROWS.find((candidate) => candidate.id === rowId);
  if (!row) fail(`Unknown or uncertified row: ${rowId ?? "missing"}.`);
  const portable = args.includes("--portable");
  const executed = [];
  for (const { stage, script } of executableStages(row, { portable })) {
    npmRun(script);
    executed.push(stage);
  }
  npmRun("parity:evidence:refresh", [row.id]);
  npmRun("parity:content-addresses:update");
  npmRun("parity:check");
  console.log(`${row.id} row pipeline PASS (${executed.join(" -> ") || "ratchet-only"}${portable ? ", portable" : ""}).`);
} else {
  fail(`Unknown parity-kit command: ${command}.`);
}
