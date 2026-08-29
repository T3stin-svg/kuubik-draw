# ADR 0002: DOM-free Canvas2D renderer behind a backend boundary

- Status: accepted
- Date: 2026-08-29

## Decision

The first renderer is Canvas2D with world-coordinate selection, R-tree culling,
high-DPI output and separate committed/preview geometry. Snap and command
validity never depend on painted pixels. Preview and commit call the same CAD
kernel predicate.

If the measured 50,000-entity gate cannot sustain 30 FPS pan/zoom and sub-100 ms
selection on the reference computer, a WebGL2 backend may implement the same
renderer contract. It does not change the document or command model.

## Consequences

Rendering remains replaceable and cannot become a second geometry authority.
Visual performance work can proceed without changing file semantics.
