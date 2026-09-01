# F-115 PDF underlay candidate wave

Status: candidate implementation; no parity score change. The work13 closure evidence is in `evidence/workstreams/documents-io/f115/`.

- PDF bytes are preserved unchanged, SHA-256 bound and stored append-only in IndexedDB.
- Import fails closed for encryption, active content, missing EOF, unsupported inherited/compressed page boxes and files over 128 MiB.
- Page number, physical dimensions, position, rotation, opacity and visibility use a versioned document extension linked to a schema attachment.
- A pointer-disabled, clipped image view backed by the safe uncompressed-PDF SVG adapter is provided as the integration surface; App.tsx is intentionally untouched.

The simple built-in inspector and SVG renderer cover traditional uncompressed page dictionaries/content streams. A future PDF.js adapter is required for compressed object streams and inherited page boxes. AutoCAD 2024, visible production Chromium and pypdf/pdfplumber/Poppler now share current-byte evidence, but certification still requires the production App route and the general PDF.js renderer.

## Independent file read-back

Input: `evidence/artifacts/F-114-independent-vector.pdf`, SHA-256 `4fb1ce37bf217841a7f7a0b88f82084a92339074d00cc6961a37d3781123f4c1`.

- pypdf: 2 pages, unencrypted, MediaBox 1190.551181 x 841.889764 pt and 595.275591 x 841.889764 pt.
- pdfplumber: the same 2 page sizes, 0 image objects on both pages and searchable text on both pages.
- Poppler 120 dpi: page PNG SHA-256 values `9094bd72b4e017b93321d4bd8647b3e57fafdf7de646599cc1930f2ae2c2921d` and `9611688a302f0760d8830b4041794a36dab4f8523360b2e6a46762239ef2602a`.
- Visual review: both complete page frames and vector geometry render; the source A4 fixture's oversized blue heading reaches the right page edge and is preserved rather than silently altered by import.
