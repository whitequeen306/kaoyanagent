"""Draft scoring steps from official solution text, without assigning points."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from reconstruct_latex import CACHE, ROOT, load_env, request_json

OUTPUT = ROOT / "pipeline" / "output"
SOLUTIONS = OUTPUT / "solutions-all.json"

SYSTEM = """你是考研数学阅卷步骤抽取器。你会收到官方解析原文。只允许从原文抽取可核验的评分步骤，不得新增解法、不得改写数学结论、不得给出分值。
要求：
1. 每道解答题/填空题抽 2-6 步，每步一句可核验的描述（例如“正确写出拉格朗日函数”）。
2. 选择题不需要步骤，返回空数组。
3. 原文只有结论或“见证明”时，返回空数组并在 notes 说明。
4. 严格输出 JSON：
{"items":[{"seq_label":"解答-17","steps":[{"desc":"...","must":false}],"notes":[]}]}"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    env = load_env()
    records = json.loads(SOLUTIONS.read_text(encoding="utf-8"))[str(args.year)]
    stems = {row["seq_label"]: row for row in (
        json.loads(line) for line in (OUTPUT / f"reconstructed-{args.year}.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()
    )}
    items = []
    for number, record in sorted(records.items(), key=lambda pair: int(pair[0])):
        if record["section"] == "选择题":
            continue
        prefix = "填空" if record["section"] == "填空题" else "解答"
        seq_label = f"{prefix}-{number}"
        items.append({
            "seq_label": seq_label,
            "stem": stems.get(seq_label, {}).get("stem_latex", "")[:800],
            "official_answer": record["answer_raw"][:500],
            "official_solution": record["raw_block"][:3000],
        })
    prompt = "题目与官方解析：\n" + json.dumps(items, ensure_ascii=False)
    key = hashlib.sha256(f"{env['KAOYAN_LLM_MODEL']}:{args.year}:rubric-v1".encode()).hexdigest()
    cache_file = CACHE / f"rubric-{key}.json"
    if cache_file.exists():
        parsed = json.loads(cache_file.read_text(encoding="utf-8"))
    else:
        parsed = request_json(env, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
        cache_file.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    for item in parsed.get("items", []):
        steps = item.get("steps", [])
        if len(steps) > 8:
            raise SystemExit(f"too many steps for {item.get('seq_label')}")
        for step in steps:
            if not str(step.get("desc", "")).strip():
                raise SystemExit(f"empty step for {item.get('seq_label')}")
    output = Path(args.out) if args.out else OUTPUT / f"rubric-drafts-{args.year}.json"
    output.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = [len(item.get("steps", [])) for item in parsed.get("items", [])]
    print(json.dumps({"year": args.year, "items": len(counts), "min_steps": min(counts), "max_steps": max(counts), "out": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
