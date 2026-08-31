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
targets are explicitly rejected rather than silently approximated. Quick Select and
Select Similar update selection state only and therefore do not create document Undo
records.
