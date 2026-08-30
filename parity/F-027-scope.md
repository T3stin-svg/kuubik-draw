# F-027 STRETCH candidate scope

Status: **implemented candidate; not certified; score unchanged**.

Benchmark: AutoCAD 2024.1.2 on Windows, 2D Drafting & Annotation.

## Implemented and locally evidenced

- `S` and `STRETCH` resolve through the typed registry, workflow, preview and one atomic commit.
- Crossing windows and typed crossing polygons are unioned; individually selected and fully enclosed entities move as whole objects.
- LINE endpoints, POLYLINE vertices, ARC endpoints, partial-ELLIPSE endpoints, SPLINE control points, LEADER vertices, DIMENSION definition points and HATCH loop vertices use one preview/commit predicate.
- CIRCLE centers and insertion/anchor entities move only when their anchor is enclosed.
- Hidden, frozen, locked, missing and unsupported targets fail without partial document mutation.
- Canvas pointer drag creates a real crossing window; a physical multi-click Crossing Polygon supports point-level command-local Undo and explicit completion. Typed base/destination points and global Undo/Redo are covered.
- Production DXF and KDRAW1 exports are independently read back; LibreCAD 2.2.1.5 and FreeCAD 1.1.3 remain secondary `certificationAuthority: false` oracles.
- AutoCAD Core Console measurements cover axis-aligned and rotated half ellipses, quarter ellipses, arbitrary parameter spans, full-ellipse refusal, arcs, circles, polylines and individual selection. Kuubik's generic partial-ellipse reconstruction matches every measured center, major axis, ratio and parameter within the native runner tolerance.
- Crossing-edge and ellipse-basis tolerances are scale invariant. A dedicated sub-millimetre regression proves that a short crossing edge does not falsely select the opposite ellipse endpoint and that canonicalization does not reject a valid ellipse merely because its axis-area product is below an absolute world-unit threshold.

Autodesk's STRETCH contract says crossing-enclosed endpoints and vertices move while fully enclosed or individually selected objects move as whole objects. ObjectARX exposes this through `getStretchPoints()` and `moveStretchPointsAt()`. The native API is the behavioral reference; its implementation is not copied.

- <https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-F000A502-D39E-4D31-A8E2-4A626473FB72.htm>
- <https://help.autodesk.com/cloudhelp/2022/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Entity_MoveStretchPointsAt_IntegerCollection_Vector3d.html>

## Known parity gaps

1. The full workflow has not yet run in an isolated, owned AutoCAD 2024.1.2 Desktop process.
2. Independent review has not yet reached `0 P0 / 0 P1`.

The current cross-evidence receipt is deliberately labeled `CANDIDATE_PASS_DESKTOP_AND_REVIEW_REQUIRED`; it cannot be consumed as a certification receipt.

The final Desktop/review matrix must pay special attention to end-endpoint
movement, parameter spans that wrap past `2π`, and AutoCAD's full-ellipse
no-change selection/status wording. These are review targets, not certified
claims in the current candidate.

## Certification gate

F-027 must not enter `certifiedIds` or `local-certifications.json` until every gap above is closed, all existing 26 certified rows retain their SHA/evidence ratchet, the public CI is green on the exact candidate commit, and the score is independently recalculated.
