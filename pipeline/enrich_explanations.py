"""Generate one cached, LaTeX-formatted explanation per real question.

The official solution text is often a flattened PDF extraction. The model only
reformats that text into readable LaTeX; it is not asked to invent a new method.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from reconstruct_latex import CACHE, OUTPUT, ROOT, load_env, normalize_math, request_json

SYSTEM = """你是考研数学二的解析编辑。你会收到题干、正确答案和官方解析原文。
你的任务是把官方解析整理成适合网页阅读的详细解析，不是重新解题，也不能编造原文没有的结论或步骤。

硬性要求：
1. 所有数学内容必须写成 LaTeX：行内公式用 $...$，独立公式用 $$...$$。不要出现未被 $ 包裹的 LaTeX 命令。
2. summary 用 1-3 句话说明切入点和关键思路；steps 按解题顺序写 2-6 条，每条要有关键推导，不能只写结论。
3. 如果官方解析包含多种方法，保留主方法，可在 summary 中提一句其他方法。
4. 语言简洁、忠于原文；不要输出 Markdown、代码块、图片或额外说明。
5. 严格输出 JSON：{"summary":"...", "steps":["...", "..."]}"""


def prompt_for(row: dict) -> str:
    options = row.get("options_json") or []
    option_text = "\n".join(f"{item.get('label','')}. {item.get('latex','')}" for item in options)
    rubric_steps = [step.get("desc", "") for step in (row.get("rubric_draft") or {}).get("steps", [])]
    solution = str(row.get("solution_raw") or "").strip()
    return (
        f"年份：{row.get('year')}　题号：{row.get('seq_label')}　题型：{row.get('qtype')}\n\n"
        f"题干：\n{row.get('stem_latex','')}\n\n"
        f"选项：\n{option_text or '（无）'}\n\n"
        f"正确答案：\n{row.get('answer_latex','')}\n\n"
        f"考点：\n{row.get('exam_point_raw','') or '（未标注）'}\n\n"
        f"官方解析原文：\n{solution[:9000]}\n\n"
        f"已有评分步骤（仅作结构参考，可为空）：\n{json.dumps(rubric_steps, ensure_ascii=False)}\n\n"
        "请只输出规定 JSON。"
    )


def valid(parsed: dict) -> bool:
    summary = str(parsed.get("summary") or "").strip()
    steps = parsed.get("steps")
    return bool(summary) and isinstance(steps, list) and any(str(step).strip() for step in steps)


def enrich(env: dict, row: dict, force: bool) -> dict:
    key = hashlib.sha256(
        f"{env['KAOYAN_LLM_MODEL']}:{row['content_hash']}:explanation-v1".encode()
    ).hexdigest()
    cache_file = CACHE / f"exp-{key}.json"
    if cache_file.exists() and not force:
        parsed = json.loads(cache_file.read_text(encoding="utf-8"))
        cached = True
    else:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt_for(row)},
        ]
        parsed = request_json(env, messages)
        for _ in range(2):
            if valid(parsed):
                break
            messages = messages + [
                {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                {"role": "user", "content": "summary 和 steps 不能为空，steps 至少 2 条。请重新整理官方解析，并确保所有数学内容用 $...$ 包裹，只输出规定 JSON。"},
            ]
            parsed = request_json(env, messages)
        cached = False
        if not valid(parsed):
            raise ValueError("empty explanation after retries")
        cache_file.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "year": row["year"],
        "seq_label": row["seq_label"],
        "content_hash": row["content_hash"],
        "summary": normalize_math(str(parsed.get("summary") or "").strip()),
        "steps": [normalize_math(str(step).strip()) for step in parsed.get("steps", []) if str(step).strip()],
        "model": env["KAOYAN_LLM_MODEL"],
        "cached": cached,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--year", type=int)
    parser.add_argument("--seq")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--input", default=str(OUTPUT / "pilot-bank.jsonl"))
    parser.add_argument("--out", default=str(OUTPUT / "explanations.jsonl"))
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.input).read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.year:
        rows = [row for row in rows if row["year"] == args.year]
    if args.seq:
        rows = [row for row in rows if row["seq_label"] == args.seq]
    if args.limit:
        rows = rows[:args.limit]
    if not rows:
        raise SystemExit("no matching questions")
    env = load_env()
    CACHE.mkdir(parents=True, exist_ok=True)
    results = {}
    failures = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(enrich, env, row, args.force): row for row in rows}
        for index, future in enumerate(as_completed(futures), start=1):
            row = futures[future]
            try:
                result = future.result()
                results[row["content_hash"]] = result
                print(f"[{index}/{len(rows)}] {row['year']} {row['seq_label']}: {len(result['steps'])} steps, {len(result['summary'])} chars", flush=True)
            except BaseException as error:
                failures.append({"year": row["year"], "seq_label": row["seq_label"], "error": str(error)})
                print(f"[{index}/{len(rows)}] {row['year']} {row['seq_label']}: FAILED {error}", flush=True)
    ordered = [results[row["content_hash"]] for row in rows if row["content_hash"] in results]
    Path(args.out).write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in ordered) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "requested": len(rows), "succeeded": len(ordered), "failed": len(failures),
        "out": args.out, "failures": failures[:20],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
