# Annotation and block integration contract

Status: candidate contract for session 4. This workstream does not modify DXF/PDF adapters,
shared package exports, `App.tsx`, package manifests or parity scores.

## Core entry points to export

Session 4 should re-export these files from the shared `@kuubik/cad-core` boundary without
renaming their symbols:

- `packages/cad-core/src/annotation/contracts.ts`
- `packages/cad-core/src/annotation/dimensions.ts`
- `packages/cad-core/src/annotation/text.ts`
- `packages/cad-core/src/annotation/hatch.ts`
- `packages/cad-core/src/annotation/update.ts`
- `packages/cad-core/src/annotation/dxf-capability.ts`
- `packages/cad-core/src/blocks/contracts.ts`
- `packages/cad-core/src/blocks/operations.ts`
- `packages/cad-core/src/blocks/transform.ts`

The UI integration points are `AnnotationPanel`, `ANNOTATION_TOOLS`, `createAnnotationAction`,
`BlocksPanel`, `BLOCK_TOOLS` and `createBlockAction`. The panels emit command intent only.
The application command runtime must allocate handles, collect points/options, call the core
planner and commit all returned changes once through `CadSession.commit`.

The typed web command boundaries are `annotation/command-adapter.ts`,
`annotation/association-workflow.ts` and `blocks/command-adapter.ts`. They return one complete
`PreparedAtomicCommand`; the shell must preview and commit that value as one operation rather than
committing intermediate prompts or planner results.

## Live shell command contract

The visual shell consumes only `AnnotationBlockShellAdapter` from
`apps/web/src/features/annotation/shell-adapter.ts`. It exposes:

- immutable `commandDefinitions` for the existing `CommandRegistry`;
- a user-visible capability row for every annotation/block command;
- command-specific `CommandPromptStateMachine` instances with typed value validation,
  cancel and repeat-from-first-prompt behavior;
- typed preview/execute plus whole-command Undo/Redo methods.

Typed command payloads are URI-encoded JSON tokens produced by `annotationCommandLine` or
`blockCommandLine`; visual code must not build raw command strings. `DIM` is the engine command
and requires exactly one of `LINEAR`, `ALIGNED`, `ANGULAR`, `RADIUS`, `DIAMETER`, `CONTINUE` or
`STYLE`. Its operation records both the canonical `DIM` command and the concrete typed planner
command. Each other definition rejects a payload whose discriminant does not match its command.

A command is registered as executable only when its planner and `AnnotationBlockSessionAdapter`
are present. The capability object supplies a stable `code` and Estonian `message` for disabled
UI state. AC1018 removes MLEADER from the executable registry and reports
`unsupported-dxf-version`; AC1021 or newer is required. The adapter is intentionally not wired
through `App.tsx` or `shell/**` in this workstream.

The live-ready path is `createPrompt → answer/skip → previewPrompt → executePrompt`. Prompt context
contains only active layer, selected stable handles and optional dimension anchors. Entity handles
are allocated deterministically from the active document immediately before preview; repeat thus
gets a new free handle instead of reusing a committed one. The prompt builders produce the exact
`AnnotationCommandInput` or `BlockCommandInput` consumed by the existing planner.

`executePrompt` requires a ready prompt, reuses the same typed input for engine execution and
returns an `AnnotationBlockPromptCommit`. Its read-back checks committed changes against preview,
then independently checks every created/deleted entity, style table or complete block drawing
replacement in the active `CadSession`. A read-back mismatch throws instead of returning success.
The visual integrator should render success only from this returned read-back, not from a click or
from `CommandExecutionResult.kind` alone.

## Common invariants

1. All points are finite double-precision model coordinates. View, zoom and paper coordinates
   must never be serialized into an annotation or block definition.
2. Entity handles, resource IDs and style references are stable identities. Updating an
   associative dimension/hatch or redefining a block replaces the immutable object value but
   retains its identity.
3. References are by stable handle/ID, never by array index. A missing or type-incompatible
   reference is a hard read/import failure or a reported broken association; it is not silently
   retargeted to nearby geometry.
4. One user command produces one `CadOperation` and one call to `CadSession.commit`, even when
   it creates/deletes several entities and resources. `BLOCK`, `BEDIT`, association propagation
   and `EXPLODE` must each be one Undo/Redo step.
5. Unknown namespaced extension data must round-trip unchanged. An adapter that cannot preserve
   it must fail closed and must not claim the related F-row or lossless round-trip.

## Namespaced annotation payload

Annotation-only fields live under `entity.extensionData["kuubik.annotation.v1"]`.
The object is serialized exactly as ordinary JSON data.

### Dimensions

The native `CadDimension` fields remain authoritative:

```json
{
  "kind": "dimension",
  "dimensionKind": "linear|aligned|angular|radial|diameter|ordinate",
  "definitionPoints": [{ "x": 0, "y": 0 }],
  "styleId": "DIM-ISO"
}
```

Associativity is encoded as:

```json
{
  "kuubik.annotation.v1": {
    "kind": "dimension",
    "associative": true,
    "linearAxis": "horizontal",
    "anchors": [
      { "handle": "10", "feature": "start", "fallback": { "x": 0, "y": 0 } },
      { "handle": "10", "feature": "end", "fallback": { "x": 100, "y": 0 } }
    ],
    "chain": { "id": "CHAIN-1", "index": 1, "previousDimensionHandle": "D1" }
  }
}
```

Allowed anchor features are `start`, `end`, `center`, `insertion`, `position` and `vertex`.
`vertex` additionally requires a non-negative `vertexIndex`. `fallback` is evidence and display
recovery data only; it must never be used to re-associate automatically after the target handle
is missing. `definitionPoints[0..anchors.length-1]` correspond to anchors in order. Remaining
definition points are the dimension-line, arc or text placement controls and remain unchanged
during association propagation.

Linear/aligned dimensions use four definition points: two true measured extension origins,
dimension-line definition point and text point. `linearAxis` is required for horizontal/vertical
linear dimensions because the measured origins need not lie on the dimension-line axis. Aligned
dimensions omit it. Adapters must not infer a linear dimension's rotation from the vector between
its two measured origins.

`styleId` references `document.dimensionStyles[].id`. A dimension style may reference
`textStyleId`; the full transitive style dependency must be emitted before the entity on formats
with tables. Import must reject dangling references.

DXF guidance: emit native DIMENSION subtypes and DIMSTYLE/TEXTSTYLE resources. Where supported,
emit handle-backed DIMASSOC semantics. If the chosen DXF version cannot preserve a particular
association, keep the KDraw payload but mark DXF output as lossy/unsupported for F-065 instead
of fabricating proximity-based associativity.

### MTEXT, LEADER and MLEADER

`CadText(kind="mtext")` stores position, text, height, rotation and optional `styleId` natively.
Its extension is:

```json
{
  "kind": "mtext",
  "width": 80,
  "attachment": "top-left",
  "lineSpacingFactor": 1.2
}
```

Allowed attachments are the nine top/middle/bottom × left/center/right combinations. Width,
height and line spacing are positive finite drawing units/factors.

Plain `LEADER` is a native `CadLeader` with two or more model-coordinate vertices and optional
text. `MLEADER` uses the same base kind so existing renderers can show its leader geometry, plus:

```json
{
  "kind": "mleader",
  "styleId": "MLEADER-STD",
  "textPosition": { "x": 22, "y": 10 },
  "textStyleId": "TXT-ISO",
  "textHeight": 2.5,
  "landingGap": 1
}
```

R2004/AC1018 predates native MLEADER. Session 4 must either select a format/version that supports
MLEADER, or fail closed for native MLEADER export. A LEADER+MTEXT surrogate may be offered only
as an explicitly lossy conversion and cannot prove F-060 round-trip parity.

### HATCH

Native `CadHatch.pattern`, `associative` and `loops[]` remain authoritative. Loops contain
finite polygon vertices and `isHole`. The extension is:

```json
{
  "kind": "hatch",
  "pattern": {
    "type": "solid|line",
    "angleRad": 0.7853981633974483,
    "scale": 2,
    "origin": { "x": 5, "y": 5 }
  },
  "boundaryHandles": ["20", "21"]
}
```

`boundaryHandles[i]` is the stable source for `loops[i]`. Islands use even/odd nesting depth:
outer depth 0 is filled, depth 1 is a hole, depth 2 is an island, and so on. Preserve array order
because it binds handles to loops. Association updates replace loop coordinates in place while
retaining hatch handle, layer, appearance, pattern and extension payload. Missing/open/degenerate
boundaries report a broken association and cause no partial hatch mutation.

DXF guidance: emit HATCH loop source handles where the format permits them, plus pattern name,
solid flag, angle, scale and origin. Read-back must compare loop count, hole/island parity,
source handles and pattern fields, not only rendered fill pixels.

## Namespaced block-definition payload

Block definitions and inserts are separate immutable values. A definition is a
`CadBlockDefinition` with optional top-level `extensionData["kuubik.block.v1"]`:

```json
{
  "kind": "block-definition",
  "version": 1,
  "attributeDefinitions": [
    {
      "tag": "MARK",
      "prompt": "Mark",
      "defaultValue": "D1",
      "position": { "x": 510, "y": 70 },
      "height": 50,
      "rotationRad": 0,
      "textStyleId": "TXT-ISO",
      "constant": false,
      "invisible": false
    }
  ]
}
```

Attribute tags are non-empty and case-insensitively unique. Optional booleans default to false.
The insert stores instance values in native `CadBlockReference.attributes`; keys serialize using
the definition's canonical tag spelling. Constant attributes always take the definition default.
Unknown instance tags are rejected.

`BLOCK` moves selected entity values into a new definition and replaces them in model space with
one independent `blockRef`. The source entity handles may remain in the definition because they
no longer exist in model space. The insert needs its own globally unique handle.

`INSERT` stores `blockId`, model-coordinate insertion, two finite non-zero scales, rotation in
radians and instance attributes. `BEDIT`/redefine creates a new immutable definition value with
the same block ID/name. Existing inserts, transforms, handles and attribute values are untouched.

`EXPLODE` expands one level. Newly materialized model entities receive new collision-free handles
because definition-member handles remain globally present inside the definition. Nested inserts
remain inserts after one explode. A transform that the current 2D schema cannot represent
(for example rotated nested content under a shear-producing non-uniform transform) fails before
mutation. Visible attributes become ordinary TEXT entities; invisible attributes do not.

Before define, redefine, import or deserialize, construct the complete block-reference graph and
run `assertAcyclicBlocks`. Direct and indirect cycles are hard errors. Missing nested definitions
are hard errors. Never rely on renderer recursion guards as document validation.

DXF guidance: definitions map to BLOCK/ENDBLK records and references to INSERT. Attribute
definitions map to ATTDEF; values map to ATTRIB/SEQEND. Redefinition keeps the same definition
identity so all existing INSERT references resolve to the new content. Import must validate the
complete graph before exposing any partial document.

## Fail-closed DXF capability gate

Before writing an annotation/block document, the DXF adapter must call
`assertAnnotationBlockDxfCapabilities(document, declaration)`. The declaration identifies the
adapter and selected DXF version and marks every semantic capability as `exact`, `lossy` or
`unsupported`. Missing declarations, `lossy`, `unsupported`, and a DXF version older than a
capability's minimum version are hard failures before any download or file mutation. Native
MLEADER requires at least AC1021; declaring it `exact` for AC1018 is rejected.

The gate derives requirements from the actual document, including style tables, stable
dimension/hatch associations, hatch holes, block nesting, insert transforms and attributes.
Session 4 must add the adapter-specific declaration at its output boundary and independently
read back the fixture described in
`evidence/workstreams/annotation-blocks/dxf-readback-fixture.json`. That JSON is a test contract,
not evidence that a DXF adapter or AutoCAD round trip has passed.

For adapter-independent contract testing, core also exposes
`createAnnotationBlockDxfCapabilityReceipt` and
`readBackAnnotationBlockDxfCapabilityReceipt`. The serialized receipt binds the exact derived
capability requirements, handle list, adapter declaration and DXF version to the current document.
A changed handle, requirement or AC1018 downgrade for native MLEADER fails read-back. This proves
only the capability contract; it does not prove that a DXF file was written or reopened.

## Deterministic ordering and failure behavior

- Preserve document array order for entities, styles, definitions and definition members.
- Preserve continued-dimension order by `chain.index`; reject duplicate or negative indices.
- Preserve hatch boundary/loop pairing by array position.
- Preserve block attribute definition order; instance object keys are emitted in definition order.
- Reject duplicate handles across model entities and all block members.
- Reject duplicate block/style IDs and case-insensitive names where the core planner does.
- Reject non-finite coordinates, zero insert scale, degenerate dimensions/hatch loops and block
  cycles before calling `CadSession.commit`.
- Import/export validation must operate on a clone. No partial document or partial file is valid.

## Required session 4 read-back matrix

1. Linear/aligned/angular/radius/diameter/continued dimensions: type, definition points, style,
   chain and both association target handles.
2. MTEXT and text styles: Unicode text, line breaks, width, attachment, spacing, font, width factor
   and oblique angle.
3. LEADER and MLEADER: vertices, content placement, both style references and native/lossy status.
4. SOLID and ANSI31-like line HATCH: outer loop, hole, nested island, angle, scale, origin and
   boundary source handles; mutate a boundary and verify same hatch handle after update.
5. BLOCK/INSERT: base point, member handles, insert handle, rotation, positive/negative non-zero
   scales and nested acyclic block.
6. Redefine: open/reload and verify two pre-existing inserts retain exact transforms/attributes but
   render the new definition.
7. Attributes: default, overridden, constant and invisible values; edit, Undo, Redo and reload.
8. Cycle, dangling handle/style, duplicate handle and unsupported transform mutants must fail before
   download or document mutation.

The F-row remains below `1.00` until the same visible workflow is proven in AutoCAD 2024.1.2 and
Kuubik and the produced file is independently read back.
