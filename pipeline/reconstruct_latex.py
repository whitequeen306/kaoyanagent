"""Reconstruct LaTeX for one question at a time using the local multimodal gateway.

The model receives the cropped page image plus positioned text spans. It must
return strict JSON; responses are cached so repeated runs do not spend tokens.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "pipeline" / "output" / "questions-all.jsonl"
CACHE = ROOT / "pipeline" / "output" / "llm-cache"
OUTPUT = ROOT / "pipeline" / "output"

SYSTEM_PROMPT = """你是考研数学二试卷的排版转写员。你的任务不是解题，而是把图片中的一道题忠实转写成 LaTeX。

要求：
1. 只转写题目本身，保留全部中文、条件、选项和标点，不增不减；题干不要包含开头的题号（如 12.）。
2. 数学公式用 $...$ 包裹；矩阵用 \\begin{pmatrix}...\\end{pmatrix}；分式用 \\frac{}{}；根号用 \\sqrt{}；积分、极限、上下标按数学含义书写。
3. 题号内的小问（如 (1)(2)）放进 parts 数组；不要把它们拆成独立题。
4. 看不清或存在两种合理读法时，填入 uncertainties 数组，不要猜。
5. 严格输出 JSON，不要 Markdown 代码块，不要额外解释：
{"stem_latex":"...", "parts":[{"label":"(1)","prompt_latex":"..."}], "options":[{"label":"A","latex":"..."}], "uncertainties":[]}
6. 如果题目本身只有一个问题，parts 返回空数组；选择题的四个选项按 A/B/C/D 放进 options，非选择题 options 返回空数组。"""


def load_env() -> dict:
    env = {}
    path = ROOT / ".env.local"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    for key in ("KAOYAN_LLM_BASE_URL", "KAOYAN_LLM_API_KEY", "KAOYAN_LLM_MODEL"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    missing = [key for key in ("KAOYAN_LLM_BASE_URL", "KAOYAN_LLM_API_KEY", "KAOYAN_LLM_MODEL") if not env.get(key)]
    if missing:
        raise SystemExit(f"missing env: {', '.join(missing)}")
    return env


def question_image_b64(question: dict) -> str:
    pages = {}
    for span in question["source_spans"]:
        rect = fitz.Rect(span["bbox"])
        pages.setdefault(span["page"], []).append(rect)
    pdf = ROOT / "数学二" / f"{question['year']}年考研数学二真题（试卷）.pdf"
    doc = fitz.open(pdf)
    # One image per page; multi-page questions send multiple images.
    images = []
    for page_number, rects in sorted(pages.items()):
        merged = rects[0]
        for rect in rects[1:]:
            merged |= rect
        merged.x0 = max(0, merged.x0 - 8)
        merged.y0 = max(0, merged.y0 - 8)
        merged.x1 = min(doc[page_number - 1].rect.width, merged.x1 + 8)
        merged.y1 = min(doc[page_number - 1].rect.height, merged.y1 + 8)
        pix = doc[page_number - 1].get_pixmap(clip=merged, dpi=180)
        images.append(base64.b64encode(pix.tobytes("png")).decode())
    return images[0]


def build_messages(question: dict, env: dict) -> list[dict]:
    span_text = "\n".join(
        f"p{span['page']} ({span['bbox'][0]},{span['bbox'][1]})-({span['bbox'][2]},{span['bbox'][3]}) "
        f"size={span['size']} font={','.join(span['fonts'])}: {span['text']}"
        for span in question["source_spans"]
    )
    prompt = (
        f"年份：{question['year']}\n题号：{question['seq_label']}\n题型：{question['qtype']}\n"
        f"带坐标文本（供核对，不要求逐字照抄顺序）：\n{span_text[:12000]}\n"
        "请只转写图片中的这道题，输出规定 JSON。"
    )
    content = [{"type": "text", "text": prompt}]
    for image in question_image_b64_all(question):
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}})
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}]


def question_image_b64_all(question: dict) -> list[str]:
    pages = {}
    for span in question["source_spans"]:
        pages.setdefault(span["page"], []).append(fitz.Rect(span["bbox"]))
    pdf = ROOT / "数学二" / f"{question['year']}年考研数学二真题（试卷）.pdf"
    doc = fitz.open(pdf)
    images = []
    for page_number, rects in sorted(pages.items()):
        merged = rects[0]
        for rect in rects[1:]:
            merged |= rect
        page_rect = doc[page_number - 1].rect
        merged = fitz.Rect(max(0, merged.x0 - 8), max(0, merged.y0 - 8),
                           min(page_rect.width, merged.x1 + 8), min(page_rect.height, merged.y1 + 8))
        pix = doc[page_number - 1].get_pixmap(clip=merged, dpi=180)
        images.append(base64.b64encode(pix.tobytes("png")).decode())
    return images


def call_model(env: dict, messages: list[dict]) -> str:
    payload = json.dumps({
        "model": env["KAOYAN_LLM_MODEL"],
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 8000,
    }).encode("utf-8")
    request = urllib.request.Request(
        env["KAOYAN_LLM_BASE_URL"].rstrip("/") + "/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {env['KAOYAN_LLM_API_KEY']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"gateway HTTP {error.code}: {detail}")
    return body["choices"][0]["message"]["content"]



def normalize_math(text: str) -> str:
    if not text:
        return text
    text = text.replace("\(", "$").replace("\)", "$").replace("\[", "$$").replace("\]", "$$")
    if "$" not in text and not any("一" <= ch <= "鿿" for ch in text):
        text = f"${text.strip()}$"
    return text

def parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("model did not return JSON")
    return json.loads(cleaned[start:end + 1])



def request_json(env: dict, messages: list[dict], attempts: int = 3) -> dict:
    raw = call_model(env, messages)
    last_error = None
    for attempt in range(attempts):
        try:
            return parse_json(raw)
        except Exception as error:
            last_error = error
            if attempt == attempts - 1:
                break
            correction = [
                {"role": "system", "content": "你是 JSON 修复器。只输出严格 JSON，LaTeX 中的每个反斜杠都必须写成双反斜杠。"},
                {"role": "user", "content": "下面的输出无法被 JSON 解析：" + str(error) + "\n\n原始输出：\n" + raw[-12000:] + "\n\n请重新输出同一内容，确保 JSON 合法。"},
            ]
            raw = call_model(env, correction)
    raise ValueError(f"model returned invalid JSON after {attempts} attempts: {last_error}")

def load_questions() -> list[dict]:
    return [json.loads(line) for line in QUESTIONS.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--seq", help="seq_label, e.g. 解答-22")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--out")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    env = load_env()
    questions = [q for q in load_questions() if q["year"] == args.year]
    if args.seq:
        questions = [q for q in questions if q["seq_label"] == args.seq]
    questions = questions[:args.limit]
    if not questions:
        raise SystemExit("no matching question")
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = []
    for question in questions:
        key = hashlib.sha256(f"{env['KAOYAN_LLM_MODEL']}:{question['content_hash']}:stem-v3".encode()).hexdigest()
        cache_file = CACHE / f"{key}.json"
        if cache_file.exists() and not args.force:
            result = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            messages = build_messages(question, env)
            parsed = request_json(env, messages)
            for _ in range(2):
                if str(parsed.get("stem_latex", "")).strip():
                    break
                messages = messages + [
                    {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                    {"role": "user", "content": "题干不能为空。请只根据图片重新转写完整题干，输出规定 JSON。"},
                ]
                parsed = request_json(env, messages)
            if not str(parsed.get("stem_latex", "")).strip():
                parsed.setdefault("uncertainties", []).append("empty_stem_after_retry")
            result = {"parsed": parsed, "question": {"year": question["year"], "seq_label": question["seq_label"]}}
            cache_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        rows.append({
            "year": question["year"], "seq_label": question["seq_label"],
            "stem_latex": normalize_math(result["parsed"].get("stem_latex", "")),
            "parts": [{"label": p.get("label", ""), "prompt_latex": normalize_math(p.get("prompt_latex", ""))} for p in result["parsed"].get("parts", [])],
            "options": [{"label": o.get("label", ""), "latex": normalize_math(o.get("latex", ""))} for o in result["parsed"].get("options", [])],
            "uncertainties": result["parsed"].get("uncertainties", []),
            "needs_model_latex": False,
            "source_spans": question["source_spans"],
        })
        print(f"reconstructed {question['year']} {question['seq_label']}: stem={len(rows[-1]['stem_latex'])} chars, parts={len(rows[-1]['parts'])}, uncertainties={len(rows[-1]['uncertainties'])}")
    if args.out:
        Path(args.out).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
