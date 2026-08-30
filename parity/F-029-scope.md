# F-029 ALIGN certification scope

Status: **locally certified at score 1.00; exact public-commit CI pending**.

Benchmark: AutoCAD 2024.1.2 on Windows, 2D Drafting & Annotation.

## Implemented and locally evidenced

- `AL` and `ALIGN` resolve through the production registry, typed transform kernel, visible workflow, preview and one atomic commit.
- One point pair performs translation. Two point pairs perform translation and rotation, followed by explicit uniform Scale `Yes` or `No`.
- LINE, ARC, CIRCLE, ELLIPSE, open/closed POLYLINE, rational SPLINE, TEXT and the remaining supported 2D entity families use the same immutable transform predicate.
- Degenerate references, no-op transforms, missing/proxy entities and locked targets return typed refusals without corrupting the document. Mixed selection can commit only the eligible targets and reports every rejected handle.
- Four physical canvas clicks populate the two source/destination pairs. Numeric entry, preview=commit, atomic Undo/Redo and IndexedDB operation logging are covered.
- Production DXF and KDRAW1 outputs are independently decoded. The strict importer resolves semantic layer/style identifiers by name; it still checks exact handles, geometry, supported appearance, polyline widths/bulge and rational spline degree/control points/knots/weights.
- LibreCAD 2.2.1.5 renders the exact production DXF to vector PDF and FreeCAD 1.1.3/OCCT independently reconstructs the aligned line and rational spline. Both remain `certificationAuthority: false`.
- The owned AutoCAD 2024.1.2 matrix creates a closed LWPOLYLINE and a true rational control-vertex SPLINE, then reads back degree, four control points, eight knots, normalized weights, closed/periodic/rational flags and zero fit points before and after one atomic Undo/Redo cycle.
- AutoCAD SaveAs DXF is parsed independently as 11/11 entities. Closed-polyline state, every width/bulge, SPLINE flags and raw group-41 weights must match the native COM state and the Kuubik production fixture.
- Independent final review closed at `0 P0 / 0 P1` on 2026-08-30.

## Closed local evidence gates

- Owned AutoCAD 2024.1.2 Desktop matrix: PASS.
- Chromium physical four-point workflow and current nested artifacts: PASS.
- Production DXF/KDRAW1 strict and independent read-back: PASS.
- LibreCAD/FreeCAD secondary oracle reports: PASS as non-authorities.
- Current-byte cross-evidence and independent `0 P0 / 0 P1` review: PASS.

F-029's public certification is complete only when the exact promoted commit passes public CI. No preview or production deployment is authorized by this certification.
