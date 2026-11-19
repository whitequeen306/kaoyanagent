"""Extract positioned text lines from a born-digital exam PDF.

The source PDFs already carry a text layer. We deliberately keep coordinates and
fonts instead of flattening text, so later steps can rebuild fractions, matrices
and integral limits. This module never guesses LaTeX.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz

SECTION_TITLES = {"选择题", "填空题", "解答题"}
FOOTER_PATTERNS = [
    re.compile(r"^真题试卷$"),
    re.compile(r"^GitHub"),
    re.compile(r"^\d{1,3}$"),
]


def _is_noise(text: str, y0: float, y1: float, page_height: float) -> bool:
    if y0 < 55 or y1 > page_height - 45:
        return True
    return any(pattern.match(text) for pattern in FOOTER_PATTERNS)


def extract_document(pdf_path: str | Path) -> dict:
    path = Path(pdf_path)
    doc = fitz.open(path)
    lines: list[dict] = []
    for page_index, page in enumerate(doc):
        page_height = page.rect.height
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                text = "".join(span.get("text", "") for span in spans).strip()
                if not text:
                    continue
                bbox = tuple(round(value, 2) for value in line["bbox"])
                if _is_noise(text, bbox[1], bbox[3], page_height):
                    continue
                lines.append({
                    "page": page_index + 1,
                    "bbox": list(bbox),
                    "text": text,
                    "fonts": sorted({span.get("font", "") for span in spans if span.get("font")}),
                    "size": round(max((span.get("size", 0) for span in spans), default=0), 2),
                })
    # Drop the cover/instructions before the first section heading.
    start = next((i for i, line in enumerate(lines) if line["text"] in SECTION_TITLES), None)
    if start is None:
        raise ValueError(f"no section heading found in {path.name}")
    body = lines[start:]
    return {
        "source_file": path.name,
        "year": int(path.name[:4]),
        "page_count": doc.page_count,
        "width": round(doc[0].rect.width, 2),
        "height": round(doc[0].rect.height, 2),
        "lines": body,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract positioned lines from one exam PDF.")
    parser.add_argument("pdf")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    document = extract_document(args.pdf)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{document['year']}: {len(document['lines'])} lines -> {args.out}")


if __name__ == "__main__":
    main()
