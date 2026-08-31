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
