# Documents I/O sixth-wave F-133 recovery and compaction

Base: `2bbec19176b8a17bc88f6b3ff962e8caf2fb444e`.

Branch: `work6/reio-documents-live`.

Status: F-133 candidate contract extended; parity scores unchanged.

## Implemented boundary

- IndexedDB schema v3 migrates in place and adds indexed append-only compaction records.
- Controlled compaction requires a clean recovered head and a positive operation threshold.
- Snapshot, exact document SHA-256, operation prefix boundary, last operation id and optional session history are bound into a hashed compaction record.
- The compaction transaction receives an independent stored-record and stored-document read-back before success is reported.
- No operation, snapshot, attachment, recovery event or compaction record is deleted.
- Recovery starts from the newest valid compaction and SHA-validates the later tail; a corrupt compact snapshot or compact record falls back to full-log replay.
- An incomplete operation tail is named and ignored from its first invalid record onward.
- Repeated recovery and repeated quarantine acceptance preserve the same document, receipt and append-only operation count.
- Stable `StoragePersistenceError` codes distinguish quota, transaction abort and generic request failure.
- A deterministic `RecoveryReceipt` provides the machine code and Estonian user summary required by the caller.

## Covered scenarios

- two documents with independent operation counts and recovery revisions;
- threshold skip and successful controlled compaction;
- compact snapshot checksum mutation;
- compact record mutation;
- incomplete operation tail after a valid compaction;
- idempotent replay/quarantine;
- duplicate-operation transaction abort with exact three-store rollback;
- deterministic `QuotaExceededError` classification;
- legacy and non-compacted full-log replay regressions;
- F-128–F-130 live orchestrator receipt wiring without changing App or alias behavior.

## Browser reload fixture

URL: `http://127.0.0.1:5206/src/features/documents/recovery-compaction-harness.html`.

1. Open `?phase=seed`; expected status is `läbitud`, alpha operations 3, beta operations 1, alpha compact revision 2 with read-back verified.
2. Navigate to `?phase=recover` in the same profile; expected status is `läbitud`.
3. Expected alpha receipt: `RECOVERY_DEGRADED`, source `compaction`, revision 2, ignored `alpha-incomplete-browser-tail`, unclean `browser-crashed`.
4. Expected beta receipt: `RECOVERY_REPLAYED`, source `operation-log`, revision 1, no ignored operation, unclean `browser-crashed`.
5. Expected repeated alpha replay: identical document and receipt; operation counts remain 3/1.

Observed in real Chromium on port 5206:

- seed status `läbitud`; compaction revision 2, operations 2, read-back verified, stored operation counts 3/1;
- first recover status `läbitud`; alpha `RECOVERY_DEGRADED` at revision 2 from compaction, beta `RECOVERY_REPLAYED` at revision 1 from operation log;
- second full page load returned the same compaction key, receipts, revisions and 3/1 operation counts.

## Threat model and remaining blocker

SHA-256 is integrity evidence, not an authenticity signature. An actor with arbitrary same-origin IndexedDB write access can replace both data and digest. Browser quota enforcement, power-loss flush behavior and forced-process-kill behavior are not emulated by fake IndexedDB. The deterministic suite covers quota error mapping and abort rollback; an actual quota-exhaustion and externally forced Chromium kill remain manual certification blockers.

No App wiring, parity score, package manifest, main merge or production deployment is included.

## Verification

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 175 files / 876 tests.
- F-133 targeted unit/golden/mutation/wiring suite: PASS, 9 new tests plus existing storage/orchestrator regressions.
- `npm run gate:dxf`: PASS, 19 files / 54 tests.
- `npm run gate:pdf`: PASS, 7 files / 22 tests.
- `npm run build`: PASS, 143 modules transformed; pre-existing >500 kB chunk warning remains.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1514 files.
- `npm run license:check`: PASS, 119 installed packages audited.
- `git diff --check`: PASS.
- real Chromium seed/recover/recover read-back: PASS.

The final commit SHA is recorded in the branch handoff after commit and push.
