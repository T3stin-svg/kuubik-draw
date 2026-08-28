#!/usr/bin/env python3
"""Independently read F-104 vector-layout PDFs with pypdf and pdfplumber."""

from __future__ import annotations

import json
import sys
from importlib.metadata import version
from pathlib import Path

import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream


def scalar(value: object) -> float | str:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)


def read_pdf(label: str, path: Path) -> dict[str, object]:
    strict_error: str | None = None
    try:
        reader = PdfReader(str(path), strict=True)
        _ = len(reader.pages)
    except Exception as error:  # AutoCAD 2024 emits duplicate catalog keys.
        strict_error = f"{type(error).__name__}: {error}"
        reader = PdfReader(str(path), strict=False)
    if len(reader.pages) != 1:
        raise ValueError(f"{path.name}: expected one page, got {len(reader.pages)}")
    page = reader.pages[0]
    operators: dict[str, int] = {}
    matrices: list[list[float | str]] = []
    clip_paths: list[str] = []
    if page.get_contents() is not None:
        stream = ContentStream(page.get_contents(), reader)
        recent_path: list[str] = []
        for operands, raw_operator in stream.operations:
            operator = raw_operator.decode("ascii")
            operators[operator] = operators.get(operator, 0) + 1
            if operator == "cm":
                matrices.append([scalar(value) for value in operands])
            if operator in {"m", "l", "re", "h"}:
                recent_path.append(f"{operator}:{','.join(str(scalar(value)) for value in operands)}")
            elif operator == "W":
                clip_paths.append("|".join(recent_path))
                recent_path = []
            elif operator not in {"n"}:
                recent_path = []
    resources = page.get("/Resources", {})
    xobjects = resources.get("/XObject", {}) if resources else {}
    image_xobjects = sum(1 for value in xobjects.values() if value.get_object().get("/Subtype") == "/Image")
    with pdfplumber.open(path) as document:
        plumber_page = document.pages[0]
        words = [word["text"] for word in plumber_page.extract_words()]
        plumber = {
            "pages": len(document.pages), "width": plumber_page.width, "height": plumber_page.height,
            "lines": len(plumber_page.lines), "rects": len(plumber_page.rects), "curves": len(plumber_page.curves),
            "images": len(plumber_page.images), "words": words,
        }
    return {
        "label": label, "path": path.name,
        "pypdf": {
            "pages": len(reader.pages), "mediaBox": [float(value) for value in page.mediabox],
            "xobjects": len(xobjects), "imageXObjects": image_xobjects, "images": len(page.images),
            "operators": operators, "matrices": matrices, "clipPaths": clip_paths,
            "strictParsed": strict_error is None, "strictError": strict_error,
        },
        "pdfplumber": plumber,
    }


def main(arguments: list[str]) -> None:
    if not arguments:
        raise SystemExit("Usage: read-f104-pdf.py label=path [label=path ...]")
    results: dict[str, object] = {}
    for argument in arguments:
        label, separator, raw_path = argument.partition("=")
        if not separator or not label or not raw_path:
            raise SystemExit(f"Invalid labelled path: {argument}")
        results[label] = read_pdf(label, Path(raw_path).resolve(strict=True))
    print(json.dumps({"readers": {"pypdf": version("pypdf"), "pdfplumber": version("pdfplumber")}, "documents": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
