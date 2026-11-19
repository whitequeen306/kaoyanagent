"""Build the full 2005–2026 draft bank: segment, align official answers, audit."""
from __future__ import annotations

import json
from pathlib import Path

from align_answers import attach_answers, audit_alignment, load_answer_keys
from audit import audit_year
from extract_pdf import extract_document
from segment import segment_document

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "pipeline" / "output"
ANSWERS = ROOT / "pipeline" / "reference" / "all-math2-answers-20261108.pdf"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    keys = load_answer_keys(ANSWERS)
    all_questions: list[dict] = []
    reports: list[dict] = []
    for year in range(2005, 2027):
        pdf = ROOT / "数学二" / f"{year}年考研数学二真题（试卷）.pdf"
        document = extract_document(pdf)
        questions = segment_document(document)
        reports.append(audit_year(year, questions, document))
        all_questions.extend(questions)
    attach_answers(all_questions, keys)
    (OUTPUT / "questions-all.jsonl").write_text(
        "\n".join(json.dumps(question, ensure_ascii=False) for question in all_questions) + "\n",
        encoding="utf-8")
    alignment = audit_alignment(all_questions)
    (OUTPUT / "audit-all.json").write_text(
        json.dumps({"segmentation": reports, "alignment": alignment}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(json.dumps({
        "years": len(reports),
        "questions": len(all_questions),
        "segmentation_issues": sum(len(report["issues"]) for report in reports),
        "alignment": alignment,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
