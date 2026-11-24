"""Parse the 408 answer-key PDF into a year -> question -> option map."""
from __future__ import annotations

import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "data" / "cs408" / "all-cs408-answers.pdf"
OUT = ROOT / "pipeline" / "output" / "cs408-answer-key.json"


def parse_page(text: str) -> dict[int, str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    start = lines.index("单项选择题")
    answers: dict[int, str] = {}
    i = start + 1
    while i < len(lines):
        if lines[i] == "题号":
            numbers = []
            i += 1
            while i < len(lines) and lines[i].isdigit():
                numbers.append(int(lines[i]))
                i += 1
            if i >= len(lines) or lines[i] != "答案":
                break
            i += 1
            letters = []
            while i < len(lines) and re.fullmatch(r"[A-D]", lines[i]):
                letters.append(lines[i])
                i += 1
            if len(numbers) != len(letters):
                raise ValueError(f"number/answer mismatch: {numbers} vs {letters}")
            answers.update(zip(numbers, letters))
        elif lines[i] == "综合应用题":
            break
        else:
            i += 1
    return answers


def main() -> None:
    doc = fitz.open(PDF)
    result: dict[str, dict[str, str]] = {}
    for page in doc:
        text = page.get_text()
        if "答案速查" not in text:
            continue
        year_match = re.match(r"\s*(\d{4}) 年全国硕士研究生招生考试", text)
        if not year_match:
            continue
        year = year_match.group(1)
        answers = parse_page(text)
        if len(answers) != 40:
            raise ValueError(f"{year}: expected 40 answers, got {len(answers)}")
        result[year] = {str(number): answer for number, answer in sorted(answers.items())}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"years": len(result), "answers": sum(len(v) for v in result.values()), "out": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
