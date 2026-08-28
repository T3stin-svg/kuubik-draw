# F-017 COPY certification scope

F-017 covers `COPY` in the fixed AutoCAD 2024.1.2 Windows 2D Drafting &
Annotation audit: pre- and postselection, one or repeated destinations, absolute
and `@dx,dy` input, coincident placement, preview, locked-layer handling,
property preservation, deterministic new handles and one-step undo.

Every repeated placement is derived from the same original pickset and base
point. A later destination is never chained from a prior copy. The standard
matrix contains all twelve non-proxy `KDrawDocumentV1` entity families and uses
the same `+500,+750` and `-300,+100` vectors in AutoCAD and Kuubik.
Its block definition reserves numeric handle `1E`, proving that COPY allocates
new model-space handles from the document-wide namespace rather than colliding
with block-space entities.

Opaque `proxy` entities are rejected as `unsupported-entity` and retained
byte-for-byte. Kuubik does not invent a transform contract for unknown native
objects. Native proxy editing remains part of the later licensed ODA/RealDWG
compatibility phase and does not alter the fixed 133-row denominator.
