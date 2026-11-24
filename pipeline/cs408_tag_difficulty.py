"""Label 408 question difficulty with an OpenAI-compatible model, anchored by public star ratings.

The 2020 star ratings come from a public per-question analysis and are used as a
calibration set, not as official difficulty. 2020 itself is copied from the
calibration file; other years are labeled by the model.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "pipeline" / "output" / "cs408-bank.jsonl"
TAGS = ROOT / "pipeline" / "output" / "cs408-tags.json"
CALIBRATION = ROOT / "pipeline" / "cs408-difficulty-calibration.json"
OUT = ROOT / "pipeline" / "output" / "cs408-difficulty.json"
REPORT = ROOT / "pipeline" / "output" / "cs408-difficulty-report.json"

RUBRIC = """你是考研 408（数据结构、计算机组成原理、操作系统、计算机网络）的教研员。请给每道题标注难度，只使用 easy / medium / hard 三档。
统一标准：
- easy：直接套用定义、常见固定套路，或一步计算即可选出；基础扎实的学生应稳定做对。
- medium：需要两步以上推理、常见但容易忽略的陷阱、跨小节结合，或需要较熟练的固定计算。
- hard：新概念/新问法首次出现、跨章综合、计算量大、需要完整推导或构造，或回忆版题目信息不完整导致难以确定。
参考 2020 年公开逐题星级（1-2星= easy，3星= medium，4-5星= hard）：
- 2020 第1题：列优先存储矩阵，画草图即可 -> easy
- 2020 第3题：二叉树顺序存储，注意“任意”陷阱 -> medium
- 2020 第6题：逆拓扑序列，首次考查、需要理解定义 -> hard
- 2020 第10题：B 树创建与分裂，需要完整过程 -> medium
- 2020 第17题：单周期/多周期 CPU 概念，回忆版信息不完整 -> hard
- 2020 第23题：文件打开计数器与打开文件表，概念容易混淆 -> hard
- 2020 第37题：IEEE 802.11 DIFS/SIFS，超出常规教材范围 -> hard
- 2020 第39题：TCP 连接管理细节，确认报文序号 -> hard
没有图的题正常判断；如果题干依赖图形而你看不到图，请降低 confidence，不要猜具体图形内容。
只输出 JSON，不要代码块：
{"items":[{"id":"题目id","difficulty":"easy|medium|hard","confidence":0-100,"reason":"一句中文依据"}]}
每个输入 id 必须恰好出现一次。"""

LEVELS = {"easy": "easy", "medium": "medium", "hard": "hard", "易": "easy", "中": "medium", "难": "hard"}


def read_env() -> dict:
    values = {}
    try:
        for raw in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
            match = re.match(r"^([A-Z0-9_]+)=(.*)$", raw.strip())
            if match:
                values[match.group(1)] = match.group(2).strip().strip("'\"")
    except FileNotFoundError:
        pass
    return {
        "base_url": os.environ.get("KAOYAN_LLM_BASE_URL") or values.get("KAOYAN_LLM_BASE_URL", ""),
        "api_key": os.environ.get("KAOYAN_LLM_API_KEY") or values.get("KAOYAN_LLM_API_KEY", ""),
        "model": os.environ.get("KAOYAN_LLM_MODEL") or values.get("KAOYAN_LLM_MODEL", ""),
    }


def call_model(messages: list[dict], config: dict) -> str:
    body = json.dumps({"model": config["model"], "messages": messages, "temperature": 0.1, "max_tokens": 2200}).encode()
    request = urllib.request.Request(
        config["base_url"].rstrip("/") + "/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?|```$", "", str(text or "").strip(), flags=re.M).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("model returned no JSON object")
    return json.loads(cleaned[start:end + 1])


def chapter_names(question: dict, knowledge: list[dict]) -> list[str]:
    by_code = {node["code"]: node for node in knowledge}
    names = []
    for tag in question.get("knowledge") or []:
        node = by_code.get(tag["code"])
        if node:
            names.append(node["name"])
    return names


def prompt_batch(batch: list[dict], knowledge: list[dict]) -> list[dict]:
    lines = []
    for index, question in enumerate(batch, start=1):
        options = " | ".join(f"{option['label']}. {option.get('text') or ''}" for option in question.get("options") or [])
        explanation = (question.get("answer_text") or question.get("explanation") or "")[:700]
        lines.append(
            f"【{index}】id={question['id']}\n"
            f"年份/题号：{question['year']} / {question['number']}\n"
            f"章节：{'、'.join(chapter_names(question, knowledge)) or '未标注'}\n"
            f"题型：{question['qtype']}\n"
            f"题干：{question.get('question_text', '')[:1400]}\n"
            f"选项：{options or '无'}\n"
            f"答案与解析：{explanation or '无'}\n"
            f"含图：{'是' if question.get('figures') else '否'}"
        )
    return [{"role": "system", "content": RUBRIC}, {"role": "user", "content": "\n\n".join(lines)}]


def label_batch(batch: list[dict], knowledge: list[dict], config: dict) -> dict[str, dict]:
    messages = prompt_batch(batch, knowledge)
    last_error = None
    for attempt in range(3):
        try:
            parsed = parse_json(call_model(messages, config))
            items = parsed.get("items")
            if not isinstance(items, list):
                raise ValueError("items missing")
            result = {}
            for item in items:
                question_id = str(item.get("id") or "")
                level = LEVELS.get(str(item.get("difficulty") or "").strip().lower())
                if not question_id or not level:
                    continue
                result[question_id] = {
                    "difficulty": level,
                    "confidence": max(0, min(100, int(item.get("confidence") or 0))),
                    "reason": str(item.get("reason") or "").strip()[:300],
                }
            missing = [question["id"] for question in batch if question["id"] not in result]
            if missing:
                raise ValueError(f"missing ids: {missing[:3]}")
            return result
        except Exception as error:
            last_error = error
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"batch failed: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, help="only label one year")
    parser.add_argument("--limit", type=int, help="pilot: only first N non-2020 questions")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--calibration-only", action="store_true", help="write 2020 calibration labels only, no model calls")
    parser.add_argument("--validate", action="store_true", help="also relabel 2020 with the model and compare with calibration")
    args = parser.parse_args()

    calibration = json.loads(CALIBRATION.read_text(encoding="utf-8"))
    knowledge = json.loads((ROOT / "pipeline" / "output" / "cs408-knowledge.json").read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in BANK.read_text(encoding="utf-8").splitlines() if line.strip()]
    labels = {}
    for year, ratings in calibration["ratings"].items():
        for number, stars in ratings.items():
            question_id = f"cs408-{year}-{int(number):02d}"
            level = "easy" if stars <= 2 else "medium" if stars == 3 else "hard"
            labels[question_id] = {
                "difficulty": level, "stars": stars, "confidence": 100,
                "reason": "2020 公开逐题星级校准", "source": "public_star_calibration",
            }

    model_questions = [row for row in rows if row["id"] not in labels and (not args.year or row["year"] == args.year)]
    if args.limit:
        model_questions = model_questions[:args.limit]
    config = read_env()
    if model_questions and not args.calibration_only:
        if not all(config.values()):
            raise SystemExit("模型配置不完整：需要 KAOYAN_LLM_BASE_URL / KAOYAN_LLM_API_KEY / KAOYAN_LLM_MODEL")
        batches = [model_questions[index:index + args.batch_size] for index in range(0, len(model_questions), args.batch_size)]
        print(f"labeling {len(model_questions)} questions in {len(batches)} batches via {config['model']}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = {executor.submit(label_batch, batch, knowledge, config): batch for batch in batches}
            for done, future in enumerate(concurrent.futures.as_completed(futures), start=1):
                batch = futures[future]
                result = future.result()
                for question in batch:
                    labels[question["id"]] = {**result[question["id"]], "source": "model_web_rubric"}
                print(f"  {done}/{len(batches)} batches, {len(labels)} labels")
                payload = {
                    "schema": "cs408-difficulty.v1",
                    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "calibration_source": calibration["source"],
                    "labels": labels,
                }
                OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    validation = None
    if args.validate and not args.calibration_only:
        held_out = [row for row in rows if row["year"] == 2020]
        if held_out:
            print(f"validating {len(held_out)} 2020 questions against calibration")
            batches = [held_out[index:index + args.batch_size] for index in range(0, len(held_out), args.batch_size)]
            model_labels = {}
            for batch in batches:
                model_labels.update(label_batch(batch, knowledge, config))
            agree = 0
            rows_validation = []
            for question in held_out:
                expected = labels.get(question["id"], {}).get("difficulty")
                actual = model_labels.get(question["id"], {}).get("difficulty")
                if expected and actual:
                    agree += expected == actual
                    rows_validation.append({
                        "id": question["id"], "expected": expected, "actual": actual,
                        "confidence": model_labels[question["id"]].get("confidence"),
                    })
            validation = {
                "questions": len(rows_validation), "agreement_bp": round(agree * 10000 / len(rows_validation)) if rows_validation else None,
                "items": rows_validation,
            }

    report = {
        "schema": "cs408-difficulty-report.v1",
        "calibration": {"year": 2020, "count": len(calibration["ratings"].get("2020", {}))},
        "labeled": len(labels),
        "model_questions": len(model_questions),
        "levels": {level: sum(1 for value in labels.values() if value["difficulty"] == level) for level in ("easy", "medium", "hard")},
        "validation": validation,
    }
    OUT.write_text(json.dumps({
        "schema": "cs408-difficulty.v1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "calibration_source": calibration["source"],
        "labels": labels,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
