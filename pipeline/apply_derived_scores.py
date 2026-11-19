"""Assign derived per-question scores from official section totals.

Scores are marked `derived_section_structure`. The 2019 question values are
overridden by a third-party published table (文都) as a verification anchor.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "pipeline" / "output"
ANCHOR = ROOT / "pipeline" / "reference" / "difficulty-anchors-2019.json"


def policy_for(year: int) -> dict:
    if year == 2007:
        return {"choice": (10, 4), "blank": (6, 4), "solution": [10, 10, 10, 10, 10, 12, 12, 12]}
    if year <= 2020:
        return {"choice": (8, 4), "blank": (6, 4), "solution": [10, 10, 10, 10, 10, 11, 11, 11, 11]}
    return {"choice": (10, 5), "blank": (6, 5), "solution": [10, 12, 12, 12, 12, 12]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", default=str(OUTPUT / "pilot-bank.jsonl"))
    parser.add_argument("--out", default=str(OUTPUT / "pilot-bank.jsonl"))
    parser.add_argument("--audit", default=str(OUTPUT / "score-audit.json"))
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.bank).read_text(encoding="utf-8").splitlines() if line.strip()]
    anchor = json.loads(ANCHOR.read_text(encoding="utf-8"))["questions"]
    prefix = {"choice": "选择", "blank": "填空", "solution": "解答"}
    anchor_map = {f"{prefix[q['section']]}-{q['number']}": q for q in anchor}
    by_year = defaultdict(list)
    for row in rows:
        by_year[row["year"]].append(row)
    audit = {}
    for year, bucket in sorted(by_year.items()):
        policy = policy_for(year)
        sections = defaultdict(list)
        for row in bucket:
            sections[row["section"]].append(row)
        for section, items in sections.items():
            items.sort(key=lambda row: int(row["seq_label"].rsplit("-", 1)[-1]))
            if section in ("choice", "blank"):
                count, score = policy[section]
                assert len(items) == count, f"{year} {section} count {len(items)} != {count}"
                for row in items:
                    row["score_x2"] = score * 2
                    row["score_source"] = "derived_section_structure"
                    row["score_status"] = "derived"
            else:
                scores = policy["solution"]
                assert len(items) == len(scores), f"{year} solution count {len(items)} != {len(scores)}"
                for row, score in zip(items, scores):
                    row["score_x2"] = score * 2
                    row["score_source"] = "derived_section_structure"
                    row["score_status"] = "derived"
        if year == 2019:
            for row in bucket:
                anchor_row = anchor_map.get(row["seq_label"])
                if anchor_row:
                    row["score_x2"] = int(round(anchor_row["score"] * 2))
                    row["score_source"] = "third_party_wendu_2019"
                    row["score_status"] = "third_party_reference"
        for row in bucket:
            rubric = row.get("rubric_draft") or {}
            steps = rubric.get("steps", [])
            if steps:
                total = row["score_x2"]
                base, remainder = divmod(total, len(steps))
                for index, step in enumerate(steps):
                    step["points_x2"] = base + (1 if index >= len(steps) - remainder else 0)
                rubric["max_score_x2"] = total
                rubric["status"] = "derived_points"
            else:
                rubric["max_score_x2"] = row["score_x2"]
                rubric["status"] = "no_steps"
        total = sum(row["score_x2"] for row in bucket)
        audit[str(year)] = {
            "questions": len(bucket), "total_score_x2": total,
            "total_points": total / 2,
            "sections": {section: sum(row["score_x2"] for row in items) / 2 for section, items in sections.items()},
            "score_source": "derived_section_structure",
        }
        assert total == 300, f"{year} total {total} != 300 half-points"
    Path(args.out).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    Path(args.audit).write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"years": len(audit), "questions": len(rows), "all_total_150": all(v["total_points"] == 150 for v in audit.values())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
