"""Produce a final, reproducible audit of the 501-question dataset."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent / "output"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    rows = load_jsonl(OUTPUT / "pilot-bank.jsonl")
    per_year = defaultdict(lambda: {"questions": 0, "latex": 0, "answers": 0, "tagged": 0, "rubric_steps": 0, "scores_pending": 0, "difficulty_tagged": 0, "score_x2": 0})
    for row in rows:
        bucket = per_year[row["year"]]
        bucket["questions"] += 1
        bucket["latex"] += 1 if row["stem_latex"].strip() else 0
        bucket["answers"] += 1 if row["answer_latex"].strip() else 0
        bucket["tagged"] += 1 if row["knowledge"] else 0
        bucket["rubric_steps"] += len(row["rubric_draft"]["steps"])
        bucket["scores_pending"] += 1 if row["score_x2"] is None else 0
        bucket["difficulty_tagged"] += 1 if row.get("difficulty") else 0
        bucket["score_x2"] += row["score_x2"] or 0
    summary = {
        "years": len(per_year),
        "questions": len(rows),
        "latex_ready": sum(bucket["latex"] for bucket in per_year.values()),
        "answers": sum(bucket["answers"] for bucket in per_year.values()),
        "tagged": sum(bucket["tagged"] for bucket in per_year.values()),
        "rubric_steps": sum(bucket["rubric_steps"] for bucket in per_year.values()),
        "scores_pending": sum(bucket["scores_pending"] for bucket in per_year.values()),
        "difficulty_tagged": sum(bucket["difficulty_tagged"] for bucket in per_year.values()),
        "per_year": {str(year): dict(bucket) for year, bucket in sorted(per_year.items())},
    }
    (OUTPUT / "dataset-audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("years", "questions", "latex_ready", "answers", "tagged", "rubric_steps", "scores_pending")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
