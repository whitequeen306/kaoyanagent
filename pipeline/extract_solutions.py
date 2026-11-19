"""Extract per-question official solutions, exam points and solution steps."""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "pipeline" / "output"
YEAR = re.compile(r"(\d{4})\s*年全国硕士研究生招生考试")
QUESTION = re.compile(r"第\s*(\d{1,2})\s*题")
SECTIONS = {"选择题", "填空题", "解答题"}
MARKERS = ("【答案】", "【考点】", "【思路】", "【解】")


def collect_pages(pdf_path: str | Path) -> dict[int, list[str]]:
    doc = fitz.open(pdf_path)
    pages = defaultdict(list)
    current_year = None
    active = False
    for page in doc:
        text = page.get_text()
        year_match = YEAR.search(text)
        if year_match:
            current_year = int(year_match.group(1))
        if "数学二答案详解" in text:
            active = True
        if active and current_year and "绝密★启用前" not in text:
            pages[current_year].append(text)
        elif active and "绝密★启用前" in text:
            active = False
    return dict(pages)


def parse_year(text: str) -> dict[str, dict]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n") if line.strip()]
    records: dict[str, dict] = {}
    section = None
    current = None
    for line in lines:
        if line in SECTIONS:
            section = line
            continue
        match = QUESTION.fullmatch(line) or QUESTION.match(line)
        if match:
            key = match.group(1)
            current = {"section": section, "lines": []}
            records[key] = current
            continue
        if current is not None:
            current["lines"].append(line)
    for key, record in records.items():
        joined = "\n".join(record.pop("lines"))
        record["raw_block"] = joined
        for marker in MARKERS:
            record[marker] = marker in joined
        answer = re.search(r"【答案】([\s\S]*?)(?=【|$)", joined)
        point = re.search(r"【考点】([\s\S]*?)(?=【|$)", joined)
        approach = re.search(r"【思路】([\s\S]*?)(?=【|$)", joined)
        record["answer_raw"] = answer.group(1).strip() if answer else ""
        record["exam_point_raw"] = point.group(1).strip() if point else ""
        record["approach_raw"] = approach.group(1).strip() if approach else ""
        # Steps are preserved from the official solution text; no invented scoring.
        steps = re.split(r"(?=第[一二三四五六七八九十]+步)", joined)
        record["steps_raw"] = [step.strip() for step in steps if step.strip().startswith("第")]
        record["needs_latex"] = True
    return {key: value for key, value in records.items() if value["raw_block"].strip()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("details_pdf")
    parser.add_argument("--out", required=True)
    parser.add_argument("--audit")
    args = parser.parse_args()
    pages = collect_pages(args.details_pdf)
    result = {}
    for year, texts in sorted(pages.items()):
        if 2005 <= year <= 2026:
            result[str(year)] = parse_year("\n".join(texts))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.audit:
        questions = [json.loads(line) for line in (OUTPUT / "questions-all.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        expected = defaultdict(int)
        for question in questions:
            expected[str(question["year"])] += 1
        audit = {year: {"expected": expected.get(year, 0), "parsed": len(records)} for year, records in result.items()}
        Path(args.audit).write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
