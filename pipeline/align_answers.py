"""Align official quick answers to segmented questions by original question number."""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz

YEAR_TITLE = re.compile(r"(\d{4})\s*年全国硕士研究生招生考试")
CHOICE_ANSWER = re.compile(r"^[A-D]$")
ENTRY = re.compile(r"^(\d{1,2})\.$")
SECTIONS = {"选择题", "填空题", "解答题"}


def _clean(lines: list[str]) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in lines if line.strip()]


def parse_answer_page(text: str, page_number: int | None = None) -> dict:
    lines = _clean(text.split("\n"))
    result = {"choice": {}, "blank": {}, "solution": {}}
    section = None
    index = 0
    expected = {}
    while index < len(lines):
        line = lines[index]
        if line in SECTIONS:
            section = line
            index += 1
            continue
        if section == "选择题" and line == "题号":
            numbers = []
            index += 1
            while index < len(lines) and re.fullmatch(r"\d{1,2}", lines[index]):
                numbers.append(lines[index])
                index += 1
            answers = []
            if index < len(lines) and lines[index] == "答案":
                index += 1
                while index < len(lines) and CHOICE_ANSWER.fullmatch(lines[index]):
                    answers.append(lines[index])
                    index += 1
            if len(numbers) == len(answers):
                result["choice"].update(dict(zip(numbers, answers)))
            continue
        if section in ("填空题", "解答题"):
            match = ENTRY.fullmatch(line)
            if match and (section not in expected or int(match.group(1)) == expected[section]):
                key = match.group(1)
                expected[section] = int(key) + 1
                index += 1
                body = []
                while index < len(lines) and lines[index] not in SECTIONS:
                    next_entry = ENTRY.fullmatch(lines[index])
                    if next_entry and (section not in expected or int(next_entry.group(1)) == expected[section]):
                        break
                    body.append(lines[index])
                    index += 1
                # Printed page numbers are sometimes appended after the final answer.
                if len(body) > 2 and re.fullmatch(r"\d{1,3}", body[-1]):
                    body = body[:-1]
                if body:
                    result["blank" if section == "填空题" else "solution"][key] = " ".join(body)
                continue
        index += 1
    return result


def load_answer_keys(pdf_path: str | Path) -> dict[int, dict]:
    doc = fitz.open(pdf_path)
    keys: dict[int, dict] = {}
    for page in doc:
        text = page.get_text()
        if "数学二答案速查" not in text:
            continue
        year_match = YEAR_TITLE.search(text)
        if not year_match:
            continue
        year = int(year_match.group(1))
        keys[year] = parse_answer_page(text, page.number + 1)
    return keys


def number_of(seq_label: str) -> str:
    return seq_label.rsplit("-", 1)[-1]


def attach_answers(questions: list[dict], keys: dict[int, dict]) -> list[dict]:
    for question in questions:
        key = keys.get(question["year"], {})
        table = {"choice": key.get("choice", {}), "blank": key.get("blank", {}), "solution": key.get("solution", {})}[question["section"]]
        value = table.get(number_of(question["seq_label"]))
        question["answer_status"] = "aligned" if value else "missing"
        if not value:
            continue
        question["answer_draft"] = value
        question["answer_source"] = "official"
        question["answer_format"] = "letter" if question["section"] == "choice" else "raw_math"
        if question["section"] == "choice":
            # Choice letters are already final and can be used for grading.
            question["answer_latex"] = value
        else:
            question["needs_model_latex"] = True
    return questions


def audit_alignment(questions: list[dict]) -> dict:
    by_year = defaultdict(lambda: {"total": 0, "aligned": 0, "missing": 0, "choice_aligned": 0, "blank_aligned": 0, "solution_aligned": 0})
    for question in questions:
        row = by_year[question["year"]]
        row["total"] += 1
        if question["answer_status"] == "aligned":
            row["aligned"] += 1
            row[f"{question['section']}_aligned"] += 1
        else:
            row["missing"] += 1
    return {str(year): dict(row) for year, row in sorted(by_year.items())}


def main() -> None:
    parser = argparse.ArgumentParser(description="Align official answers to segmented questions.")
    parser.add_argument("answers_pdf")
    parser.add_argument("questions_jsonl")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    keys = load_answer_keys(args.answers_pdf)
    questions = [json.loads(line) for line in Path(args.questions_jsonl).read_text(encoding="utf-8").splitlines() if line.strip()]
    attach_answers(questions, keys)
    Path(args.out).write_text("\n".join(json.dumps(q, ensure_ascii=False) for q in questions) + "\n", encoding="utf-8")
    print(json.dumps(audit_alignment(questions), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
