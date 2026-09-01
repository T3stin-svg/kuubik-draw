"""Independent pypdf/pdfplumber/Poppler read-back for the F-115 fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("evidence/workstreams/documents-io/f115/readback.json"))
    parser.add_argument("--render-dir", type=Path, default=Path("tmp/f115/rendered"))
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    output = args.output.resolve()
    render_dir = args.render_dir.resolve()
    render_dir.mkdir(parents=True, exist_ok=True)
    prefix = render_dir / "f115-page"
    subprocess.run([args.pdftoppm, "-png", "-r", "120", str(pdf_path), str(prefix)], check=True)
    rendered = sorted(render_dir.glob("f115-page-*.png"))

    reader = PdfReader(str(pdf_path))
    with pdfplumber.open(str(pdf_path)) as document:
        plumber_pages = [{
            "pageNumber": index + 1,
            "widthPt": round(page.width, 6),
            "heightPt": round(page.height, 6),
            "text": (page.extract_text() or "").splitlines()[:3],
            "imageCount": len(page.images),
        } for index, page in enumerate(document.pages)]

    result = {
        "schemaVersion": 1,
        "rowId": "F-115",
        "input": {"fileName": pdf_path.name, "byteLength": pdf_path.stat().st_size, "sha256": sha256(pdf_path)},
        "pypdf": {
            "pageCount": len(reader.pages),
            "encrypted": reader.is_encrypted,
            "pages": [{
                "pageNumber": index + 1,
                "widthPt": round(float(page.mediabox.width), 6),
                "heightPt": round(float(page.mediabox.height), 6),
                "rotationDeg": page.rotation,
            } for index, page in enumerate(reader.pages)],
        },
        "pdfplumber": {"pageCount": len(plumber_pages), "pages": plumber_pages},
        "poppler": {
            "pageCount": len(rendered),
            "pages": [{"fileName": path.name, "byteLength": path.stat().st_size, "sha256": sha256(path)} for path in rendered],
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
