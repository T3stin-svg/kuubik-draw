#!/usr/bin/env python3
"""Independently read F-105 batch-publish PDFs with pypdf and pdfplumber."""

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
    except Exception as error:
        strict_error = f"{type(error).__name__}: {error}"
        reader = PdfReader(str(path), strict=False)
    pages: list[dict[str, object]] = []
    with pdfplumber.open(path) as plumber_document:
        for index, page in enumerate(reader.pages):
            operators: dict[str, int] = {}
            stroke_colors: list[list[float | str]] = []
            pending_rectangle: list[float] | None = None
            first_clip_rectangle: list[float] | None = None
            layout_placement: dict[str, object] | None = None
            if page.get_contents() is not None:
                stream = ContentStream(page.get_contents(), reader)
                for operands, raw_operator in stream.operations:
                    operator = raw_operator.decode("ascii")
                    operators[operator] = operators.get(operator, 0) + 1
                    if operator == "RG":
                        stroke_colors.append([scalar(value) for value in operands])
                    elif operator == "re" and len(operands) == 4:
                        pending_rectangle = [float(value) for value in operands]
                    elif operator in {"W", "W*"} and pending_rectangle is not None and first_clip_rectangle is None:
                        first_clip_rectangle = pending_rectangle
                    elif operator == "cm" and len(operands) == 6 and first_clip_rectangle is not None and layout_placement is None:
                        matrix = [float(value) for value in operands]
                        if abs(matrix[1]) < 1e-12 and abs(matrix[2]) < 1e-12 and matrix[0] > 0 and matrix[3] > 0:
                            millimetres_to_points = 72.0 / 25.4
                            destination = {
                                "x": first_clip_rectangle[0] / millimetres_to_points,
                                "y": first_clip_rectangle[1] / millimetres_to_points,
                                "width": first_clip_rectangle[2] / millimetres_to_points,
                                "height": first_clip_rectangle[3] / millimetres_to_points,
                            }
                            scale_factor = matrix[0] / millimetres_to_points
                            layout_placement = {
                                "destination": destination,
                                "scaleFactor": scale_factor,
                                "source": {
                                    "x": (destination["x"] - matrix[4] / millimetres_to_points) / scale_factor,
                                    "y": (destination["y"] - matrix[5] / millimetres_to_points) / scale_factor,
                                    "width": destination["width"] / scale_factor,
                                    "height": destination["height"] / scale_factor,
                                },
                                "clipPoints": first_clip_rectangle,
                                "matrix": matrix,
                            }
            resources = page.get("/Resources", {})
            xobjects = resources.get("/XObject", {}) if resources else {}
            image_xobjects = sum(1 for value in xobjects.values() if value.get_object().get("/Subtype") == "/Image")
            plumber_page = plumber_document.pages[index]
            text = plumber_page.extract_text() or ""
            pages.append({
                "index": index + 1,
                "mediaBox": [float(value) for value in page.mediabox],
                "text": text,
                "words": [word["text"] for word in plumber_page.extract_words()],
                "operators": operators,
                "strokeColors": stroke_colors,
                "layoutPlacement": layout_placement,
                "imageXObjects": image_xobjects,
                "plumberImages": len(plumber_page.images),
                "plumberLines": len(plumber_page.lines),
                "plumberCurves": len(plumber_page.curves),
            })
    return {
        "label": label,
        "path": path.name,
        "pages": len(reader.pages),
        "strictParsed": strict_error is None,
        "strictError": strict_error,
        "pageDetails": pages,
    }


def main(arguments: list[str]) -> None:
    if not arguments:
        raise SystemExit("Usage: read-f105-pdf.py label=path [label=path ...]")
    results: dict[str, object] = {}
    for argument in arguments:
        label, separator, raw_path = argument.partition("=")
        if not separator or not label or not raw_path or label in results:
            raise SystemExit(f"Invalid or duplicate labelled path: {argument}")
        results[label] = read_pdf(label, Path(raw_path).resolve(strict=True))
    print(json.dumps({"readers": {"pypdf": version("pypdf"), "pdfplumber": version("pdfplumber")}, "documents": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
