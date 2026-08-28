#!/usr/bin/env python3
"""Independently read F-103 PDFs with pypdf and pdfplumber."""

from __future__ import annotations

import json
import sys
from importlib.metadata import version
from pathlib import Path

import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream


def read_pdf(label: str, path: Path) -> dict[str, object]:
    reader = PdfReader(str(path), strict=True)
    page = reader.pages[0]
    operators: dict[str, int] = {}
    if page.get_contents() is not None:
        stream = ContentStream(page.get_contents(), reader)
        for _operands, raw_operator in stream.operations:
            operator = raw_operator.decode("ascii")
            operators[operator] = operators.get(operator, 0) + 1

    resources = page.get("/Resources", {})
    xobjects = resources.get("/XObject", {}) if resources else {}
    with pdfplumber.open(path) as document:
        plumber_page = document.pages[0]
        plumber = {
            "pages": len(document.pages),
            "width": plumber_page.width,
            "height": plumber_page.height,
            "lines": len(plumber_page.lines),
            "rects": len(plumber_page.rects),
            "curves": len(plumber_page.curves),
            "images": len(plumber_page.images),
        }

    return {
        "label": label,
        "path": path.name,
        "pypdf": {
            "pages": len(reader.pages),
            "mediaBox": [float(value) for value in page.mediabox],
            "xobjects": len(xobjects),
            "images": len(page.images),
            "operators": operators,
        },
        "pdfplumber": plumber,
    }


def main(arguments: list[str]) -> None:
    if not arguments:
        raise SystemExit("Usage: read-f103-pdf.py label=path [label=path ...]")
    results: dict[str, object] = {}
    for argument in arguments:
        label, separator, raw_path = argument.partition("=")
        if not separator or not label or not raw_path:
            raise SystemExit(f"Invalid labelled path: {argument}")
        results[label] = read_pdf(label, Path(raw_path).resolve())
    print(json.dumps({"readers": {"pypdf": version("pypdf"), "pdfplumber": version("pdfplumber")}, "documents": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
