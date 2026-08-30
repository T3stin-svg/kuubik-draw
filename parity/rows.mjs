/**
 * Declarative certification topology for the public Kuubik Draw application.
 *
 * This file does not award scores. parity/local-certifications.json remains the
 * score ratchet and parity/check-parity.mjs remains the denominator authority.
 * The parity kit only describes which sources and executable stages can affect
 * an already-certified row.
 */

export const SOURCE_GROUPS = Object.freeze({
  "web-shell": Object.freeze([
    "apps/web/src/main.tsx",
    "apps/web/src/App.tsx",
    "apps/web/src/indexed-db.ts",
    "apps/web/src/style.css",
  ]),
  "web-modify-workflow": Object.freeze([
    "apps/web/src/workflows/modify-command.ts",
  ]),
  "cad-document": Object.freeze([
    "packages/cad-core/src/document.ts",
    "packages/cad-core/src/transaction.ts",
  ]),
  "cad-container": Object.freeze([
    "packages/cad-core/src/container.ts",
  ]),
  "cad-modify": Object.freeze([
    "packages/cad-core/src/commands.ts",
  ]),
  "cad-offset": Object.freeze([
    "packages/cad-core/src/offset.ts",
  ]),
  "cad-trim": Object.freeze([
    "packages/cad-core/src/trim.ts",
    "packages/cad-renderer/src/selection.ts",
  ]),
  "cad-fillet": Object.freeze([
    "packages/cad-core/src/fillet.ts",
  ]),
  "cad-chamfer": Object.freeze([
    "packages/cad-core/src/chamfer.ts",
  ]),
  "physical-shift-input": Object.freeze([
    "tools/autocad/f022-shift-click.ps1",
  ]),
  "f024-shared-tests": Object.freeze([
    "apps/web/src/workflows/modify-command.test.ts",
    "packages/cad-renderer/test/renderer.test.ts",
    "packages/cad-renderer/test/selection.test.ts",
    "packages/cad-print/test/vector-output.test.ts",
  ]),
  "oracle-lab-f024": Object.freeze([
    "tools/oracles/freecad-f024-headless.py",
    "tools/oracles/network-isolation.mjs",
    "tools/oracles/pins.json",
    "tools/oracles/probe-tools.mjs",
    "tools/oracles/run-fixtures.mjs",
    "tools/oracles/run-f024-oracles.mjs",
  ]),
  "f025-shared-tests": Object.freeze([
    "apps/web/src/workflows/modify-command.test.ts",
    "packages/cad-core/test/chamfer.test.ts",
    "packages/cad-core/test/f025-mutation-proven.test.ts",
    "packages/cad-dxf/test/f025-chamfer-roundtrip.test.ts",
    "e2e/f025-chamfer.spec.ts",
    "tools/autocad/process-ownership.mjs",
  ]),
  "oracle-lab-f025": Object.freeze([
    "tools/oracles/freecad-f025-headless.py",
    "tools/oracles/network-isolation.mjs",
    "tools/oracles/pins.json",
    "tools/oracles/probe-tools.mjs",
    "tools/oracles/run-fixtures.mjs",
    "tools/oracles/run-f025-oracles.mjs",
  ]),
  "autocad-owned-process-failure-cleanup": Object.freeze([
    "tools/autocad/owned-process-failure-cleanup.test.mjs",
  ]),
  "autocad-f109-f111-closure-readback": Object.freeze([
    "tools/autocad/f109-desktop-readback.ps1",
    "tools/autocad/f109-runner.test.mjs",
    "parity/expected/F-109.json",
  ]),
  "cad-layout": Object.freeze([
    "packages/cad-core/src/layouts.ts",
  ]),
  "cad-page-setup": Object.freeze([
    "packages/cad-core/src/page-setups.ts",
  ]),
  "cad-plot-style": Object.freeze([
    "packages/cad-core/src/aci-palette.ts",
    "packages/cad-core/src/plot-style.ts",
  ]),
  "cad-publish": Object.freeze([
    "packages/cad-core/src/publish.ts",
  ]),
  "cad-legacy-import": Object.freeze([
    "packages/cad-core/src/legacy-import.ts",
  ]),
  renderer: Object.freeze([
    "packages/cad-renderer/src/bounds.ts",
    "packages/cad-renderer/src/renderer.ts",
    "packages/cad-renderer/src/rtree.ts",
  ]),
  dxf: Object.freeze([
    "packages/cad-dxf/src/index.ts",
  ]),
  "dxf-import": Object.freeze([
    "packages/cad-dxf/src/import.ts",
  ]),
  print: Object.freeze([
    "packages/cad-print/src/index.ts",
  ]),
  "package-exports": Object.freeze([
    "packages/cad-core/src/index.ts",
    "packages/cad-renderer/src/index.ts",
  ]),
  "certification-global": Object.freeze([
    "package.json",
    "package-lock.json",
    "apps/web/package.json",
    "packages/cad-core/package.json",
    "packages/cad-renderer/package.json",
    "packages/cad-dxf/package.json",
    "packages/cad-print/package.json",
    ".github/workflows/ci.yml",
    "evidence/artifacts/parity-package-v3-to-v4.json",
    "parity/rows.mjs",
    "tools/parity-kit/core.mjs",
    "tools/parity-kit/cli.mjs",
    "playwright.config.ts",
    "e2e/local-document.spec.ts",
    "tools/autocad/process-ownership.test.mjs",
    "tools/autocad/send-escape.ps1",
    "tools/parity/refresh-local-certification-evidence.mjs",
  ]),
  "oracle-lab": Object.freeze([
    "tools/oracles/fixtures/librecad-line-circle.dxf",
    "tools/oracles/freecad-headless.py",
    "tools/oracles/network-isolation.mjs",
    "tools/oracles/oracles.test.mjs",
    "tools/oracles/pins.json",
    "tools/oracles/probe-tools.mjs",
    "tools/oracles/README.md",
    "tools/oracles/run-f022-oracles.mjs",
    "tools/oracles/run-f023-oracles.mjs",
    "tools/oracles/run-fixtures.mjs",
    "tools/oracles/run-oracles.mjs",
  ]),
});

/**
 * Sources for audit rows that are implemented far enough to enter the source
 * graph, but have not passed the certification ratchet yet. Keeping these
 * mappings separate prevents source coverage from being confused with a 1.00
 * score in parity/local-certifications.json.
 */
export const UNCERTIFIED_SOURCE_ROWS = Object.freeze({
  "apps/web/src/App.tsx": Object.freeze(["F-026"]),
  "apps/web/src/workflows/modify-command.ts": Object.freeze(["F-026"]),
  "packages/cad-core/src/break.ts": Object.freeze(["F-026"]),
  "packages/cad-core/src/commands.ts": Object.freeze(["F-026"]),
  "packages/cad-core/src/index.ts": Object.freeze(["F-026"]),
  "packages/cad-core/src/trim.ts": Object.freeze(["F-026"]),
});

const certifiedIds = Object.freeze([
  "F-003", "F-015", "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022", "F-023", "F-024", "F-025",
  "F-097", "F-098", "F-099", "F-100", "F-101", "F-102", "F-103", "F-104", "F-105",
  "F-106", "F-107", "F-109", "F-111", "F-114",
]);

const groupsByRow = Object.freeze({
  "F-003": ["cad-modify", "dxf"],
  "F-015": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-016": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-017": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-018": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-019": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-020": ["web-modify-workflow", "cad-modify", "dxf"],
  "F-021": ["web-modify-workflow", "cad-modify", "cad-offset", "dxf"],
  "F-022": ["web-modify-workflow", "cad-modify", "cad-trim", "physical-shift-input", "dxf"],
  "F-023": ["web-modify-workflow", "cad-modify", "cad-trim", "physical-shift-input", "dxf"],
  "F-024": ["web-modify-workflow", "cad-container", "cad-modify", "cad-trim", "cad-fillet", "physical-shift-input", "dxf", "dxf-import", "print", "f024-shared-tests", "oracle-lab-f024"],
  "F-025": ["web-modify-workflow", "cad-container", "cad-modify", "cad-chamfer", "physical-shift-input", "dxf", "dxf-import", "f025-shared-tests", "oracle-lab-f025"],
  "F-097": ["cad-layout", "cad-container"],
  "F-098": ["cad-layout", "cad-container", "renderer"],
  "F-099": ["cad-layout", "cad-container", "renderer"],
  "F-100": ["cad-layout", "renderer"],
  "F-101": ["cad-layout", "renderer"],
  "F-102": ["cad-layout", "cad-page-setup", "print"],
  "F-103": ["cad-layout", "cad-page-setup", "cad-plot-style", "renderer", "print"],
  "F-104": ["cad-layout", "renderer", "print", "autocad-owned-process-failure-cleanup"],
  "F-105": ["cad-layout", "cad-publish", "print"],
  "F-106": ["cad-layout", "cad-page-setup", "print"],
  "F-107": ["cad-layout", "cad-page-setup", "cad-container"],
  "F-109": ["cad-plot-style", "dxf", "autocad-owned-process-failure-cleanup", "autocad-f109-f111-closure-readback"],
  "F-111": ["cad-container", "cad-legacy-import", "dxf", "dxf-import", "autocad-owned-process-failure-cleanup", "autocad-f109-f111-closure-readback"],
  "F-114": ["cad-layout", "cad-publish", "print"],
});

const stageOverrides = Object.freeze({
  "F-003": { browser: "parity:f003:browser-artifact", readback: "parity:f003:readback", autocad: "parity:f003:autocad" },
  "F-015": { browser: "parity:f015:browser-artifact", readback: "parity:f015:readback", autocad: "parity:f015:autocad" },
  "F-016": { browser: "parity:f016:browser-artifact", readback: "parity:f016:readback", autocad: "parity:f016:autocad" },
  "F-017": { browser: "parity:f017:browser-artifact", readback: "parity:f017:readback", autocad: "parity:f017:autocad" },
  "F-018": { browser: "parity:f018:browser-artifact", readback: "parity:f018:readback", autocad: "parity:f018:autocad" },
  "F-019": { browser: "parity:f019:browser-artifact", readback: "parity:f019:readback", autocad: "parity:f019:autocad" },
  "F-020": { browser: "parity:f020:browser-artifact", readback: "parity:f020:readback", autocad: "parity:f020:autocad" },
  "F-021": { browser: "parity:f021:browser-artifact", readback: "parity:f021:readback", autocad: "parity:f021:autocad" },
  "F-022": { browser: "parity:f022:browser-artifact", readback: "parity:f022:readback", autocad: "parity:f022:autocad", oracle: "parity:f022:oracles", cross: "parity:f022:cross-evidence" },
  "F-023": { browser: "parity:f023:browser-artifact", readback: "parity:f023:readback", autocad: "parity:f023:autocad", oracle: "parity:f023:oracles", cross: "parity:f023:cross-evidence" },
  "F-024": { browser: "parity:f024:browser-artifact", readback: "parity:f024:readback", autocad: "parity:f024:autocad", oracle: "parity:f024:oracles", cross: "parity:f024:cross-evidence" },
  "F-025": { browser: "parity:f025:browser-artifact", readback: "parity:f025:readback", autocad: "parity:f025:autocad", oracle: "parity:f025:oracles", cross: "parity:f025:cross-evidence" },
  "F-097": { browser: "parity:f097:browser-artifact", readback: "parity:f097:readback", autocad: "parity:f097:autocad" },
  "F-098": { browser: "parity:f098:browser-artifact", readback: "parity:f098:readback", autocad: "parity:f098:autocad" },
  "F-099": { browser: "parity:f099:browser-artifact", readback: "parity:f099:readback", autocad: "parity:f099:autocad" },
  "F-100": { browser: "parity:f100:browser-artifact", readback: "parity:f100:readback", autocad: "parity:f100:autocad", cross: "parity:f100:cross-evidence" },
  "F-101": { browser: "parity:f101:browser-artifact", readback: "parity:f101:readback", autocad: "parity:f101:autocad", cross: "parity:f101:cross-evidence" },
  "F-102": { browser: "parity:f102:browser-artifact", readback: "parity:f102:readback", autocad: "parity:f102:autocad", cross: "parity:f102:cross-evidence" },
  "F-103": { browser: "parity:f103:browser-artifact", readback: "parity:f103:readback", autocad: "parity:f103:autocad", cross: "parity:f103:cross-evidence" },
  "F-104": { browser: "parity:f104:browser-artifact", readback: "parity:f104:readback", autocad: "parity:f104:autocad", cross: "parity:f104:cross-evidence" },
  "F-105": { browser: "parity:f105:browser-artifact", readback: "parity:f105:readback", autocad: "parity:f105:autocad", cross: "parity:f105:cross-evidence" },
  "F-106": { browser: "parity:f106:browser-artifact", readback: "parity:f106:readback", autocad: "parity:f106:autocad", cross: "parity:f106:cross-evidence" },
  "F-107": { browser: "parity:f107:browser-artifact", readback: "parity:f107:readback", autocad: "parity:f107:autocad", cross: "parity:f107:cross-evidence" },
  "F-109": { browser: "parity:f109:browser-artifact", readback: "parity:f109:readback", autocad: "parity:f109:autocad", cross: "parity:f109:cross-evidence" },
  "F-111": { browser: "parity:f111:browser-artifact", readback: "parity:f111:readback", autocad: "parity:f111:autocad", cross: "parity:f111:cross-evidence" },
  "F-114": { browser: "parity:f114:browser-artifact", readback: "parity:f114:readback", autocad: "parity:f114:autocad", cross: "parity:f114:cross-evidence" },
});

export const PARITY_ROWS = Object.freeze(certifiedIds.map((id) => Object.freeze({
  id,
  sourceGroups: Object.freeze([
    "web-shell", "cad-document", "package-exports", "renderer", "certification-global",
    ...(["F-022", "F-023"].includes(id) ? ["oracle-lab"] : []),
    ...(groupsByRow[id] ?? []),
  ]),
  evidence: Object.freeze({
    autocad: `evidence/autocad/${id}.json`,
    browser: `evidence/browser/${id}.json`,
    readback: `evidence/readback/${id}.json`,
  }),
  receipts: Object.freeze([
    { kind: "global", path: "evidence/artifacts/parity-global-topology.json" },
    ...(["F-022", "F-023", "F-024", "F-025"].includes(id) ? [{ kind: "oracle", path: `evidence/artifacts/${id}-oracles.json` }] : []),
    ...(stageOverrides[id]?.cross && !["F-100", "F-101"].includes(id)
      ? [{ kind: "cross", path: `evidence/artifacts/${id}-cross-evidence.json` }]
      : []),
  ].map((receipt) => Object.freeze(receipt))),
  stages: Object.freeze(stageOverrides[id] ?? {}),
})));

export const RUNTIME_SOURCE_ROOTS = Object.freeze([
  "apps/web/src",
  "packages/cad-core/src",
  "packages/cad-renderer/src",
  "packages/cad-dxf/src",
  "packages/cad-print/src",
]);

export const CERTIFICATION_SOURCE_ROOTS = Object.freeze([
  "e2e",
  "tools/autocad",
  "tools/oracles",
  "tools/parity",
]);
