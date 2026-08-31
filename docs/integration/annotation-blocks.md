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
and requires exactly one of `LINEAR`, `ALIGNED`, `ANGULAR`, `RADIUS`, `DIAMETER`, `CONTINUE`,
`BASELINE` or `STYLE`. Its operation records both the canonical `DIM` command and the concrete typed planner
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
    "chain": { "id": "CHAIN-1", "index": 1, "mode": "continued", "previousDimensionHandle": "D1" }
  }
}
```

Allowed anchor features are `start`, `end`, `center`, `quadrant`, `insertion`, `position` and
`vertex`. `vertex` additionally requires a non-negative `vertexIndex`; `quadrant` requires
`quadrantIndex` 0, 1, 2 or 3 and resolves positive-X/Y/negative-X/Y for circles and arcs, or
positive-major/positive-minor/negative-major/negative-minor for ellipses. `fallback` is evidence and display
recovery data only; it must never be used to re-associate automatically after the target handle
is missing. `definitionPoints[0..anchors.length-1]` correspond to anchors in order. Remaining
definition points are the dimension-line, arc or text placement controls and remain unchanged
during association propagation.

Associative creation validates every anchor against the current document before returning an
entity. Linear/aligned dimensions require exactly two anchors, angular dimensions three, and
radius/diameter dimensions two (normally `center` plus `quadrant`). A missing or incompatible
handle, wrong anchor count, or resolved point that differs from the supplied measured point is a
hard error. A staged geometry command that would orphan an existing dimension is likewise refused
before revision change unless the caller explicitly selects a documented broken-association mode.

Linear/aligned dimensions use four definition points: two true measured extension origins,
dimension-line definition point and text point. `linearAxis` is required for horizontal/vertical
linear dimensions because the measured origins need not lie on the dimension-line axis. Aligned
dimensions omit it. Adapters must not infer a linear dimension's rotation from the vector between
its two measured origins.

`styleId` references `document.dimensionStyles[].id`. A dimension style may reference
`textStyleId`; the full transitive style dependency must be emitted before the entity on formats
with tables. Import must reject dangling references.

Continued chains measure adjacent point pairs and set `chain.mode="continued"`. Baseline chains
measure every point from the immutable first origin and set `chain.mode="baseline"`; entries after
index zero also carry `baselineDimensionHandle` pointing to the first dimension. Chain creation is
one planner result and one Undo/Redo step. The serializer must preserve chain array order and both
the dimension and association handles.

Dimension-style formatting that is not native in the pinned schema is stored at
`dimensionStyle.overrides["kuubik.dimensionStyle.v1"]`. Its complete wave10 serialization shape is:

```json
{
  "linearUnit": "mm",
  "linearPrecision": 2,
  "angularPrecision": 1,
  "prefix": "",
  "suffix": " mm",
  "decimalSeparator": ".",
  "roundingIncrement": 0.5,
  "tolerance": { "mode": "symmetric", "value": 0.1, "precision": 2 },
  "arrowType": "closed-filled",
  "firstArrowType": "architectural-tick",
  "secondArrowType": "open",
  "extensionBeyond": 2,
  "textGap": 0.625,
  "textHorizontalPlacement": "centered",
  "textVerticalPlacement": "above",
  "textOffset": 1,
  "textRotationRad": 0,
  "zeroSuppression": { "leading": false, "trailing": true },
  "suppression": {
    "dimensionLine": false,
    "firstExtensionLine": false,
    "secondExtensionLine": false,
    "firstArrow": false,
    "secondArrow": false
  }
}
```

All fields are optional, but unknown names inside this known profile are rejected rather than
silently dropped. Tolerance modes are `none`, `symmetric`, `deviation` and `limits`; arrow types
are `closed-filled`, `open` and `architectural-tick`. Horizontal text placement is `manual`,
`centered`, `first-extension` or `second-extension`; vertical placement is `centered`, `above` or
`below`. Leading/trailing numeric zero suppression and dimension-line, extension-line and arrow
suppression are independent. The native style `scale` multiplies text height, arrow size,
extension offset, extension-beyond distance, text gap and explicit text offset, but does not scale the model-space
measurement itself.
`deriveDimensionPresentation` is the canonical deterministic derivation of formatted text,
dimension/extension lines, arrow tips/directions and angular arc geometry. Renderers and file
adapters must consume or reproduce this contract instead of recomputing a different convention.

`DIMSTYLE create` adds a style, `update` replaces the immutable style value under the same ID, and
`apply` replaces selected dimension values while preserving every dimension handle and only
changing `styleId`. Existing dimensions therefore follow a redefined style without insert-like
entity rewrites. All three modes are a single atomic session commit. Locked dimension layers fail
before mutation. `evaluateDimensionCapability` reports `locked-layer` and missing stable anchors as
`orphan-association`; fallback coordinates never convert an orphan to executable state.

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
  "version": 2,
  "width": 80,
  "attachment": "top-left",
  "lineSpacingFactor": 1.2,
  "wrapMode": "word",
  "paragraphs": [
    { "id": "TITLE", "alignment": "center" },
    { "id": "BODY", "alignment": "justify" }
  ]
}
```

Allowed attachments are the nine top/middle/bottom × left/center/right combinations. Width,
height and line spacing are positive finite drawing units/factors. `wrapMode` is `word`,
`character` or `none`. Paragraph order matches the newline-delimited native `CadText.text`; there
must be exactly one unique, stable paragraph ID per paragraph. Alignment is `left`, `center`,
`right` or `justify`. `deriveMTextLayout` is a deterministic Kuubik display layout based on width,
height and text-style width factor. It is not a native font-shaping or AutoCAD line-break oracle.

`MTEXT edit` replaces one immutable entity value under the same handle. It may change content,
position, height, width, rotation, style, attachment, spacing, wrap and paragraph settings in one
command/Undo step. When text gains or loses newline-delimited paragraphs without an explicit
paragraph contract, surviving paragraph IDs/alignment are retained by index and only new rows get
the first free deterministic `P1..Pn` ID. `styleId: null` explicitly removes the text-style
reference; omission preserves it. Import must reject mismatched counts, duplicate paragraph IDs,
unsupported alignment/wrap values, non-finite geometry and missing text-style references.
Known enum fields are runtime-validated at the planner boundary, so a JSON payload cannot bypass
TypeScript and persist an unknown attachment, wrap mode or leader arrow type. Character wrapping
splits Unicode by complete code points and never emits half of a UTF-16 surrogate pair.

Plain `LEADER` is a native `CadLeader` with two or more model-coordinate vertices and optional
text. Its extension stores the parts not present in the public schema:

```json
{
  "kind": "leader",
  "version": 1,
  "arrow": { "type": "open", "size": 3 },
  "landing": { "enabled": true, "length": 8 },
  "content": {
    "position": { "x": 28, "y": 10 },
    "textStyleId": "TXT-ISO",
    "textHeight": 2.5
  },
  "associative": true,
  "anchor": {
    "handle": "10",
    "feature": "end",
    "fallback": { "x": 100, "y": 40 }
  }
}
```

Allowed arrows are `closed-filled`, `open`, `dot` and `none`. Size and content height are positive
finite drawing units; landing length is non-negative. The first vertex is the arrow head. For an
associative leader it is resolved only from the stable `anchor.handle` plus feature; `fallback` is
recovery/audit data and never proximity-based retargeting.

`MLEADER` uses the same base kind so existing renderers can show its leader geometry, plus:

```json
{
  "kind": "mleader",
  "version": 2,
  "styleId": "MLEADER-STD",
  "textPosition": { "x": 22, "y": 10 },
  "textStyleId": "TXT-ISO",
  "textHeight": 2.5,
  "landingGap": 1,
  "arrow": { "type": "closed-filled", "size": 2.5 },
  "landing": { "enabled": true, "length": 6 },
  "associative": true,
  "anchor": {
    "handle": "10",
    "feature": "start",
    "fallback": { "x": 0, "y": 0 }
  }
}
```

LEADER/MLEADER edit preserves entity handle, layer, multileader `styleId`, text-style reference and
stable anchor unless that specific field is changed. `STYLE apply` may update TEXT, MTEXT, LEADER
and MLEADER together; all entity replacements and the style target/result handle lists are one
atomic command. Updating a `CadTextStyle` replaces only the resource with the same style ID, so
every existing reference remains valid without rewriting the annotations.

For edit payloads, omission means preserve. `textStyleId: null` removes only the referenced text
style, `anchor: null` deliberately changes the leader to `associative:false`, and plain
`LEADER.text: null` removes optional content. Those changes still replace one immutable entity
under the same handle. MLEADER content and its independent `styleId` remain required.

`updateAssociativeLeaders` runs against the staged post-geometry document and replaces only the
first vertex under the existing annotation handle. It is appended to the geometry command beside
dimension/hatch refreshes and committed once. A missing/incompatible anchor records a broken
association and produces no leader change; a locked annotation layer throws before commit.
`evaluateTextAnnotationCapability` reports missing annotation, locked layer, malformed extension,
orphan style or orphan association without fallback execution.

R2004/AC1018 predates native MLEADER. Session 4 must either select a format/version that supports
MLEADER, or fail closed for native MLEADER export. A LEADER+MTEXT surrogate may be offered only
as an explicitly lossy conversion and cannot prove F-060 round-trip parity.

#### DXF/PDF serialization boundary for F-057..F-060

DXF must emit referenced TEXTSTYLE table entries before TEXT/MTEXT/LEADER/MLEADER entities and
must preserve the canonical style ID on import. MTEXT requires model-space insertion, rotation,
height, reference width, attachment, line-spacing factor, newline paragraph order and supported
paragraph alignment. If the selected DXF version cannot encode stable paragraph IDs or exact
formatting, the adapter must retain the KDraw namespaced payload or report the export as lossy; it
must not claim exact F-057 round-trip from visible glyphs alone.

LEADER output must preserve ordered vertices, arrow type/size, landing state/length, optional
content placement and text-style reference. Native MLEADER additionally preserves its independent
`styleId`, text position/height, landing gap and requires AC1021 or newer. An associative output
must bind the exact source handle/feature. A proxy or visually similar exploded surrogate is
explicitly lossy for F-059/F-060 because it cannot prove handle-based update behavior.

PDF is a presentation output, not an editable annotation serialization format. The PDF adapter
must render the same deterministic MTEXT line order/alignment and leader geometry from model
coordinates, including rotation, arrow, landing and content placement. It may flatten these to
vector paths/text operators, but must never claim preservation of entity handles, paragraph IDs,
style-table identity, MLEADER style identity or associativity after PDF reopen. Searchable Unicode,
vector geometry, page placement and zero unintended raster fallback are the PDF read-back fields.

### HATCH

Native `CadHatch.pattern`, `associative` and `loops[]` remain authoritative. Loops contain
finite polygon vertices and `isHole`. The extension is:

```json
{
  "kind": "hatch",
  "islandDetection": "normal|outer|ignore",
  "pattern": {
    "type": "solid|line",
    "angleRad": 0.7853981633974483,
    "scale": 2,
    "origin": { "x": 5, "y": 5 }
  },
  "boundaryHandles": ["20", "21"]
}
```

`boundaryHandles` retain the canonical stable sources even when an island style filters a loop from
the rendered `loops[]`. `normal` uses even/odd nesting depth (`filled, hole, filled`); `outer` keeps
only depth 0 and direct depth-1 holes; `ignore` keeps only outer depth-0 loops and fills through all
internal objects. This matches AutoCAD's Normal/Outer/Ignore distinction documented in
[Hatch Creation](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-Core/files/GUID-CF9C88AB-CD49-44A4-8A85-C26F60B828DA.htm)
and [About Hatch Islands](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-Core/files/GUID-981679AC-7097-4724-A30D-33F1CAFDD81D.htm).

`HATCH create` and `edit` share the same core constructor. Editing pattern, angle, scale, origin,
island style, boundary set or associativity replaces one immutable entity under the same handle and
one Undo/Redo step. Omitted edit fields retain their values. Association updates replace loop
coordinates in the geometry command while retaining hatch handle, layer, appearance, pattern and
all non-HATCH extension payloads. Missing/open/degenerate boundaries report a broken association
and cause no partial command mutation. AutoCAD likewise makes bounded hatches associative by
default and updates them when boundary objects change; non-associative hatches remain unchanged
([About Hatch Patterns and Fills](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-F943F802-18F1-423C-B2B8-42C797CDF5E2.htm)).

Creation, edit and association propagation reject locked, off or frozen hatch and boundary layers
before mutation. `evaluateHatchCapability` reports `missing-hatch`, `locked-layer`, `off-layer`,
`frozen-layer` or `orphan-boundary`; it never substitutes a nearby boundary for a missing stable
handle. Handle matching and duplicate detection are case-insensitive while stored handles retain
their canonical spelling.

DXF group-code contract: group 2 is pattern name, 70 solid flag, 71 associativity, 75 island style
(`0=normal`, `1=outer`, `2=ignore`), 52 pattern angle, 41 pattern scale, 91 loop count and each path's
97-group source handles. These fields come from Autodesk's
[HATCH DXF reference](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/GUID-C6C71CED-CE0F-4184-82A5-07AD6241F15B.htm).
Read-back must compare handle, loop geometry/count, island style, source handles, pattern name/type,
angle, scale, origin and associativity, not only rendered fill pixels.

The current `cad-dxf` source adapter is intentionally unchanged in this worktree. Its tested exact
subset is non-associative SOLID with Outer-style straight closed loops: export→import→export is
byte-identical and preserves entity/boundary handles and outer/hole geometry. For line patterns it
currently writes fixed `71=0`, `75=1`, `52=0`, `41=1` and no group-97 source handles; import also
drops the Kuubik HATCH extension. Therefore non-default angle/scale/origin, Normal/Ignore style and
associativity are explicitly lossy and must be rejected by the capability gate until the adapter
owner implements and independently reopens them.

### TABLE

The pinned public schema has no native `CadTable`. Until session 4 adds a schema and adapter path,
TABLE is represented honestly as one `CadProxyEntity` with `originalType="TABLE"`, one stable
entity handle and a typed authoritative payload at `extensionData["kuubik.annotation.v1"]`:

```json
{
  "kind": "table",
  "version": 1,
  "origin": { "x": 10, "y": 50 },
  "rotationRad": 0,
  "styleId": "TABLE-STD",
  "rows": [{ "id": "R1", "height": 8 }],
  "columns": [{ "id": "C1", "width": 30 }],
  "cells": [{
    "id": "A1",
    "rowId": "R1",
    "columnId": "C1",
    "value": { "kind": "field", "code": "%<SheetNumber>%", "fallback": "1" },
    "horizontalAlignment": "center",
    "verticalAlignment": "middle",
    "format": { "textStyleId": "TXT-ISO", "textHeight": 2.5, "bold": true }
  }],
  "merges": []
}
```

Rows, columns, cells and merges have stable IDs. Exactly one cell exists for every row/column
coordinate. A merge references contiguous row and column IDs, covers at least two cells and cannot
overlap another merge. Covered cell values are preserved; unmerge therefore restores them without
data reconstruction. Deleting a merged row/column fails until the merge is explicitly removed.

Cell values are either literal text or inert fields. A field stores its code and explicit fallback
verbatim; `tableCellDisplayText` returns only the fallback and never evaluates or executes the
field code. Per-cell alignment/format overrides retain optional text-style references, text height,
bold/italic flags and `#RRGGBB` colour. Invalid, overlong or NUL-bearing text/field values fail
before commit.

Table styles are immutable ID-referenced resources stored in
`document.metadata.extensions["kuubik.tableStyles.v1"]`. Styles retain name, optional text-style
reference, text height, margin, border width and default horizontal/vertical alignment.
Create/update keeps the style ID stable; existing tables follow the updated resource without
entity rewrites.

`TABLE create`, batched `edit`, `style-create` and `style-update` all use the same planner preview
and commit path. One edit may set cells, merge/unmerge, insert/delete/resize rows or columns and
apply a style, but produces one immutable entity replacement and one Undo/Redo step. The table and
unaffected cell IDs remain unchanged. Locked table layers fail before mutation.

The core derives a `table` DXF capability requirement for every table and for the style registry.
This is a fail-closed contract only: the current workstream does not modify the DXF adapter and does
not claim that a native TABLE has been written or reopened.

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

`BLOCK` moves selected entity values into a new immutable definition and replaces them in model
space with one independent `blockRef`. The source entity handles may remain in the definition
because they no longer exist in model space. The insert needs its own globally unique handle.
Block IDs and names are case-insensitively unique, and member handles are globally unique across
model space and all definitions. A locked selected/member layer or any direct/transitive proxy
child rejects the whole command before mutation.

`INSERT` stores `blockId`, model-coordinate insertion, two finite non-zero scales, rotation in
radians, target layer and instance attributes. Definition and insert are separate values:
`BEDIT`/redefine replaces the immutable definition under the same block ID/name and never replaces
an insert merely to update block geometry. Every existing insert keeps its handle, insertion,
scale, rotation and layer. Without explicit attribute sync its values are also untouched; removing
a still-valued tag fails closed.

`EXPLODE.nestedMode` is explicit: `preserve` expands one level and retains transformed nested
inserts, while `recursive` expands the complete acyclic graph. Newly materialized model entities
receive deterministic collision-free handles because definition-member handles remain globally
present inside the definition. Nested insert transforms are composed in model coordinates. A
transform that the current 2D schema cannot represent (for example rotated nested content under
a shear-producing non-uniform transform), a missing definition, a locked source/member layer or a
proxy child fails before mutation. Visible attributes become ordinary TEXT entities; invisible
attributes do not. Delete plus all materialized entities are one `CadSession.commit` and one
Undo/Redo step.

`ATTRIB.mode = "edit"` edits one insert. `ATTRIB.mode = "sync"` is the deterministic ATTSYNC-like
operation for every insert that references the selected insert's `blockId`. Output keys follow
definition order and canonical tag spelling; matching non-constant values survive case-
insensitively, new tags take defaults, removed tags disappear, and constants always take their
definition default. Insert handles, transforms and layers are byte-for-byte preserved. Standalone
sync emits one atomic batch; `BEDIT.syncAttributes = true` performs definition replacement and the
same sync in one drawing-content change. Locked affected inserts reject the whole operation.

Before define, redefine, import or deserialize, construct the complete block-reference graph and
run `assertAcyclicBlocks`. Direct and indirect cycles are hard errors. Missing nested definitions
are hard errors. Never rely on renderer recursion guards as document validation.

DXF guidance: definitions map to BLOCK/ENDBLK records and references to INSERT. Attribute
definitions map to ATTDEF; values map to ATTRIB/SEQEND. Redefinition keeps the same definition
identity so all existing INSERT references resolve to the new content. Import must validate the
complete graph before exposing any partial document. Export must declare block-definition,
block-nesting, insert-transform and block-attributes capabilities as `exact` before writing. These
core contracts do not prove native DXF support: session 4 must serialize, reopen with an
independent parser and AutoCAD, then compare the required read-back fields and hashes.

## Fail-closed DXF capability gate

Before writing an annotation/block document, the DXF adapter must call
`assertAnnotationBlockDxfCapabilities(document, declaration)`. The declaration identifies the
adapter and selected DXF version and marks every semantic capability as `exact`, `lossy` or
`unsupported`. Missing declarations, `lossy`, `unsupported`, and a DXF version older than a
capability's minimum version are hard failures before any download or file mutation. Native
MLEADER requires at least AC1021; declaring it `exact` for AC1018 is rejected.

The gate derives requirements from the actual document, including style tables, stable
dimension/hatch/leader associations, hatch holes, block nesting, insert transforms and attributes.
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
- Preserve TABLE row/column order and all table, cell, merge and style IDs.
- Preserve block attribute definition order; instance object keys are emitted in definition order.
- Reject duplicate handles across model entities and all block members.
- Reject duplicate block/style IDs and case-insensitive names where the core planner does.
- Reject non-finite coordinates, zero insert scale, degenerate dimensions/hatch loops and block
  cycles before calling `CadSession.commit`.
- Import/export validation must operate on a clone. No partial document or partial file is valid.

## Required session 4 read-back matrix

### AutoCAD 2024.1.2 behavior matrix for F-061..F-066

This matrix is a test plan, not parity evidence. Every row remains unscored until the same visible
operation is run in AutoCAD and Kuubik and the generated file is independently reopened.

| F-row | Kuubik command/contract | AutoCAD comparison | Required exact read-back | Current evidence |
| --- | --- | --- | --- | --- |
| F-061 | `DIMLINEAR`, explicit horizontal/vertical axis | `DIMLINEAR` Horizontal/Vertical | handle, two measured origins, axis, dimension/text point, measurement, style ID | unit/golden/wiring only |
| F-062 | `DIMALIGNED` | `DIMALIGNED` | handle, measured origins, aligned rotation/length, placement, style ID | unit/golden/wiring only |
| F-063 | `DIMANGULAR`, three stable anchors | `DIMANGULAR` two-line/three-point flow | vertex, ray points, arc radius/sweep, formatted degrees, text placement | unit/golden/wiring only |
| F-064 | `DIMRADIUS` / `DIMDIAMETER`, center plus quadrant anchor | `DIMRADIUS` / `DIMDIAMETER` | same source handle, quadrant, center, radius/diameter value, arrows and text | unit/associative/wiring only |
| F-065 | staged handle-based association update; orphan refusal | grip/geometry edit of associated source | unchanged dimension handle/style, refreshed definition points, no proximity retarget, atomic Undo/Redo | unit/mutation/wiring only |
| F-066 | `DIMCONTINUE`, `DIMBASELINE`, `DIMSTYLE` profile | `DIMCONTINUE`, `DIMBASELINE`, `DIMSTYLE` | chain order/links, immutable baseline origin, precision, two arrows, placement, suppression, text-style ref | unit/golden/wiring only |

For each row record AutoCAD command line/options, before/after entity handles, Properties values,
Undo/Redo behavior, Kuubik preview-versus-commit equality, output hash, and independent reopen
results. Screenshots alone cannot prove handle identity, association or serialization.

### AutoCAD 2024.1.2 behavior matrix for F-057..F-060

This is also a test plan rather than parity evidence. Core, golden, property, mutation and browser-
ready adapter tests do not promote a row without the matching live applications and file read-back.

| F-row | Kuubik command/contract | AutoCAD comparison | Required exact read-back | Current evidence |
| --- | --- | --- | --- | --- |
| F-057 | `MTEXT` create/edit, width/wrap/attachment/paragraph IDs | `MTEXT` plus Properties/in-place edit | same handle; Unicode/newlines; insertion, height, width, rotation, attachment, spacing and alignment | core/golden/property/wiring only |
| F-058 | `STYLE` create/update/apply with stable ID | `STYLE`, current/object style assignment | style name/font/width/oblique values, referenced IDs and unchanged annotation handles | unit/mutation/wiring only |
| F-059 | `LEADER` create/edit and stable source anchor | `LEADER` with annotation/landing options | ordered vertices, arrow, landing, content/style reference, source handle and atomic Undo/Redo | unit/associative/wiring only |
| F-060 | AC1021+ native `MLEADER` create/edit | `MLEADER` and MLEADERSTYLE behavior | independent style ID, text position/style/height, landing gap, arrow, source handle and same entity handle | unit/associative/wiring only |

For each row capture the AutoCAD command/options, Properties values, before/after handles,
association response after source movement, Undo/Redo, Kuubik preview-versus-commit result, output
hash and independent DXF/PDF read-back. PDF evidence cannot substitute for editable DXF identity.

1. Linear/aligned/angular/radius/diameter/continued/baseline dimensions: type, definition points,
   style, chain mode and all association target handles. Compare derived text, tolerance,
   arrows, extension geometry, units, precision and annotation scale after reopen.
2. MTEXT and text styles: Unicode text, line breaks, stable paragraph IDs, paragraph alignment,
   wrap mode, width, attachment, spacing, rotation, font, width factor and oblique angle. Reopen,
   edit width/wrap/rotation, Undo/Redo and verify the same MTEXT handle.
3. LEADER and MLEADER: vertices, arrow type/size, landing enabled/length/gap, content placement,
   both style references, stable association handle/feature and native/lossy status. Move the
   target, reopen and verify only the arrow-head vertex changed under the same leader handle.
4. SOLID and ANSI31-like line HATCH: outer loop, hole, nested island, angle, scale, origin and
   boundary source handles; mutate a boundary and verify same hatch handle after update.
5. TABLE: origin/rotation, row/column sizes and order, cell IDs and literal/field values, fallback,
   merges, alignment, format, style reference, insert/delete/resize and atomic Undo/Redo.
6. BLOCK/INSERT: base point, member handles, insert handle, layer, rotation, positive/negative
   non-zero scales and nested acyclic block. Exercise both `preserve` and `recursive` EXPLODE and
   verify deterministic new handles plus exact composed model-space geometry.
7. Redefine: open/reload and verify two pre-existing inserts retain exact transforms/attributes but
   render the new definition.
8. Attributes: default, overridden, constant and invisible values; standalone sync and redefine+
   sync; canonical definition order; removed/new tags; edit, Undo, Redo and reload. Verify all
   existing insert handles/transforms/layers before and after sync.
9. Cycle, dangling definition/handle/style/leader anchor, duplicate case-insensitive block name,
   duplicate global handle, locked layer, proxy child and unsupported transform mutants must fail
   before download or document mutation.

The F-row remains below `1.00` until the same visible workflow is proven in AutoCAD 2024.1.2 and
Kuubik and the produced file is independently read back.

## Current file-output capability boundary

This workstream supplies serialization contracts and exact capability declarations/receipts. The
F-067 test writes and reopens the current bounded non-associative SOLID DXF subset in memory, but
does not change either adapter and does not prove the missing HATCH fields or AutoCAD behavior.
Session 4 must map MTEXT/LEADER/MLEADER, HATCH and dimension semantics at its adapter boundary, then
fail closed for any field it cannot round-trip. Documents carrying dimension chain/style semantics
derive explicit `dimension-chain` and `dimension-style-profile` requirements in addition to native
requirements. A passing core receipt, in-memory DXF/PDF regression or `gate:dxf` regression is
necessary integration evidence, but is not AutoCAD or physical generated-file evidence and cannot
promote F-057..F-068 to `1.00`.
