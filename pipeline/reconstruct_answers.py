"""Convert official raw answer text into LaTeX. Does not solve or invent steps."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from reconstruct_latex import CACHE, OUTPUT, ROOT, call_model, load_env, normalize_math, request_json

SYSTEM = """你是考研数学答案的排版转写员。你会收到题干 LaTeX 和官方答案的原始文本（可能含换行、PUA 字符、分数被压平）。
你的任务只是把答案转写成规范 LaTeX，不要解题，不要补充原文没有的步骤或结论。

要求：
1. 答案中的数学内容用 $...$；矩阵用 pmatrix；分数用 \\frac；根号用 \\sqrt；上下标按含义书写。
2. 原文是分式被压平时的换行，请按数学含义合并，例如 "1" 换行 "2." 表示 \\frac{1}{2}。
3. 原文只有结论时，只输出结论，不要编造过程。
4. 看不清时写入 uncertainties。
5. 严格输出 JSON，不要代码块：
{"answer_latex":"...", "uncertainties":[]}"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--stems", required=True, help="reconstructed stems JSONL")
    parser.add_argument("--questions", default=str(ROOT / "pipeline" / "output" / "questions-all.jsonl"))
    parser.add_argument("--out", required=True)
    parser.add_argument("--seq")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    env = load_env()
    stems = {row["seq_label"]: row for row in (
        json.loads(line) for line in Path(args.stems).read_text(encoding="utf-8").splitlines() if line.strip()
    )}
    questions = [json.loads(line) for line in Path(args.questions).read_text(encoding="utf-8").splitlines() if line.strip()]
    questions = [q for q in questions if q["year"] == args.year and q["section"] != "choice" and q.get("answer_draft")]
    if args.seq:
        questions = [q for q in questions if q["seq_label"] == args.seq]
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = []
    for question in questions:
        stem = stems.get(question["seq_label"], {})
        prompt = (
            f"题干 LaTeX：\n{stem.get('stem_latex','')}\n\n"
            f"官方答案原始文本：\n{question['answer_draft']}\n\n"
            "请只输出规定的 JSON。"
        )
        key = hashlib.sha256(f"{env['KAOYAN_LLM_MODEL']}:{question['content_hash']}:answer-v1:{question['answer_draft']}".encode()).hexdigest()
        cache_file = CACHE / f"ans-{key}.json"
        if cache_file.exists() and not args.force:
            parsed = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
            parsed = request_json(env, messages)
            for _ in range(2):
                if str(parsed.get("answer_latex", "")).strip():
                    break
                messages = messages + [
                    {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                    {"role": "user", "content": "answer_latex 不能为空。请只根据官方答案原文转写，输出规定 JSON。"},
                ]
                parsed = request_json(env, messages)
            if not str(parsed.get("answer_latex", "")).strip():
                parsed.setdefault("uncertainties", []).append("empty_answer_after_retry")
            cache_file.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append({
            "year": question["year"], "seq_label": question["seq_label"], "section": question["section"],
            "answer_latex": normalize_math(parsed.get("answer_latex", "")),
            "uncertainties": parsed.get("uncertainties", []),
            "answer_source": "official",
        })
        print(f"{question['seq_label']}: {len(rows[-1]['answer_latex'])} chars, uncertainties={len(rows[-1]['uncertainties'])}")
    Path(args.out).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
