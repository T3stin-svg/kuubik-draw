import type { RecoveryReceipt } from "../indexed-db.js";

interface RecoveryPanelProps {
  receipt: RecoveryReceipt;
  repeated: boolean;
  onDismiss: () => void;
}

function EvidenceList({ label, values, empty }: { label: string; values: readonly string[]; empty: string }) {
  return <div className="recovery-evidence-row"><dt>{label}</dt><dd>{values.length ? values.join(", ") : empty}</dd></div>;
}

export function RecoveryPanel({ receipt, repeated, onDismiss }: RecoveryPanelProps) {
  const incompleteTail = receipt.ignoredOperationIds.length > 0;
  const degraded = incompleteTail || receipt.corruptSnapshotKeys.length > 0 || receipt.corruptCompactionKeys.length > 0;
  return (
    <aside
      className={`recovery-panel recovery-${receipt.status}`}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="recovery-panel-title"
      data-testid="recovery-panel"
      data-recovery-code={receipt.code}
      data-recovery-status={receipt.status}
      data-recovery-revision={receipt.recoveredRevision ?? ""}
      data-incomplete-tail={incompleteTail ? "true" : "false"}
      data-quarantined-count={receipt.ignoredOperationIds.length}
      data-corrupt-snapshot-count={receipt.corruptSnapshotKeys.length}
      data-corrupt-compaction-count={receipt.corruptCompactionKeys.length}
      data-repeated-recovery={repeated ? "true" : "false"}
    >
      <header><div><strong id="recovery-panel-title">DRAWING RECOVERY</strong><span>{receipt.code}</span></div><button type="button" aria-label="Sulge taastamispaneel" onClick={onDismiss}>×</button></header>
      <p>{receipt.summaryEt}</p>
      <dl>
        <div className="recovery-evidence-row"><dt>Allikas</dt><dd>{receipt.source}</dd></div>
        <div className="recovery-evidence-row"><dt>Taastatud revisjon</dt><dd>{receipt.recoveredRevision ?? "puudub"}</dd></div>
        <div className="recovery-evidence-row"><dt>Incomplete tail</dt><dd>{incompleteTail ? "jah — rakendamata" : "ei tuvastatud"}</dd></div>
        <EvidenceList label="Karantiinis operatsioonid" values={receipt.ignoredOperationIds} empty="puuduvad" />
        <EvidenceList label="Vigased snapshotid" values={receipt.corruptSnapshotKeys} empty="puuduvad" />
        <EvidenceList label="Vigased compactionid" values={receipt.corruptCompactionKeys} empty="puuduvad" />
        <EvidenceList label="Katkenud sessioonid" values={receipt.uncleanSessionIds} empty="puuduvad" />
        <div className="recovery-evidence-row"><dt>Kordustaastus</dt><dd>{repeated ? "sama revisjon, allikas ja karantiin" : "esimene kontroll selles brauseris"}</dd></div>
      </dl>
      <footer>{degraded
        ? "Midagi ei kustutatud automaatselt. Vigane saba jäi rakendamata ja tõend säilis."
        : "Midagi ei kustutatud ega muudetud automaatselt. Salvestatud revisjon avati taastamistõendiga."}</footer>
    </aside>
  );
}
