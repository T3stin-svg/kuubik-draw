#!/usr/bin/env python3
"""Read colour counts and rendered bboxes from Poppler F-114 pages."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image


def bbox(points: list[tuple[int, int]]) -> list[int] | None:
    if not points:
        return None
    return [
        min(point[0] for point in points),
        min(point[1] for point in points),
        max(point[0] for point in points),
        max(point[1] for point in points),
    ]


def summarize(label: str, path_text: str) -> dict[str, object]:
    path = Path(path_text).resolve(strict=True)
    data = path.read_bytes()
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        points: dict[str, list[tuple[int, int]]] = {"red": [], "redAlphaOnWhite": [], "blue": [], "black": [], "nonWhite": []}
        for index, (red, green, blue) in enumerate(rgb.get_flattened_data()):
            point = (index % rgb.width, index // rgb.width)
            if (red, green, blue) != (255, 255, 255):
                points["nonWhite"].append(point)
            if red > 180 and green < 100 and blue < 100:
                points["red"].append(point)
            if red > 245 and 80 <= green <= 125 and 80 <= blue <= 125:
                points["redAlphaOnWhite"].append(point)
            if blue > 150 and blue > red + 60 and blue > green + 40:
                points["blue"].append(point)
            if red < 50 and green < 50 and blue < 50:
                points["black"].append(point)
        return {
            "label": label,
            "width": rgb.width,
            "height": rgb.height,
            "mode": rgb.mode,
            "sha256": hashlib.sha256(data).hexdigest(),
            "counts": {key: len(value) for key, value in points.items()},
            "bboxes": {key: bbox(value) for key, value in points.items()},
            "extrema": rgb.getextrema(),
        }


def main(arguments: list[str]) -> None:
    images: dict[str, object] = {}
    for argument in arguments:
        label, separator, path = argument.partition("=")
        if not separator or not label or label in images:
            raise SystemExit(f"Invalid or duplicate labelled path: {argument}")
        images[label] = summarize(label, path)
    if not images:
        raise SystemExit("At least one image is required.")
    print(json.dumps({"schemaVersion": 1, "images": images}))


if __name__ == "__main__":
    main(sys.argv[1:])
