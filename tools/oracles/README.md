# Developer-only geometry oracles

These adapters never run in the Kuubik Draw web application and never certify an
AutoCAD parity row. They return `NOT_RUN` when the pinned executable is absent.

- `LIBRECAD_CMD` points to a LibreCAD 2.2.1.5 executable.
- `FREECAD_CMD` points to a separately approved FreeCADCmd 1.1.3 executable.
- `npm run test:oracles -- --require` fails unless both pinned fixtures pass in a
  runner whose network isolation is independently proven.

The gate verifies the exact version and executable SHA-256 before executing code.
Each fixture gets a fresh filesystem profile, an allowlisted environment, a
disposable working/input/output directory and a 30-second timeout. FreeCAD also
runs in safe mode with disposable user and system config files. LibreCAD converts
a LINE+CIRCLE DXF to a vector A4 PDF; the independent reader inflates PDF content
streams, reconstructs the painted line endpoints and circle centre/radius, then
checks their exact relative position and scale after one inferred uniform page
transform. Operator counts alone cannot pass the gate. FreeCADCmd executes an OCCT crossing-line
intersection and returns version, commit and geometry as JSON.

Dead proxy variables are only defense in depth: they do not prove Windows network
isolation, and LibreCAD may still consult Windows registry state. Consequently a
successful local geometry run is reported honestly as
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`.

The protected `cad-oracles` runner may report `PASS` only when
`KUUBIK_ORACLE_NETWORK_ATTESTATION_PATH` points to an operations-provisioned JSON
document and `KUUBIK_ORACLE_NETWORK_ATTESTATION_KEY` verifies its HMAC-SHA256.
The signed payload must name the exact GitHub `RUNNER_NAME`, use
`method: "os-egress-deny"`, expire within 24 hours and bind both pinned executable
SHA-256 values. Missing, expired, modified or differently bound attestations keep
`npm run test:oracles -- --require` red. The self-hosted job runs only on protected
main pushes or an approved manual dispatch, never on pull-request code. Temporary
files are removed after each process. These are secondary oracle results with
`certificationAuthority: false`; AutoCAD live evidence remains mandatory for every
parity score.
