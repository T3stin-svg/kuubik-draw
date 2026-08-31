/**
 * Fixed visual-parity denominator for AutoCAD 2024.1.2 Drafting & Annotation.
 *
 * This manifest intentionally keeps the independently audited 2026-08-27
 * baseline until all six states have same-environment AutoCAD and Kuubik
 * captures plus measured read-back. A shell improvement is not a score claim.
 */

export const VISUAL_BASELINE = Object.freeze({
  auditDate: "2026-08-27",
  assessedCommit: "14475e6d2590c5c1537673ec45ad11a6c3d7aa92",
  viewport: Object.freeze({ width: 1920, height: 1080, browserZoomPercent: 100 }),
  baselineScore: 0.6074999999999999,
  claimedScore: 0.6074999999999999,
  categories: Object.freeze([
    Object.freeze({ id: "shell-zones", label: "Ekraani põhijaotus ja tsoonid", weight: 0.30, score: 0.65 }),
    Object.freeze({ id: "ribbon-palettes-density", label: "Ribbon, paletid, mõõdud ja infotihedus", weight: 0.25, score: 0.50 }),
    Object.freeze({ id: "command-status-layout", label: "Käsuaken, olekuriba ja Model/Layout loogika", weight: 0.20, score: 0.55 }),
    Object.freeze({ id: "color-type-icons", label: "Värvid, tüpograafia ja ikoonikeel", weight: 0.15, score: 0.75 }),
    Object.freeze({ id: "interaction-states", label: "Active/hover/disabled/dock/context states", weight: 0.10, score: 0.65 }),
  ]),
});

export const VISUAL_STATES = Object.freeze([
  Object.freeze({
    id: "empty-workspace",
    label: "Tühi tööruum",
    status: "KUUBIK_CAPTURED",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/idle", sha256: "0e014882f8fa7231800f02702c30f4a8697d7fd49ef860b487d0768dbda48640" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-empty-workspace.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-zones.json",
    supplementalMeasuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
    comparisonReadback: "evidence/artifacts/visual-shell-wave-8/autocad-light-model-readback.json",
    supplementalComparisonReadback: "evidence/artifacts/visual-shell-wave-10/autocad-ribbon-readback.json",
    chromeComparisonReadback: "evidence/artifacts/visual-shell-wave-10/autocad-top-chrome-readback.json",
  }),
  Object.freeze({
    id: "active-drawing-command",
    label: "Aktiivne joonestuskäsk",
    status: "KUUBIK_CAPTURED",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/line-active", sha256: "08505f04ee81f68e2adf76aa2cd06a0d5f9d12778ff1391bcd167ddb4cbaf4bc" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-active-command.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
  }),
  Object.freeze({
    id: "selected-properties",
    label: "Valitud objekt ja Properties",
    status: "KUUBIK_CAPTURED",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/selected-properties", sha256: "6a9037b0ec7bad08692f2ebdbd3da4b09aa125bde1efc2a3de66223b9c82ef0c" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-selected-properties.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
  }),
  Object.freeze({
    id: "layer-manager",
    label: "Layer Properties Manager",
    status: "KUUBIK_CAPTURED",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/selected-properties", sha256: "6a9037b0ec7bad08692f2ebdbd3da4b09aa125bde1efc2a3de66223b9c82ef0c" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-layer-manager.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
  }),
  Object.freeze({
    id: "layout-paper-space",
    label: "Layout ja paberiruum",
    status: "KUUBIK_CAPTURED",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/layout", sha256: "bda16d92411c9f257c6a481ba901d7cf3f974747652cf6012d0199129c013ada" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-layout-paper-space.png",
    supplementalKuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-layout-tools-open.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
  }),
  Object.freeze({
    id: "command-history-context",
    label: "Käsuajalugu või kontekstimenüü",
    status: "PASS",
    autoCadEvidence: Object.freeze({ ref: "private://autocad-2024/command-history-context", sha256: "7d09b94155baeed852ede285b895061713372f87e8486e55d5cfe89d406bc07e" }),
    kuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-command-history.png",
    supplementalKuubikEvidence: "evidence/artifacts/visual-shell-wave-10/visual-shell-context-menu.png",
    measuredReadback: "evidence/artifacts/visual-shell-wave-10/visual-shell-states.json",
    comparisonReadback: "evidence/artifacts/visual-shell-wave-6/autocad-reference-readback.json",
  }),
]);

export const VISUAL_ACCEPTANCE = Object.freeze({
  categoryCount: 5,
  stateCount: 6,
  zoneTolerancePx: 2,
  repeatedControlTolerancePx: 1,
  requiredStatusForScoreIncrease: "PASS",
  proprietaryAssetsAllowed: false,
});
