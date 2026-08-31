# Geometry and modify integration contract

This workstream deliberately does not edit shared `src/index.ts` barrels or `apps/web/src/App.tsx`.
The integration branch must review and explicitly export/wire the modules listed here.

## Wave 1 exports

From `packages/cad-core/src/geometry-commands.ts`:

- `GeometryCommandInputError`
- `GEOMETRY_COMMAND_ALIASES`
- `prepareGeometryCommand`
- the input, construction, and prepared-result types used by that function

From `packages/cad-renderer/src/geometry-preview.ts`:

- `createGeometryPreview`
- `hitTestGeometryPreview`
- `GeometryPreviewSnapshot`

The web application can wire `prepareGeometryCommand` into
`createGeometryWorkflow` from
`apps/web/src/features/draw-modify/geometry-workflow.ts`. The workflow deliberately
accepts an adapter so the feature remains typechecked before the shared core barrel
is changed by the integration owner.

## Required host wiring

1. Allocate all result handles before preparing a command.
2. Use the exact `entities` returned by `prepareGeometryCommand` for preview.
3. Commit the accompanying `changes` as one `CadSession.commit` operation.
4. Route command-level Undo/Redo to `CadSession.undo` and `CadSession.redo`.
5. Add command prompts/options and browser interactions in the integration-owned
   application shell; do not duplicate geometry calculations there.

Wave 1 is implemented and unit-tested, but remains intentionally uncertified:
there is no integration-branch browser workflow, AutoCAD live comparison, or saved
output read-back in this branch yet.

## Wave 2 exports

From `apps/web/src/features/draw-modify/modify-command-matrix.ts`:

- `MODIFY_COMMAND_MATRIX`
- `previewModifyMatrixCommand`
- `commitModifyMatrixCommand`
- `undoLastModifyMatrixStep`
- `ModifyMatrixInput` and `PreparedModifyMatrixCommand`

This feature layer routes TRIM, EXTEND, FILLET, and STRETCH variants into the
existing, tested core/workflow implementation. Integration should call the preview
and commit functions directly; both pass through the same internal preparation
matrix. The matrix commit produces one `CadSession` operation, while command-local
Undo is an immutable input-prefix replay and does not mutate the document.

## Wave 3 exports

From `packages/cad-core/src/array-commands.ts`:

- `prepareArrayCommand`
- `arrayPathLength`
- `arrayPathSample`
- `ArrayCommandInputError`
- ARRAYRECT, ARRAYPOLAR, ARRAYPATH input and prepared-result types

From `packages/cad-core/src/pedit.ts`:

- `preparePeditCommand`
- `PeditInputError`
- `PeditAction`, `PeditCommandInput`, and `PreparedPeditCommand`

From `packages/cad-core/src/selection-query.ts`:

- `quickSelect`
- `selectSimilar`
- Quick Select and Select Similar input/result types

From `apps/web/src/features/draw-modify/atomic-command-workflow.ts`:

- `createAtomicCommandWorkflow`
- `PreparedAtomicCommand` and `AtomicCommandAdapter`

The host should adapt `prepareArrayCommand` and `preparePeditCommand` to
`PreparedAtomicCommand` and supply that adapter to the generic feature workflow.
ARRAYPATH currently creates non-associative copies because the v1 document schema
has no associative-array entity. Circular arcs use analytic length/tangent evaluation;
ellipses and splines use deterministic adaptive subdivision plus a stable finite-
difference tangent. PEDIT supports lines and polylines; unsupported Join
targets are explicitly rejected rather than silently approximated. Open ARC targets
are converted to an exact signed bulge, including reversed joins and Join tolerance.
Quick Select and
Select Similar update selection state only and therefore do not create document Undo
records.

## Wave 4 exports (F-012 only)

From `packages/cad-core/src/spline.ts`:

- `createControlVertexSpline`
- `createFitPointSpline`
- `splinePointAtParameter`
- `prepareSplineCommand`
- SPLINE input, parameterization, and prepared-result types

Only the F-012 creation kernel from WIP commit
`0d9ca9a1d27d5e3c4e6382283b593b4d326a5b49` was adapted. No WIP commit or shared
barrel/package change was imported. The current pinned schema lacks the WIP Fit
fields, so Fit points, tolerance, parameterization, and tangents are stored under
`extensionData.splineDefinition` while the actual evaluated NURBS remains a standard
`CadSpline`.

Integration should route `SPL`/`SPLINE` to `prepareSplineCommand` and use the generic
atomic workflow. Fit, control-vertex, closed periodic, endpoint tangent, and Object
replacement modes are available. Non-zero Fit tolerance is retained as editable
metadata and now drives a deterministic bounded approximation. Preview and commit
both call `prepareSplineCommand`, so they receive the same control polygon and knots.
Certification still requires the integration-owned browser workflow and live AutoCAD
read-back.

## Wave 5 exports

From `packages/cad-core/src/boundary-region.ts`:

- `prepareBoundaryCommand`
- `prepareRegionCommand`
- `BoundaryRegionInputError`
- BOUNDARY/REGION input and prepared-result types

BOUNDARY returns either a closed polyline or a Kuubik region proxy. REGION converts
closed polylines, full circles, and full ellipses into the same proxy format. The v1
schema has no native region entity, so integration must display the proxy limitation
and must not present the result as native ACDBREGION/DXF round-trip parity. Straight
line/open-polyline loops, closed polylines, circles, and full ellipses are supported;
stitched arc/bulge loops are not yet supported.

## Wave 6 exports

From `apps/web/src/features/command-system/command-engine.ts`:

- `CommandLineEngine`
- `CommandRegistry`
- `parseAliasFile`
- `CommandEngineInputError`
- command definition, invocation, preparation, option, and result types

From `apps/web/src/features/command-system/geometry-modify-adapters.ts`:

- `prepareGeometryModifyDocumentCommand`
- `prepareGeometryModifySelectionCommand`
- `createGeometryModifyCommandDefinitions`
- `GEOMETRY_MODIFY_DOCUMENT_COMMAND_IDS`
- typed document/selection request maps and invocation parser map

The integration owner should register adapters for every exported geometry/modify
preparation function, then mount one `CommandLineEngine` beside the application-owned
`CadSession`. The engine resolves canonical names and aliases, canonicalizes `/Option`
keywords, supports quoted arguments, history navigation, Escape, Enter/Space repeat,
and built-in atomic `U`/`UNDO`/`REDO`. PGP-style alias text uses
`ALIAS, *COMMAND` lines.

The engine does not provide a React command palette or mutate application CSS. That
UI and command-specific prompt parsing remain integration work because
`App.tsx` and `style.css` are outside this workstream's file ownership.

The typed adapter covers LINE, PLINE, CIRCLE, ARC, POLYGON, ELLIPSE, REVCLOUD,
ARRAYRECT, ARRAYPOLAR, ARRAYPATH, PEDIT, SPLINE, BOUNDARY, REGION, TRIM, EXTEND,
FILLET, and STRETCH through one `PreparedAtomicCommand` contract. QSELECT and
SELECTSIMILAR have a separate selection-only adapter so they never create a fake
document transaction. The visual worker supplies typed `CommandInvocation` parsers
and may register the resulting definitions directly in `CommandRegistry`.

## Wave 7 exports (F-002 PLINE matrix)

From `packages/cad-core/src/pline-command.ts`:

- `startPlineCommand`
- `applyPlineCommandAction`
- `preparePlineCommandState`
- `PlineCommandState`, `PlineCommandAction`, `PlineArcConstruction`, and
  `PlineSegmentMode`

The integration owner should expose Line/Arc mode, Width/Halfwidth, Close, and
command-local Undo through one immutable `PlineCommandState`. Arc input variants are
Through (second point), Angle, Center, Direction, and Radius; signed bulges are
written on the segment's start vertex. Arc-mode Close derives the closing arc from
the previous segment's end tangent and does not duplicate the seam vertex.

Both the canvas ghost and final command must call `preparePlineCommandState` for the
same state. Commit its returned `changes` once through `CadSession`; do not turn each
vertex action into a document operation. This preserves one global Undo/Redo step
while `applyPlineCommandAction(..., { type: "undo" })` remains command-local and
document-free.

F-002 now has a core golden/property/mutation matrix plus production DXF export and
import read-back for handle, layer, closed seam, signed bulges, and variable widths.
It remains uncertified until the integration branch supplies a real browser workflow
and an AutoCAD 2024.1.2 live comparison. No shared `src/index.ts` barrel was changed.

## Wave 8 exports (F-003 RECTANGLE option matrix)

From `packages/cad-core/src/rectangle-command.ts`:

- `prepareRectangleCommand`
- `RectangleCommandInputError`
- `RectangleCommandInput`, `RectangleConstruction`, `RectangleDirection`,
  `RectangleChamfer`, `NormalizedRectangleDefinition`, and
  `PreparedRectangleCommand`

The existing certified two-corner RECTANGLE registry path remains unchanged. The
integration owner can migrate its parser to the typed preparation function to add
Dimensions, Area, Rotation, Chamfer, Fillet, Width, Elevation, and Thickness without
duplicating geometry in the shell. Corners are projected onto the explicitly rotated
local axes; Dimensions and Area carry an explicit quadrant direction, so clockwise
and counterclockwise results are deterministic.

Chamfer and Fillet are mutually exclusive active corner styles. Width becomes exact
per-segment LWPOLYLINE start/end width, while signed Thickness becomes
`appearance.thickness`. Zero values normalize to omitted 2D properties. The pinned
schema has no Z/elevation coordinate, so every non-zero Elevation is rejected with
`UNSUPPORTED_ELEVATION` instead of being silently lost.

Preview and commit must call `prepareRectangleCommand` with the same immutable input.
Commit the returned single `changes` tuple once through `CadSession`, preserving one
global Undo/Redo step. The F-003 option matrix has core golden/property/mutation and
production DXF export/import read-back, but remains an uncertified extension until
the AutoCAD 2024.1.2 option matrix and Kuubik browser workflow are run live. No parity
score or certification record was changed by this lane.

## Wave 9 exports (F-004 complete CIRCLE matrix)

From `packages/cad-core/src/circle-command.ts`:

- `prepareCompleteCircleCommand`
- `solveCircleTangentConstruction`
- `CircleCommandInputError`
- `CompleteCircleCommandInput`, `CompleteCircleConstruction`,
  `CircleTangentConstraint`, `CircleTangentLine`, `CircleTangentCircle`,
  `CircleSolutionSelection`, `CircleTangentSolution`, and
  `PreparedCompleteCircleCommand`

The integration owner should migrate the existing CIRCLE parser to this typed kernel
to retain Center-Radius, Center-Diameter, 2P, and 3P while adding Tan-Tan-Radius and
Tan-Tan-Tan. Tangent constraints are exact infinite lines or circles. TTR covers
line/line, line/circle, and circle/circle pairs. TTT covers three lines, two lines and
a circle, one line and two circles, and three circles through enumerated signed
tangency systems.

Every finite candidate includes its center, radius, ordered tangent points, and side
signature. A unique result may commit directly. Multiple results require constraint
pick points, a near-center point, or an explicit deterministic candidate index;
equidistant or missing picks fail with `AMBIGUOUS_TANGENT_SOLUTION`. Empty,
concentric, parallel, collinear, non-finite, and zero-radius degeneracies fail before
an `EntityChange` exists.

Preview and commit must call `prepareCompleteCircleCommand` with the same immutable
input and commit its single returned change once through `CadSession`. The F-004
matrix has golden/property/mutation coverage and production DXF export/import
read-back for exact handle, layer, center, radius, appearance, linetype scale, and
thickness. It remains an uncertified extension until the AutoCAD 2024.1.2 tangent
matrix and Kuubik browser workflow are run live; parity scores were not changed.

## Wave 10 exports (F-005 complete ARC matrix)

From `packages/cad-core/src/arc-command.ts`:

- `prepareCompleteArcCommand`
- `solveStartEndRadiusArc`
- `ArcCommandInputError`
- `CompleteArcCommandInput`, `CompleteArcConstruction`, `ArcSolutionSelection`,
  `ArcConstructionSolution`, and `PreparedCompleteArcCommand`

The integration owner should migrate the existing ARC parser to this typed kernel.
It retains 3-Point and adds Start-Center-End/Angle/Length,
Start-End-Angle/Direction/Radius, and Center-Start-End/Angle/Length. The optional
`clockwiseCtrl` flag models the AutoCAD Ctrl direction switch. Angle and length
forms preserve minor/major intent; Start-End-Radius enumerates both possible centers
and both directed traversals. An ambiguous result requires an explicit direction
plus minor/major pair, a near-center pick, a through-point pick, or a candidate index.

Preview and commit must call `prepareCompleteArcCommand` with the same immutable
input. Commit its single returned change once through `CadSession`. Collinear 3P,
collapsed endpoints, zero/invalid radius or length, infinite-radius direction,
full-circle angle, impossible radius, and ambiguous picks fail before a change exists.

DXF ARC is counter-clockwise by definition. Export therefore swaps the start/end
angles of a clockwise Kuubik arc; import reads it back as CCW with swapped endpoints.
This preserves the exact geometric locus, handle, layer, radius, center, and common
appearance properties, but not the original command-direction flag. F-005 remains
uncertified until AutoCAD 2024.1.2 live command-matrix and Kuubik browser workflow
read-back are completed. No parity score or certification record was changed.

## Wave 11 exports (F-006 complete POLYGON matrix)

From `packages/cad-core/src/polygon-command.ts`:

- `prepareCompletePolygonCommand`
- `PolygonCommandInputError`
- `CompletePolygonCommandInput`, `CompletePolygonConstruction`,
  `PolygonOrientation`, `PolygonRotationInput`, `NormalizedPolygonDefinition`,
  and `PreparedCompletePolygonCommand`

The integration owner should migrate the existing POLYGON parser to this typed
kernel. It accepts 3 through 1024 sides and covers center-inscribed,
center-circumscribed, and first-edge construction. Center construction supports
counter-clockwise or clockwise order plus two rotation references. A radius-point
rotation points at the first vertex for inscribed geometry and at the first edge
midpoint for circumscribed geometry. Numeric rotation treats `rotationRad` as the
current snap-axis direction and places the bottom edge on that axis, matching the
documented AutoCAD numeric-radius behavior. Edge mode preserves both picked endpoints
exactly and uses orientation to choose the interior side.

Preview and commit must call `prepareCompletePolygonCommand` with the same immutable
input. Commit its single returned change once through `CadSession`. Invalid side
counts, identity, points, size, rotation, orientation, collapsed edges, numeric
overflow, and degenerate area fail before an `EntityChange` exists. The returned
entity and normalized geometry clone handle, layer, appearance, extension data,
center, radii, edge length, winding, and rotation metadata.

F-006 has golden/property/mutation/prepared-wiring coverage and production DXF
export/import read-back for a rotated clockwise 17-sided closed LWPOLYLINE. It
remains uncertified until the AutoCAD 2024.1.2 live POLYGON matrix and Kuubik browser
workflow are run with output read-back. No parity score or certification record was
changed.

## Wave 12 exports (F-007 complete ELLIPSE matrix)

From `packages/cad-core/src/ellipse-command.ts`:

- `prepareCompleteEllipseCommand`
- `EllipseCommandInputError`
- `CompleteEllipseCommandInput`, `CompleteEllipseConstruction`,
  `EllipseArcDefinition`, `EllipseArcDirection`, `NormalizedEllipseDefinition`,
  and `PreparedCompleteEllipseCommand`

The integration owner should migrate the existing ELLIPSE parser to this typed
kernel. It supports center/major-end/minor-distance construction and the AutoCAD
axis-endpoint form where the first selected axis may become either the canonical
major or minor axis. The returned entity always uses a major-axis vector and a
minor/major ratio in `(0, 1]`, with deterministic rotation and full-versus-arc
metadata.

Elliptical arcs accept either parameters or geometric polar angles. Polar angles are
converted with the ellipse radii before storage. AutoCAD and DXF traverse an ELLIPSE
arc counter-clockwise; an explicit clockwise Kuubik construction therefore stores
the equivalent swapped counter-clockwise parameter interval. This preserves the
exact locus and requested endpoint pair, while the original direction remains only
in the prepared normalized command metadata and is not recoverable from DXF alone.

Preview and commit must call `prepareCompleteEllipseCommand` with the same immutable
input. Commit its single returned change once through `CadSession`. Invalid identity,
non-finite points or arc inputs, axes at or below numeric tolerance, an invalid
center-mode minor radius, coincident arc endpoints, and numeric overflow fail before
an `EntityChange` exists. Use explicit full mode for a closed ellipse.

F-007 has golden/property/fuzz/mutation/prepared-wiring coverage and production DXF
export/import read-back for rotated full and elliptical-arc geometry, handle, layer,
parameters, colour, lineweight, and linetype scale. DXF ELLIPSE does not round-trip
Kuubik `appearance.thickness`. F-007 remains uncertified until the AutoCAD 2024.1.2
live command matrix and Kuubik browser workflow are run with output read-back. No
parity score or certification record was changed.

## Wave 13 exports (F-011 complete REVCLOUD matrix)

From `packages/cad-core/src/revcloud-command.ts`:

- `prepareRevcloudCommand`
- `startInteractiveRevcloudCommand`, `applyInteractiveRevcloudAction`, and
  `revcloudInputFromInteractiveState`
- `RevcloudCommandInputError`
- `RevcloudCommandInput`, `RevcloudConstruction`, `RevcloudArcLengths`,
  `RevcloudArcDirection`, `RevcloudStyle`, `InteractiveRevcloudState`,
  `InteractiveRevcloudAction`, `NormalizedRevcloudDefinition`, and
  `PreparedRevcloudCommand`

From `apps/web/src/features/draw-modify/revcloud-command-adapter.ts`:

- `revcloudCommandAdapter`

The integration owner should export the core symbols through the shared cad-core barrel and
route the REVCLOUD command-system parser to `revcloudCommandAdapter`. The adapter prepares one
atomic change and therefore uses exactly the same deterministic geometry for preview and commit.
Do not call the legacy `prepareGeometryCommand` REVCLOUD branch after this migration.

Creation supports Rectangular, Polygonal, and Freehand outlines. Rectangular input completes on
the second corner; Polygonal and Freehand require explicit Close and retain command-local Undo.
Object mode converts a closed lightweight polyline (including bulged segments), circle, full
ellipse, or closed spline in place. It preserves the source handle, layer, appearance, and
extension data; creation rejects duplicate handles. Creation and conversion both reject a
missing or locked target layer before producing an `EntityChange`.

The pinned F-011 interface retains minimum and maximum chord-length settings and rejects a
maximum greater than three times the minimum. Generated revision bumps use deterministic
LWPOLYLINE bulges. Reverse changes the sign of every bump without reversing vertex order;
Calligraphy adds deterministic tapered vertex widths. `kuubikRevcloud` extension metadata marks
the prepared polyline in the native document. Standard DXF preserves the closed LWPOLYLINE,
bulges, widths, handle, layer, and common appearance, but not Kuubik extension metadata.

F-011 has unit, versioned golden, property, mutation, prepared-wiring, feature-adapter, and DXF
roundtrip coverage. It remains uncertified until the AutoCAD 2024.1.2 live REVCLOUD matrix and
the Kuubik browser workflow are run with output read-back. No parity score or certification
record was changed.

## Wave 14 exports (F-031/F-032 ARRAY matrix)

From `packages/cad-core/src/array-commands.ts`:

- `prepareArrayCommand`
- `prepareArrayPathPropertyUpdate`
- `refreshAssociativePathArrays`
- `readArrayPathAssociation`
- `arrayPathLength` and `arrayPathSample`
- `ArrayCommandInputError`, `ArrayCommandInputErrorCode`
- ARRAYRECT, ARRAYPOLAR, ARRAYPATH, property-patch, association, refresh, and prepared-result types

From `apps/web/src/features/draw-modify/array-command-adapter.ts`:

- `arrayCommandAdapter`
- `arrayPathPropertyUpdateAdapter`
- `refreshArrayPathAdapter`
- adapter input types

The integration owner should route ARRAYRECT, ARRAYPOLAR, and ARRAYPATH through
`arrayCommandAdapter` and the shared `createAtomicCommandWorkflow`. RECT supports legacy exact
vectors plus signed row/column spacing and an array-axis angle. POLAR supports fill angle or angle
between items, Rotate Items, and radial rows. PATH supports Divide/Measure, start offset, Fill
Entire Path, an explicit count cap, forward/reverse direction, tangent-relative alignment, and
normal-direction rows.

The pinned schema has no native array entity. Associative ARRAYPATH therefore keeps standard child
entities and stores a deterministic `extensionData.kuubikArrayPath` definition on every child.
Source/path changes call `refreshArrayPathAdapter`; Properties changes call
`arrayPathPropertyUpdateAdapter`. Both retain a child handle while its
`sourceHandle:itemIndex:rowIndex` address survives, and add/delete only the count delta. The
association is a native Kuubik contract and intentionally does not survive standard DXF; expanded
geometry, handles, layers, and common properties do round-trip.

Do not call the Wave 3 non-associative adapter after migration. The new feature adapter prepares
preview and commit through the same kernel, and create/update/refresh each commit as one atomic
`CadSession` operation. Locked, off, frozen, missing-layer, missing-entity, invalid-spacing, invalid-
count, and source/path collision states fail before an operation exists.

F-031/F-032 remain uncertified until the complete AutoCAD 2024.1.2 command/Properties matrix and
the integration-owned Kuubik browser workflow are run with saved/rendered read-back. No parity
score or certification record was changed in this lane.

## Wave 15 exports (F-034 PEDIT matrix)

From `packages/cad-core/src/pedit.ts`:

- `preparePeditCommand`
- `readPeditCurveDefinition`
- `PeditInputError` and `PeditInputErrorCode`
- `PeditAction`, `PeditCommandInput`, `PeditJoinType`, `PeditCurveMode`,
  `PeditCurveDefinition`, `PeditJoinRejectionReason`, and `PreparedPeditCommand`

From `apps/web/src/features/draw-modify/pedit-command-adapter.ts`:

- `peditCommandAdapter`

The integration owner should export the core symbols through the shared cad-core barrel and route
the PEDIT parser to `peditCommandAdapter` plus `createAtomicCommandWorkflow`. The adapter prepares
the same immutable change set for preview and commit. One commit includes the retained source
handle plus every joined-entity deletion, so Undo and Redo cover the complete PEDIT action sequence
atomically.

The kernel converts a selected LINE or ARC into a lightweight polyline while retaining the selected
entity's handle, layer, appearance, and extension data. JOIN accepts open LINE, ARC, and polyline
targets, honours a finite fuzz tolerance, preserves exact signed ARC bulges, and exposes bounded
`extend`, `add`, and `both` joint types. The result always inherits the first selected source's
properties. Missing, locked, off, or frozen layers and unsupported/degenerate geometry fail closed;
JOIN reports rejected secondary objects without deleting them.

Supported edits are Open/Close, uniform Width, per-vertex start/end width, Reverse, Insert, Move,
Delete, Straighten, Fit, Spline, Decurve, and linetype-generation state. Inserting on a bulged
segment requires a point on that arc and splits both bulge and tapered width exactly. Fit/Spline are
deterministic Kuubik approximations: KDraw v1 has no classic fit-polyline entity, so the curve frame
is stored under `extensionData.kuubikPeditCurve` and the rendered entity is a sampled standard
polyline. Frame edits refit the sampled geometry; Decurve restores the straight frame. JOIN also
decurves before joining, matching the documented PEDIT workflow boundary.

Standard DXF preserves the expanded LWPOLYLINE geometry, handle, layer, closed state, bulges,
vertex widths, true colour, and lineweight. It intentionally does not preserve the Kuubik Fit/Spline
frame metadata. F-034 has unit/golden/property/fuzz, mutation, feature-wiring, atomic Undo/Redo, and
DXF read-back coverage. It remains uncertified until AutoCAD 2024.1.2 live PEDIT workflows and the
integration-owned Kuubik browser workflow are run with saved/rendered output read-back. No parity
score or certification record was changed in this lane.
