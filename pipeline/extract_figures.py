"""Extract figure crops for questions whose diagrams are required.

The source PDFs are not part of the app package, so this is a build-time step.
Crops are stored in web/public/figures and referenced by app data.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "pipeline" / "output"
PUBLIC = ROOT / "web" / "public" / "figures"
PDF_DIR = ROOT / "数学二"
FIGURE_TEXT = re.compile(r"如图|图示|图所示|图形如原卷|如图所示|图中")

# Figure panels verified against the source pages: [x0, y0, x1, y1] in PDF points.
# These exclude surrounding stem/option text while keeping axis labels.
MANUAL_CROPS = {
    "2005:16": (180, 586.5, 412, 746),
    "2005:17": (140, 118, 466, 334),
    "2007:3": (128, 373, 482, 477),
    "2008:2": (150, 258, 442, 480),
    "2008:6": (162, 129.5, 438, 352),
    "2010:18": (160, 558, 432, 704),
    "2015:4": (175, 428, 416, 524),
    "2016:4": (195, 516, 402, 661),
}


def question_key(question: dict) -> str:
    return f"{question['year']}:{str(question['seq_label']).rsplit('-', 1)[-1]}"


def question_number(question: dict) -> str:
    return str(question["seq_label"]).rsplit("-", 1)[-1]


def figure_rect(page: fitz.Page, question: dict) -> fitz.Rect | None:
    spans = question.get("source_spans") or []
    if not spans:
        return None
    top = min(span["bbox"][1] for span in spans) - 8
    bottom = max(span["bbox"][3] for span in spans) + 8
    rects = []
    backgrounds = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        if rect.y1 < top or rect.y0 > bottom:
            continue
        if rect.width < 15 and rect.height < 15:
            continue
        rects.append(rect)
        fill = drawing.get("fill")
        if fill and all(channel > 0.99 for channel in fill) and rect.width > 120 and rect.height > 80:
            backgrounds.append(rect)
    for image in page.get_image_info():
        rect = fitz.Rect(image["bbox"])
        if rect.y1 >= top and rect.y0 <= bottom:
            rects.append(rect)
    if not rects:
        return None
    # A white panel wraps the diagram and its labels while excluding surrounding
    # stem/option text, so prefer the largest one over the stroke bounding box.
    merged = max(backgrounds, key=lambda rect: rect.width * rect.height) if backgrounds else rects[0]
    if not backgrounds:
        for rect in rects[1:]:
            merged |= rect
    page_rect = page.rect
    padding = 0 if backgrounds else 12
    merged = fitz.Rect(
        max(page_rect.x0 + 20, merged.x0 - padding),
        max(page_rect.y0 + 20, merged.y0 - padding),
        min(page_rect.x1 - 20, merged.x1 + padding),
        min(page_rect.y1 - 20, merged.y1 + padding),
    )
    if merged.width < 40 or merged.height < 30:
        return None
    return merged


def main() -> None:
    rows = [json.loads(line) for line in (OUTPUT / "questions-all.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    candidates = [q for q in rows if q.get("has_figure_draft") or FIGURE_TEXT.search(q.get("stem_draft", ""))]
    PUBLIC.mkdir(parents=True, exist_ok=True)
    assets = {}
    failures = []
    docs = {}
    for question in candidates:
        year = question["year"]
        number = question_number(question)
        key = question_key(question)
        pdf_path = PDF_DIR / f"{year}年考研数学二真题（试卷）.pdf"
        if not pdf_path.exists():
            failures.append({"key": key, "reason": "pdf_missing"})
            continue
        doc = docs.get(year) or fitz.open(pdf_path)
        docs[year] = doc
        page_no = question["source_spans"][0]["page"]
        page = doc[page_no - 1]
        manual = MANUAL_CROPS.get(key)
        clip = fitz.Rect(*manual) if manual else figure_rect(page, question)
        if clip is None:
            failures.append({"key": key, "reason": "no_figure_region"})
            continue
        pix = page.get_pixmap(clip=clip, dpi=220, alpha=False)
        filename = f"figure-{year}-{number}.png"
        pix.save(PUBLIC / filename)
        assets[key] = {
            "id": f"figure-{year}-{number}",
            "url": f"/figures/{filename}",
            "width": pix.width,
            "height": pix.height,
            "alt": f"{year} 年第 {number} 题图形",
        }
        print(f"saved {key} {filename} {pix.width}x{pix.height}")
    (OUTPUT / "figure-assets.json").write_text(json.dumps(assets, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"candidates": len(candidates), "assets": len(assets), "failures": failures}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
