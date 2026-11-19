"""Run extraction → segmentation → audit for the four representative samples."""
from __future__ import annotations

import json
from pathlib import Path

from audit import audit_year
from extract_pdf import extract_document
from segment import segment_document

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_YEARS = [2005, 2009, 2021, 2026]
OUTPUT = ROOT / "pipeline" / "output"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    all_questions = []
    reports = []
    for year in SAMPLE_YEARS:
        pdf = ROOT / "数学二" / f"{year}年考研数学二真题（试卷）.pdf"
        document = extract_document(pdf)
        questions = segment_document(document)
        all_questions.extend(questions)
        reports.append(audit_year(year, questions, document))
        (OUTPUT / f"year-{year}-lines.json").write_text(
            json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT / "sample-questions.jsonl").write_text(
        "\n".join(json.dumps(question, ensure_ascii=False) for question in all_questions) + "\n",
        encoding="utf-8")
    (OUTPUT / "sample-audit.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
