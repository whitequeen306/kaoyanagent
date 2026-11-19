"""Tag easy/medium/hard using third-party anchors; 2019 is assigned from published P values."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from reconstruct_latex import CACHE, ROOT, load_env, request_json

OUTPUT = ROOT / "pipeline" / "output"
ANCHOR = ROOT / "pipeline" / "reference" / "difficulty-anchors-2019.json"

SYSTEM = """你是考研数学二的难度标注员。难度口径：P=平均得分率，P越高越容易。
分档：易 P>=0.65；中 0.40<=P<0.65；难 P<0.40。
只能输出 easy / medium / hard。参考锚例题体会官方统计口径，不要给出 P 值。
严格输出 JSON：
{"items":[{"seq_label":"选择-1","difficulty":"medium","confidence":2,"reason":"不超过20字"}]}"""


def tier(p: float) -> str:
    if p >= 0.65:
        return "easy"
    if p >= 0.40:
        return "medium"
    return "hard"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    anchors = json.loads(ANCHOR.read_text(encoding="utf-8"))["questions"]
    rows = [json.loads(line) for line in (OUTPUT / "pilot-bank.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [row for row in rows if row["year"] == args.year]
    if args.year == 2019:
        by_number = {f"{'选择' if q['section']=='choice' else '填空' if q['section']=='blank' else '解答'}-{q['number']}": q for q in anchors}
        items = []
        for row in rows:
            anchor = by_number[row["seq_label"]]
            items.append({
                "seq_label": row["seq_label"], "difficulty": tier(anchor["difficulty_p"]),
                "difficulty_p": anchor["difficulty_p"], "source": "third_party_wendu_2019",
                "confidence": 3, "reason": "按文都公开的2019逐题得分率分档",
            })
        result = {"items": items}
    else:
        env = load_env()
        example_pool = [q for q in anchors if q["difficulty_p"] >= 0.65][:3] + \
                       [q for q in anchors if 0.40 <= q["difficulty_p"] < 0.65][:3] + \
                       [q for q in anchors if q["difficulty_p"] < 0.40][:3]
        anchors_text = json.dumps(example_pool, ensure_ascii=False)
        compact = [{
            "seq_label": row["seq_label"], "qtype": row["qtype"],
            "official_exam_point": row["exam_point_raw"],
            "score_points": row["score_x2"] / 2,
            "stem": row["stem_latex"][:600],
        } for row in rows]
        prompt = "2019 锚例题（P为得分率，越高越容易）：\n" + anchors_text + "\n\n待标注题目：\n" + json.dumps(compact, ensure_ascii=False)
        key = hashlib.sha256(f"{env['KAOYAN_LLM_MODEL']}:{args.year}:difficulty-v1".encode()).hexdigest()
        cache_file = CACHE / f"diff-{key}.json"
        if cache_file.exists():
            result = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            result = request_json(env, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
            cache_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        for item in result.get("items", []):
            if item.get("difficulty") not in {"easy", "medium", "hard"}:
                raise SystemExit(f"invalid difficulty for {item.get('seq_label')}")
        if len(result.get("items", [])) != len(rows):
            raise SystemExit("difficulty item count mismatch")
    output = Path(args.out) if args.out else OUTPUT / f"difficulty-tags-{args.year}.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {}
    for item in result["items"]:
        counts[item["difficulty"]] = counts.get(item["difficulty"], 0) + 1
    print(json.dumps({"year": args.year, "items": len(result["items"]), "counts": counts, "out": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
