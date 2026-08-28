#!/usr/bin/env python3
"""Independently read F-106 Model-space PDFs with pypdf and pdfplumber."""

from __future__ import annotations

import json
import math
import sys
from importlib.metadata import version
from pathlib import Path

import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream


def read_pdf(label: str, path: Path) -> dict[str, object]:
    strict_error: str | None = None
    try:
        reader = PdfReader(str(path), strict=True)
        _ = len(reader.pages)
    except Exception as error:
        strict_error = f"{type(error).__name__}: {error}"
        reader = PdfReader(str(path), strict=False)
    if len(reader.pages) != 1:
        raise ValueError(f"{path.name}: expected one page, got {len(reader.pages)}")
    page = reader.pages[0]
    operators: dict[str, int] = {}
    first_clip: list[float] | None = None
    pending_rectangle: list[float] | None = None
    placement: dict[str, object] | None = None
    if page.get_contents() is not None:
        stream = ContentStream(page.get_contents(), reader)
        for operands, raw_operator in stream.operations:
            operator = raw_operator.decode("ascii")
            operators[operator] = operators.get(operator, 0) + 1
            if operator == "re" and len(operands) == 4:
                pending_rectangle = [float(value) for value in operands]
            elif operator in {"W", "W*"} and pending_rectangle is not None and first_clip is None:
                first_clip = pending_rectangle
            elif operator == "cm" and len(operands) == 6 and first_clip is not None and placement is None:
                matrix = [float(value) for value in operands]
                if abs(matrix[1]) < 1e-12 and abs(matrix[2]) < 1e-12 and matrix[0] > 0 and matrix[3] > 0:
                    mm_to_pt = 72.0 / 25.4
                    destination = {
                        "x": first_clip[0] / mm_to_pt,
                        "y": first_clip[1] / mm_to_pt,
                        "width": first_clip[2] / mm_to_pt,
                        "height": first_clip[3] / mm_to_pt,
                    }
                    scale = matrix[0] / mm_to_pt
                    placement = {
                        "destination": destination,
                        "scaleFactor": scale,
                        "source": {
                            "x": (destination["x"] - matrix[4] / mm_to_pt) / scale,
                            "y": (destination["y"] - matrix[5] / mm_to_pt) / scale,
                            "width": destination["width"] / scale,
                            "height": destination["height"] / scale,
                        },
                        "clipPoints": first_clip,
                        "matrix": matrix,
                    }
    resources = page.get("/Resources", {})
    xobjects = resources.get("/XObject", {}) if resources else {}
    image_xobjects = sum(1 for value in xobjects.values() if value.get_object().get("/Subtype") == "/Image")
    with pdfplumber.open(path) as document:
        plumber_page = document.pages[0]
        mm_to_pt = 72.0 / 25.4
        line_segments = []
        for line in plumber_page.lines:
            start = {"x": float(line["x0"]) / mm_to_pt, "y": float(line["y0"]) / mm_to_pt}
            end = {"x": float(line["x1"]) / mm_to_pt, "y": float(line["y1"]) / mm_to_pt}
            delta = {"x": end["x"] - start["x"], "y": end["y"] - start["y"]}
            line_segments.append({
                "startMm": start,
                "endMm": end,
                "deltaMm": delta,
                "lengthMm": math.hypot(delta["x"], delta["y"]),
                "midpointMm": {"x": (start["x"] + end["x"]) / 2, "y": (start["y"] + end["y"]) / 2},
            })
        line_segments.sort(key=lambda item: float(item["lengthMm"]), reverse=True)
        curve_bounds = [{
            "x": float(curve["x0"]) / mm_to_pt,
            "y": float(curve["y0"]) / mm_to_pt,
            "width": float(curve["width"]) / mm_to_pt,
            "height": float(curve["height"]) / mm_to_pt,
        } for curve in plumber_page.curves]
        curve_bounds.sort(key=lambda item: float(item["width"]) * float(item["height"]), reverse=True)
        return {
            "label": label,
            "path": path.name,
            "pages": len(reader.pages),
            "strictParsed": strict_error is None,
            "strictError": strict_error,
            "mediaBox": [float(value) for value in page.mediabox],
            "rotation": int(page.rotation or 0),
            "text": plumber_page.extract_text() or "",
            "words": [word["text"] for word in plumber_page.extract_words()],
            "operators": operators,
            "placement": placement,
            "effectiveMediaMm": {"width": float(plumber_page.width) / mm_to_pt, "height": float(plumber_page.height) / mm_to_pt},
            "primaryLineMm": line_segments[0] if line_segments else None,
            "lineSegmentsMm": line_segments,
            "primaryCurveBoundsMm": curve_bounds[0] if curve_bounds else None,
            "curveBoundsMm": curve_bounds,
            "imageXObjects": image_xobjects,
            "plumberImages": len(plumber_page.images),
            "plumberLines": len(plumber_page.lines),
            "plumberCurves": len(plumber_page.curves),
        }


def main(arguments: list[str]) -> None:
    if not arguments:
        raise SystemExit("Usage: read-f106-pdf.py label=path [label=path ...]")
    results: dict[str, object] = {}
    for argument in arguments:
        label, separator, raw_path = argument.partition("=")
        if not separator or not label or not raw_path or label in results:
            raise SystemExit(f"Invalid or duplicate labelled path: {argument}")
        results[label] = read_pdf(label, Path(raw_path).resolve(strict=True))
    print(json.dumps({"readers": {"pypdf": version("pypdf"), "pdfplumber": version("pdfplumber")}, "documents": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
