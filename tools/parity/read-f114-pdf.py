#!/usr/bin/env python3
"""Independently audit F-114 mixed-size vector PDFs."""

from __future__ import annotations

import hashlib
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


Matrix = tuple[float, float, float, float, float, float]
Point = tuple[float, float]


def multiply(left: Matrix, right: Matrix) -> Matrix:
    """Compose PDF matrices so left(right(point)) is returned."""
    a1, b1, c1, d1, e1, f1 = left
    a2, b2, c2, d2, e2, f2 = right
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def transform(matrix: Matrix, x_value: object, y_value: object) -> Point:
    x = float(x_value)  # type: ignore[arg-type]
    y = float(y_value)  # type: ignore[arg-type]
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def rounded_point(point: Point) -> list[float]:
    return [round(point[0], 6), round(point[1], 6)]


def resolve_object(value: object) -> object:
    getter = getattr(value, "get_object", None)
    return getter() if callable(getter) else value


def ext_gstate_values(resources: object) -> dict[str, dict[str, float | None]]:
    resolved_resources = resolve_object(resources)
    if not hasattr(resolved_resources, "get"):
        return {}
    raw_states = resolve_object(resolved_resources.get("/ExtGState", {}))  # type: ignore[union-attr]
    if not hasattr(raw_states, "items"):
        return {}
    result: dict[str, dict[str, float | None]] = {}
    for raw_name, raw_state in raw_states.items():  # type: ignore[union-attr]
        state = resolve_object(raw_state)
        result[str(raw_name)] = {
            "strokeAlpha": float(state.get("/CA")) if state.get("/CA") is not None else None,  # type: ignore[union-attr]
            "fillAlpha": float(state.get("/ca")) if state.get("/ca") is not None else None,  # type: ignore[union-attr]
        }
    return result


def read_vector_paths(page: object, reader: PdfReader, states: dict[str, dict[str, float | None]]) -> list[dict[str, object]]:
    contents = page.get_contents()  # type: ignore[union-attr]
    if contents is None:
        return []
    current: dict[str, object] = {
        "ctm": (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        "strokeColor": [],
        "fillColor": [],
        "gState": None,
    }
    stack: list[dict[str, object]] = []
    path_segments: list[dict[str, object]] = []
    path_points: list[Point] = []
    paths: list[dict[str, object]] = []

    def reset_path() -> None:
        path_segments.clear()
        path_points.clear()

    def add_segment(operator: str, raw_points: list[tuple[object, object]]) -> None:
        points = [transform(current["ctm"], x, y) for x, y in raw_points]  # type: ignore[arg-type]
        path_points.extend(points)
        path_segments.append({"operator": operator, "points": [rounded_point(point) for point in points]})

    def stroke(close_path: bool = False) -> None:
        if close_path:
            path_segments.append({"operator": "h", "points": []})
        if not path_segments or not path_points:
            reset_path()
            return
        xs = [point[0] for point in path_points]
        ys = [point[1] for point in path_points]
        media_box = [float(value) for value in page.mediabox]  # type: ignore[union-attr]
        bbox = [min(xs), min(ys), max(xs), max(ys)]
        state_name = current["gState"]
        alpha = states.get(str(state_name), {}) if state_name else {}
        paths.append({
            "strokeColor": current["strokeColor"],
            "fillColor": current["fillColor"],
            "gState": state_name,
            "strokeAlpha": alpha.get("strokeAlpha"),
            "fillAlpha": alpha.get("fillAlpha"),
            "segments": [dict(segment) for segment in path_segments],
            "bbox": [round(value, 6) for value in bbox],
            "insideMediaBox": bbox[0] >= media_box[0] and bbox[1] >= media_box[1] and bbox[2] <= media_box[2] and bbox[3] <= media_box[3],
        })
        reset_path()

    stream = ContentStream(contents, reader)
    for operands, raw_operator in stream.operations:
        operator = raw_operator.decode("ascii")
        if operator == "q":
            stack.append({key: value if not isinstance(value, list) else list(value) for key, value in current.items()})
        elif operator == "Q":
            current = stack.pop() if stack else current
        elif operator == "cm":
            incoming: Matrix = tuple(float(value) for value in operands)  # type: ignore[assignment]
            current["ctm"] = multiply(current["ctm"], incoming)  # type: ignore[arg-type]
        elif operator == "RG":
            current["strokeColor"] = [float(value) for value in operands]
        elif operator == "rg":
            current["fillColor"] = [float(value) for value in operands]
        elif operator == "G":
            current["strokeColor"] = [float(operands[0])]
        elif operator == "g":
            current["fillColor"] = [float(operands[0])]
        elif operator == "gs":
            current["gState"] = str(operands[0])
        elif operator == "m":
            add_segment("m", [(operands[0], operands[1])])
        elif operator == "l":
            add_segment("l", [(operands[0], operands[1])])
        elif operator == "c":
            add_segment("c", [(operands[0], operands[1]), (operands[2], operands[3]), (operands[4], operands[5])])
        elif operator == "v":
            add_segment("v", [(operands[0], operands[1]), (operands[2], operands[3])])
        elif operator == "y":
            add_segment("y", [(operands[0], operands[1]), (operands[2], operands[3])])
        elif operator == "re":
            x, y, width, height = (float(value) for value in operands)
            add_segment("m", [(x, y)])
            add_segment("l", [(x + width, y)])
            add_segment("l", [(x + width, y + height)])
            add_segment("l", [(x, y + height)])
            path_segments.append({"operator": "h", "points": []})
        elif operator == "h":
            path_segments.append({"operator": "h", "points": []})
        elif operator in {"S", "B", "B*"}:
            stroke()
        elif operator in {"s", "b", "b*"}:
            stroke(close_path=True)
        elif operator in {"n", "f", "f*", "F"}:
            reset_path()
    return paths


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
            if page.get_contents() is not None:
                stream = ContentStream(page.get_contents(), reader)
                for operands, raw_operator in stream.operations:
                    operator = raw_operator.decode("ascii")
                    operators[operator] = operators.get(operator, 0) + 1
                    if operator == "RG":
                        stroke_colors.append([scalar(value) for value in operands])
            resources = resolve_object(page.get("/Resources", {}))
            xobjects = resolve_object(resources.get("/XObject", {})) if resources else {}
            ext_gstates = ext_gstate_values(resources)
            image_xobjects = sum(1 for value in xobjects.values() if value.get_object().get("/Subtype") == "/Image")
            plumber_page = plumber_document.pages[index]
            text = plumber_page.extract_text() or ""
            pages.append({
                "index": index + 1,
                "mediaBox": [float(value) for value in page.mediabox],
                "rotation": int(page.get("/Rotate", 0)),
                "text": text,
                "words": [word["text"] for word in plumber_page.extract_words()],
                "operators": operators,
                "strokeColors": stroke_colors,
                "imageXObjects": image_xobjects,
                "extGStates": len(ext_gstates),
                "extGStateValues": ext_gstates,
                "strokedPaths": read_vector_paths(page, reader, ext_gstates),
                "plumberImages": len(plumber_page.images),
                "plumberLines": len(plumber_page.lines),
                "plumberCurves": len(plumber_page.curves),
                "plumberChars": len(plumber_page.chars),
            })
    data = path.read_bytes()
    return {
        "label": label,
        "path": path.name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "pdfHeader": data[:8].decode("latin1"),
        "pages": len(reader.pages),
        "strictParsed": strict_error is None,
        "strictError": strict_error,
        "pageDetails": pages,
    }


def main(arguments: list[str]) -> None:
    if not arguments:
        raise SystemExit("Usage: read-f114-pdf.py label=path [label=path ...]")
    results: dict[str, object] = {}
    for argument in arguments:
        label, separator, raw_path = argument.partition("=")
        if not separator or not label or not raw_path or label in results:
            raise SystemExit(f"Invalid or duplicate labelled path: {argument}")
        results[label] = read_pdf(label, Path(raw_path).resolve(strict=True))
    print(json.dumps({"readers": {"pypdf": version("pypdf"), "pdfplumber": version("pdfplumber")}, "documents": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
