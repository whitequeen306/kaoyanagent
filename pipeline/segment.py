"""Segment positioned lines into questions without splitting shared stems."""
from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

from extract_pdf import SECTION_TITLES, extract_document

QUESTION_RE = re.compile(r"^(\d{1,2})\.\s*(.*)$")
SUBITEM_RE = re.compile(r"^[（(](\d{1,2})[）)]\s*(.*)$")
EXPECTED_COUNTS = {
    **{year: 23 for year in range(2005, 2027)},
    2007: 24,
    **{year: 22 for year in range(2021, 2027)},
}
SECTION_TO_QTYPE = {"选择题": "single_choice", "填空题": "fill_blank", "解答题": "free_response"}


def _question_uuid(year: int, section: str, number: int, index: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"kaoyan:math2:{year}:{section}:{number}:{index}"))


def segment_document(document: dict) -> list[dict]:
    year = document["year"]
    questions: list[dict] = []
    section: str | None = None
    current: dict | None = None
    expected_number = 1

    def flush() -> None:
        nonlocal current
        if not current:
            return
        current["stem_draft"] = "\n".join(current.pop("_body")).strip()
        if not current["stem_draft"]:
            current["needs_review_reason"] = "empty_stem"
        questions.append(current)
        current = None

    for line in document["lines"]:
        text = re.sub(r"\s+", " ", line["text"]).strip()
        if text in SECTION_TITLES:
            flush()
            section = text
            continue
        if section is None:
            continue
        match = QUESTION_RE.match(text)
        if match and len(match.group(1)) <= 2 and int(match.group(1)) == expected_number:
            number = int(match.group(1))
            expected_number += 1
            flush()
            current = {
                "id": _question_uuid(year, section, number, len(questions) + 1),
                "year": year,
                "seq_label": f"{section[:2]}-{number}",
                "section": {"选择题": "choice", "填空题": "blank", "解答题": "solution"}[section],
                "qtype": SECTION_TO_QTYPE[section],
                "source": "real",
                "status": "draft",
                "needs_model_latex": True,
                "needs_review": False,
                "_body": [match.group(2)] if match.group(2).strip() else [],
                "source_spans": [line],
                "parts_draft": [],
            }
            continue
        if current is None:
            continue
        current["_body"].append(text)
        current["source_spans"].append(line)
        sub = SUBITEM_RE.match(text)
        if sub:
            current["parts_draft"].append({"label": f"({sub.group(1)})", "prompt_draft": sub.group(2)})
    flush()

    for question in questions:
        question["has_parts"] = bool(question["parts_draft"])
        question["has_figure_draft"] = "如图" in question["stem_draft"] or "图所示" in question["stem_draft"]
        question["content_hash"] = hashlib.sha256(
            f"{year}:{question['seq_label']}:{question['stem_draft']}".encode("utf-8")
        ).hexdigest()
        question["source_pages"] = sorted({span["page"] for span in question["source_spans"]})
        question["expected_count"] = EXPECTED_COUNTS.get(year)
    return questions


def segment_pdf(pdf_path: str | Path) -> tuple[dict, list[dict]]:
    document = extract_document(pdf_path)
    return document, segment_document(document)


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Segment one exam PDF into draft questions.")
    parser.add_argument("pdf")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    document, questions = segment_pdf(args.pdf)
    output = {"year": document["year"], "questions": questions}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{document['year']}: {len(questions)} questions -> {args.out}")
