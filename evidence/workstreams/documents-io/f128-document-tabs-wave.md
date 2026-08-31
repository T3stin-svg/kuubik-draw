# F-128 document tabs candidate wave

Status: candidate implementation; no parity score change.

- Open document identity is unique; reopening activates the existing tab instead of duplicating state.
- Each tab owns its document snapshot, persisted revision and active Model/Layout context.
- Duplicate file labels are disambiguated deterministically without changing document ids.
- Tab reorder and adjacent activation after close are deterministic.
- Dirty tabs require an explicit discard decision; saving must acknowledge the exact current revision.
- The React integration component reuses the existing document-tab class contract; App.tsx and style.css remain untouched.

Certification still requires the Chromium multi-document workflow, owned AutoCAD SDI=0 comparison and current-byte cross-evidence.
