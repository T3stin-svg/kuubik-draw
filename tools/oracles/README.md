# Developer-only geometry oracles

These adapters never run in the Kuubik Draw web application and never certify an
AutoCAD parity row. They return `NOT_RUN` when the pinned executable is absent.

- `LIBRECAD_CMD` points to a LibreCAD 2.2.1.5 executable.
- `FREECAD_CMD` points to a separately approved FreeCADCmd 1.1.3 executable.
- `npm run test:oracles -- --require` fails if either oracle is unavailable.

The current foundation probes executable path, version output and SHA-256 only;
that state is `AVAILABLE_UNVERIFIED`, never PASS. Geometry execution, a disposable
directory, network isolation and output read-back are still required before
`--require` can pass. Only synthetic or anonymised fixtures may be used there.
