"""Tag reconstructed questions with leaf knowledge codes using official exam points."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from reconstruct_latex import CACHE, ROOT, load_env, request_json

TREE = ROOT / "contracts" / "knowledge-tree.json"
SOLUTIONS = ROOT / "pipeline" / "output" / "solutions-all.json"
OUTPUT = ROOT / "pipeline" / "output"

SYSTEM = """你是考研数学二的知识点标注员。只允许使用用户提供的考纲叶子考点码，不得发明新码。
为每道题选择 1-3 个最贴近的叶子考点：最核心的一个 role=main、weight=100，其余 role=aux、weight=50。
优先依据官方【考点】，其次参考题干与答案。严格输出 JSON：
{"items":[{"seq_label":"...","knowledge":[{"code":"GS1-09","role":"main","weight":100}]}]}"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--stems", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    env = load_env()
    tree = [node for node in json.loads(TREE.read_text(encoding="utf-8")) if node["level"] == 3]
    valid = {node["code"] for node in tree}
    solutions = json.loads(SOLUTIONS.read_text(encoding="utf-8"))[str(args.year)]
    stems = {row["seq_label"]: row for row in (
        json.loads(line) for line in Path(args.stems).read_text(encoding="utf-8").splitlines() if line.strip()
    )}
    catalogue = "\n".join(f"{node['code']} {node['name']}" for node in tree)
    items = []
    for seq_label, record in sorted(solutions.items(), key=lambda pair: int(pair[0])):
        stem = stems.get(f"{'选择' if record['section']=='选择题' else '填空' if record['section']=='填空题' else '解答'}-{seq_label}", {})
        items.append({
            "seq_label": f"{'选择' if record['section']=='选择题' else '填空' if record['section']=='填空题' else '解答'}-{seq_label}",
            "official_exam_point": record["exam_point_raw"],
            "stem": stem.get("stem_latex", "")[:800],
            "answer": record["answer_raw"][:300],
        })
    prompt = f"考点码表（只能使用这些码）：\n{catalogue}\n\n题目：\n{json.dumps(items, ensure_ascii=False)}"
    key = hashlib.sha256(f"{env['KAOYAN_LLM_MODEL']}:{args.year}:tag-v1".encode()).hexdigest()
    cache_file = CACHE / f"tag-{key}.json"
    if cache_file.exists():
        parsed = json.loads(cache_file.read_text(encoding="utf-8"))
    else:
        parsed = request_json(env, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
        cache_file.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    invalid = []
    for item in parsed.get("items", []):
        for tag in item.get("knowledge", []):
            if tag.get("code") not in valid:
                invalid.append(tag.get("code"))
    if invalid:
        raise SystemExit(f"invalid knowledge codes: {sorted(set(invalid))}")
    output = Path(args.out) if args.out else OUTPUT / f"knowledge-tags-{args.year}.json"
    output.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = [len(item.get("knowledge", [])) for item in parsed.get("items", [])]
    print(json.dumps({"year": args.year, "items": len(counts), "min_tags": min(counts), "max_tags": max(counts), "out": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
