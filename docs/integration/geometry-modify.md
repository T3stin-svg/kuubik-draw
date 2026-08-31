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
has no associative-array entity. PEDIT supports lines and polylines; unsupported Join
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

The integration owner should register adapters for every exported geometry/modify
preparation function, then mount one `CommandLineEngine` beside the application-owned
`CadSession`. The engine resolves canonical names and aliases, canonicalizes `/Option`
keywords, supports quoted arguments, history navigation, Escape, Enter/Space repeat,
and built-in atomic `U`/`UNDO`/`REDO`. PGP-style alias text uses
`ALIAS, *COMMAND` lines.

The engine does not provide a React command palette or mutate application CSS. That
UI and command-specific prompt orchestration remain integration work because
`App.tsx` and `style.css` are outside this workstream's file ownership.
