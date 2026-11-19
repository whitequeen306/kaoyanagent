"""Audit segmented questions before any answer alignment or model reconstruction."""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

REQUIRED_FIELDS = ["id", "year", "seq_label", "section", "qtype", "source", "status", "stem_draft", "source_spans", "content_hash"]


def audit_year(year: int, questions: list[dict], document: dict) -> dict:
    issues: list[str] = []
    expected = questions[0]["expected_count"] if questions else None
    if expected and len(questions) != expected:
        issues.append(f"question_count {len(questions)} != expected {expected}")
    for question in questions:
        missing = [field for field in REQUIRED_FIELDS if field not in question]
        if missing:
            issues.append(f"{question.get('seq_label')}: missing {missing}")
        if not question.get("stem_draft"):
            issues.append(f"{question.get('seq_label')}: empty stem")
        if not question.get("source_spans"):
            issues.append(f"{question.get('seq_label')}: no source spans")
        if len(question.get("source_pages", [])) > 1:
            pass  # Cross-page questions are expected and retained.
    hashes = collections.Counter(question["content_hash"] for question in questions)
    duplicates = [value for value, count in hashes.items() if count > 1]
    if duplicates:
        issues.append(f"duplicate content hashes: {len(duplicates)}")
    section_counts = collections.Counter(question["section"] for question in questions)
    if any(name not in section_counts for name in ("choice", "blank", "solution")):
        issues.append(f"missing section: {dict(section_counts)}")
    return {
        "year": year,
        "pages": document["page_count"],
        "questions": len(questions),
        "expected": expected,
        "sections": dict(section_counts),
        "cross_page_questions": sum(1 for question in questions if len(question.get("source_pages", [])) > 1),
        "questions_with_parts": sum(1 for question in questions if question.get("has_parts")),
        "figure_questions": sum(1 for question in questions if question.get("has_figure_draft")),
        "duplicate_hashes": len(duplicates),
        "issues": issues,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit a segmented year JSON.")
    parser.add_argument("segmented")
    parser.add_argument("--doc")
    parser.add_argument("--out")
    args = parser.parse_args()
    payload = json.loads(Path(args.segmented).read_text(encoding="utf-8"))
    document = json.loads(Path(args.doc).read_text(encoding="utf-8")) if args.doc else {"page_count": 0}
    report = audit_year(payload["year"], payload["questions"], document)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
