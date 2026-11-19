"""Merge reconstructed stems/answers, official solutions and tags into a pilot bank.

Scores are intentionally null: official quick-answer/detail PDFs do not publish
per-question point values, so inventing them would violate the product rule.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "pipeline" / "output"


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default="2005,2006,2026")
    parser.add_argument("--out", default=str(OUTPUT / "pilot-bank.jsonl"))
    args = parser.parse_args()
    years = {int(value) for value in args.years.split(",")}
    questions = [q for q in load_jsonl(OUTPUT / "questions-all.jsonl") if q["year"] in years]
    solutions = json.loads((OUTPUT / "solutions-all.json").read_text(encoding="utf-8"))
    rows = []
    for question in questions:
        seq = question["seq_label"].split("-")[-1]
        solution = solutions[str(question["year"])].get(seq, {})
        stems = {row["seq_label"]: row for row in load_jsonl(OUTPUT / f"reconstructed-{question['year']}.jsonl")}
        answers = {row["seq_label"]: row for row in load_jsonl(OUTPUT / f"reconstructed-answers-{question['year']}.jsonl")}
        tags_path = OUTPUT / f"knowledge-tags-{question['year']}.json"
        tag_items = json.loads(tags_path.read_text(encoding="utf-8"))["items"] if tags_path.exists() else []
        tags = next((item["knowledge"] for item in tag_items if item["seq_label"] == question["seq_label"]), [])
        diff_path = OUTPUT / f"difficulty-tags-{question['year']}.json"
        diff_items = json.loads(diff_path.read_text(encoding="utf-8"))["items"] if diff_path.exists() else []
        diff = next((item for item in diff_items if item["seq_label"] == question["seq_label"]), None)
        stem = stems.get(question["seq_label"], {})
        answer = answers.get(question["seq_label"], {})
        rubric_path = OUTPUT / f"rubric-drafts-{question['year']}.json"
        rubric_items = json.loads(rubric_path.read_text(encoding="utf-8"))["items"] if rubric_path.exists() else []
        drafted = next((item["steps"] for item in rubric_items if item["seq_label"] == question["seq_label"]), None)
        if drafted:
            steps = [{
                "step": index + 1,
                "desc": step.get("desc", ""),
                "points_x2": None,
                "weight": 1,
                "must": bool(step.get("must", False)),
                "evidence_required": True,
            } for index, step in enumerate(drafted)]
            rubric_status = "needs_points"
        else:
            steps = [{
                "step": index + 1,
                "desc": step,
                "points_x2": None,
                "weight": 1,
                "must": False,
                "evidence_required": True,
            } for index, step in enumerate(solution.get("steps_raw", []))]
            rubric_status = "needs_points" if steps else "no_official_steps"
        row = {
            "id": question["id"],
            "year": question["year"],
            "seq_label": question["seq_label"],
            "section": question["section"],
            "qtype": question["qtype"],
            "stem_latex": stem.get("stem_latex", question.get("stem_draft", "")),
            "options_json": stem.get("options") or None,
            "sub_items_json": stem.get("parts") or None,
            "answer_latex": question.get("answer_latex") or answer.get("answer_latex", ""),
            "answer_source": "official",
            "exam_point_raw": solution.get("exam_point_raw", ""),
            "approach_raw": solution.get("approach_raw", ""),
            "solution_raw": solution.get("raw_block", ""),
            "knowledge": tags,
            "rubric_draft": {
                "source": "derived_official",
                "max_score_x2": None,
                "steps": steps,
                "status": rubric_status,
            },
            "score_x2": None,
            "score_status": "pending_official_score",
            "difficulty": diff.get("difficulty") if diff else None,
            "difficulty_source": diff.get("source") if diff else None,
            "difficulty_p": diff.get("difficulty_p") if diff else None,
            "status": "needs_review",
            "content_hash": question["content_hash"],
            "source_spans": question["source_spans"],
            "needs_model_latex": question["seq_label"] not in stems,
        }
        rows.append(row)
    Path(args.out).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    summary = {
        "years": sorted(years),
        "questions": len(rows),
        "latex_ready": sum(1 for row in rows if not row["needs_model_latex"]),
        "tagged": sum(1 for row in rows if row["knowledge"]),
        "answers": sum(1 for row in rows if row["answer_latex"]),
        "scores_pending": sum(1 for row in rows if row["score_x2"] is None),
        "difficulty_tagged": sum(1 for row in rows if row["difficulty"]),
        "rubric_steps": sum(len(row["rubric_draft"]["steps"]) for row in rows),
    }
    (OUTPUT / "pilot-bank-audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
