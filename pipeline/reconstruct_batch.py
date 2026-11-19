"""Resumable batch reconstruction for a year range, with KaTeX validation."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
OUTPUT = PIPELINE / "output"


def run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=PIPELINE, text=True, capture_output=True, encoding="utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-year", type=int, required=True)
    parser.add_argument("--to-year", type=int, required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    audit = []
    for year in range(args.from_year, args.to_year + 1):
        stems = OUTPUT / f"reconstructed-{year}.jsonl"
        answers = OUTPUT / f"reconstructed-answers-{year}.jsonl"
        if args.force or not stems.exists():
            result = run([sys.executable, "reconstruct_latex.py", "--year", str(year), "--limit", "40", "--out", str(stems)])
            if result.returncode:
                raise SystemExit(f"{year} stems failed: {result.stderr[-800:]}")
        if args.force or not answers.exists():
            result = run([sys.executable, "reconstruct_answers.py", "--year", str(year), "--stems", str(stems), "--out", str(answers)])
            if result.returncode:
                raise SystemExit(f"{year} answers failed: {result.stderr[-800:]}")
        stem_check = run(["node", "validate_katex.mjs", str(stems)])
        answer_check = run(["node", "validate_katex.mjs", str(answers)])
        def parse(output: str) -> dict:
            try:
                return json.loads(output)
            except json.JSONDecodeError:
                return {"error": output[-500:]}
        stem_result = parse(stem_check.stdout)
        answer_result = parse(answer_check.stdout)
        row = {
            "year": year,
            "stem_formulas": stem_result.get("checked"),
            "stem_errors": stem_result.get("errors", []),
            "answer_formulas": answer_result.get("checked"),
            "answer_errors": answer_result.get("errors", []),
        }
        audit.append(row)
        print(json.dumps(row, ensure_ascii=False))
        (OUTPUT / "reconstruction-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    if any(row["stem_errors"] or row["answer_errors"] for row in audit):
        raise SystemExit("KaTeX validation failed; see reconstruction-audit.json")


if __name__ == "__main__":
    main()
