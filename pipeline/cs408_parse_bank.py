"""Parse the 408 Anki package into a structured question bank plus per-year papers."""
from __future__ import annotations

import hashlib
import html
import json
import re
import sqlite3
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
APKG = ROOT / "data" / "cs408" / "CS408-Past-Exams-Full-Guide-20261109.apkg"
DB = ROOT / "data" / "cs408" / "apkg" / "collection.anki2"
MEDIA_MANIFEST = ROOT / "data" / "cs408" / "apkg" / "media"
ANSWER_KEY = ROOT / "pipeline" / "output" / "cs408-answer-key.json"
OUT_DIR = ROOT / "pipeline" / "output"
ASSETS = ROOT / "data" / "cs408" / "assets"
BANK = OUT_DIR / "cs408-bank.jsonl"
PAPERS = OUT_DIR / "cs408-papers.json"
SUMMARY = OUT_DIR / "cs408-bank-summary.json"

IMG_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.I)
FIG_RE = re.compile(r"<figure\b[^>]*>(.*?)</figure>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>", re.S)
SUMMARY_P = re.compile(r"^<p\b[^>]*>(.*?)</p>", re.S | re.I)
HEADING_RE = re.compile(r"^\d+\s*[.．]?\s*(解析|解答)\s*[：:]?\s*\.?$")
OPTION_LABELS = "ABCD"

MANUAL_FIXES: dict[str, dict] = {
    "cs408-2024-36": {
        "question_text": "36．在采用 CSMA/CA 的 802.11 无线局域网中，DIFS=128 µs，SIFS≥28 µs，RTS、CTS 和 ACK 帧的传输时延分别是 3 µs、2 µs 和 2 µs，忽略信号传播时延。若主机 A 欲向 AP 发送一个总长度为 1998B 的数据帧，无线链路带宽为 54Mb/s，则隐藏站 B 收到 AP 发送的 CTS 帧时，设置的网络分配向量 NAV 的值是 ______。",
        "question_html": '<p class="paragraph question">36．在采用 CSMA/CA 的 802.11 无线局域网中，DIFS=128 µs，SIFS≥28 µs，RTS、CTS 和 ACK 帧的传输时延分别是 3 µs、2 µs 和 2 µs，忽略信号传播时延。若主机 A 欲向 AP 发送一个总长度为 1998B 的数据帧，无线链路带宽为 54Mb/s，则隐藏站 B 收到 AP 发送的 CTS 帧时，设置的网络分配向量 NAV 的值是 ______。</p>',
        "option_D": "\\(\\displaystyle 513\\,\\mu\\mathrm{s}\\)",
        "note": "题干从 2024 真题 PDF 恢复；原卷把 DIFS 单位印成 s，按 128 µs 补全。",
    },
}


def strip_tags(value: str) -> str:
    value = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(p|div|tr|li|h\d|table|figure|figcaption|pre)>", "\n", value, flags=re.I)
    value = re.sub(r"</t[dh]>", " ", value, flags=re.I)
    value = TAG_RE.sub("", value)
    value = html.unescape(value).replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n\s*\n+", "\n", value)
    return value.strip()


def is_answer_summary(value: str) -> bool:
    text = strip_tags(value)
    if "题号" in text and "答案" in text:
        return True
    pairs = re.findall(r"\d+\s*[.．、]\s*[A-D]\b|\d+\s+[A-D]\b", text)
    return len(pairs) >= 4


def clean_answer_html(value: str) -> str:
    text = value.strip()
    for _ in range(12):
        match = re.match(r'<p\b[^>]*class="exam-answer-key"[^>]*>.*?</p>', text, re.S | re.I)
        if match:
            text = text[match.end():].strip()
            continue
        match = re.match(r'<div\b[^>]*class="table-scroll"[^>]*>.*?</div>', text, re.S | re.I)
        if match and is_answer_summary(match.group(0)):
            text = text[match.end():].strip()
            continue
        match = re.match(r"<table\b.*?</table>", text, re.S | re.I)
        if match and is_answer_summary(match.group(0)):
            text = text[match.end():].strip()
            continue
        match = SUMMARY_P.match(text)
        if match:
            inner = strip_tags(match.group(1)).strip()
            if is_answer_summary(match.group(1)) or HEADING_RE.match(inner):
                text = text[match.end():].strip()
                continue
        break
    return text


def parse_total_score(stem: str) -> int | None:
    match = re.match(r"^\s*\d+\s*[.．、]\s*(?:[（(]\s*(?:本题\s*)?)?(\d+)\s*分", stem)
    if match:
        return int(match.group(1))
    match = re.search(r"[（(]\s*本题\s*(\d+)\s*分\s*[）)]", stem)
    if match:
        return int(match.group(1))
    return None


def safe_json(value):
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def svg_attrs(root: str) -> tuple[float | None, float | None, list[float] | None]:
    def attr(name: str) -> str | None:
        found = re.search(rf'\b{name}="([^"]+)"', root, re.I)
        return found.group(1) if found else None

    width = float(attr("width")) if attr("width") and re.fullmatch(r"[\d.]+", attr("width")) else None
    height = float(attr("height")) if attr("height") and re.fullmatch(r"[\d.]+", attr("height")) else None
    viewbox = attr("viewBox")
    box = [float(x) for x in re.split(r"[,\s]+", viewbox.strip())] if viewbox else None
    if box and len(box) != 4:
        box = None
    return width, height, box


def remove_choices(value: str) -> str:
    for _ in range(12):
        match = re.search(r'<div\b[^>]*class="[^"]*\bchoices\b[^"]*"[^>]*>', value, re.I)
        if not match:
            return value
        start = match.start()
        cursor = match.end()
        depth = 1
        removed = False
        for tag in re.finditer(r"<div\b[^>]*>|</div>", value[cursor:], re.I):
            if tag.group(0).lower().startswith("</"):
                depth -= 1
            else:
                depth += 1
            if depth == 0:
                value = value[:start] + value[cursor + tag.end():]
                removed = True
                break
        if not removed:
            return value
    return value


def remove_inline_options(value: str, options: list[dict]) -> str:
    if not options or any(option.get("image") for option in options):
        return value
    first = strip_tags(options[0].get("text") or "")
    if not first:
        return value
    snippet = re.escape(first[:12])
    match = re.search(rf"A\s*[.．、]\s*{snippet}", value)
    if match:
        return value[:match.start()].rstrip()
    index = value.find(first[:12])
    if index >= 0:
        label = value.rfind("A", 0, index)
        if label >= 0:
            return value[:label].rstrip()
    return value


def asset_dimensions(name: str, assets: Path) -> tuple[int | None, int | None]:
    path = assets / name
    if not path.exists():
        return None, None
    if path.suffix.lower() == ".svg":
        root = re.search(r"<svg\b[^>]*>", path.read_text(encoding="utf-8"), re.I)
        if not root:
            return None, None
        width, height, viewbox = svg_attrs(root.group(0))
        if viewbox:
            return round(width or viewbox[2]), round(height or viewbox[3])
        return (round(width), round(height)) if width and height else (None, None)
    try:
        with Image.open(path) as image:
            return image.width, image.height
    except OSError:
        return None, None


def make_option_crop(media_name: str, crop: dict, out_name: str, assets: Path) -> dict | None:
    source = assets / media_name
    if not source.exists() or not crop:
        return None
    width = float(crop.get("width") or 0)
    height = float(crop.get("height") or 0)
    if width <= 0 or height <= 0:
        return None
    source_w = float(crop.get("sourceWidth") or width)
    source_h = float(crop.get("sourceHeight") or height)
    x = float(crop.get("x") or 0)
    y = float(crop.get("y") or 0)
    suffix = source.suffix.lower()
    target = assets / out_name
    if suffix == ".svg":
        text = source.read_text(encoding="utf-8")
        root_match = re.search(r"<svg\b[^>]*>", text, re.I)
        if not root_match:
            return None
        root = root_match.group(0)
        media_w, media_h, viewbox = svg_attrs(root)
        if viewbox:
            base_w = media_w or viewbox[2]
            base_h = media_h or viewbox[3]
        else:
            base_w = media_w or source_w
            base_h = media_h or source_h
        scale_x = base_w / source_w if source_w else 1
        scale_y = base_h / source_h if source_h else 1
        box = [x * scale_x, y * scale_y, width * scale_x, height * scale_y]
        new_root = re.sub(r'\s(?:width|height|viewBox)="[^"]*"', "", root, flags=re.I)
        new_root = new_root[:-1] + f' width="{round(width)}" height="{round(height)}" viewBox="{box[0]:g} {box[1]:g} {box[2]:g} {box[3]:g}">'
        target.write_text(text[:root_match.start()] + new_root + text[root_match.end():], encoding="utf-8")
    elif suffix == ".png":
        image = Image.open(source)
        scale_x = image.width / source_w if source_w else 1
        scale_y = image.height / source_h if source_h else 1
        box = (
            round(x * scale_x),
            round(y * scale_y),
            round((x + width) * scale_x),
            round((y + height) * scale_y),
        )
        image.crop(box).save(target)
    else:
        return None
    return {"file": out_name, "url": f"/cs408/figures/{out_name}", "width": round(width), "height": round(height)}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    if not DB.exists():
        DB.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(APKG) as source:
            source.extract("collection.anki2", DB.parent)
            source.extract("media", DB.parent)
    con = sqlite3.connect(DB)
    cur = con.cursor()
    media = json.loads(MEDIA_MANIFEST.read_text(encoding="utf-8"))
    reverse_media = {name: key for key, name in media.items()}
    answer_key = json.loads(ANSWER_KEY.read_text(encoding="utf-8")) if ANSWER_KEY.exists() else {}
    archive = zipfile.ZipFile(APKG)

    asset_cache: dict[str, int] = {}
    asset_bytes = 0

    def extract_asset(name: str) -> bool:
        nonlocal asset_bytes
        key = reverse_media.get(name)
        if not key:
            return False
        target = ASSETS / name
        if not target.exists():
            data = archive.read(key)
            target.write_bytes(data)
            asset_bytes += len(data)
        asset_cache[name] = target.stat().st_size
        return True

    def rewrite_images(value: str) -> str:
        def replace(match: re.Match) -> str:
            src = match.group(2)
            if src in reverse_media:
                extract_asset(src)
                return match.group(1) + f"/cs408/figures/{src}" + match.group(3)
            return match.group(0)

        return IMG_RE.sub(replace, value)

    def figures_from(value: str, role: str) -> list[dict]:
        figures = []
        for match in FIG_RE.finditer(value):
            block = match.group(1)
            img = re.search(r"<img\b([^>]*)>", block, re.I)
            if not img:
                continue
            src = re.search(r'\bsrc="([^"]+)"', img.group(1))
            if not src or not src.group(1).startswith("/cs408/figures/"):
                continue
            alt = re.search(r'\balt="([^"]*)"', img.group(1))
            width = re.search(r'\bwidth="(\d+)"', img.group(1))
            height = re.search(r'\bheight="(\d+)"', img.group(1))
            caption = re.search(r"<figcaption\b[^>]*>(.*?)</figcaption>", block, re.I | re.S)
            file_name = src.group(1).rsplit("/", 1)[-1]
            file_width, file_height = asset_dimensions(file_name, ASSETS)
            figures.append({
                "role": role,
                "file": file_name,
                "url": src.group(1),
                "alt": html.unescape(alt.group(1)) if alt else "",
                "caption": strip_tags(caption.group(1)) if caption else "",
                "width": int(width.group(1)) if width else file_width,
                "height": int(height.group(1)) if height else file_height,
            })
        return figures

    rows: list[dict] = []
    papers: dict[int, dict] = {}
    stats = Counter()
    mismatches = []
    answer_notes = []
    missing_scores = defaultdict(list)
    missing_explanations = defaultdict(list)
    missing_media = []
    option_crop_failures = []
    front_leaks = []

    for nid, tags, fields in cur.execute("select id, tags, flds from notes"):
        if "使用说明" in tags:
            continue
        values = fields.split("\x1f")
        if len(values) < 6:
            continue
        title, question_html, answer_html, source_html, status, record_raw = values[:6]
        try:
            record = json.loads(html.unescape(record_raw))
        except json.JSONDecodeError:
            continue
        question = record["question"]
        answer = record["answer"]
        paper = record["paper"]
        year = int(paper["year"])
        number = int(question["number"])
        qtype = question.get("questionType")
        if qtype not in ("single_choice", "free_response"):
            qtype = "free_response"
        section = qtype

        question_html = rewrite_images(question_html)
        source_options_in_html = 'class="choices' in question_html
        question_html = remove_choices(question_html)
        question_html = re.sub(
            r'<div\b[^>]*class="[^"]*\bsource-choice-block\b[^"]*"[^>]*>\s*</div>',
            "",
            question_html,
            flags=re.I,
        )
        question_html = remove_inline_options(question_html, question.get("options") or [])
        answer_html = rewrite_images(answer_html)
        cleaned_answer = clean_answer_html(answer_html)
        question_text = strip_tags(question_html)
        answer_text = strip_tags(cleaned_answer)

        if "解答：" in question_text:
            front_leaks.append([year, number])

        figures = figures_from(question_html, "question") + figures_from(cleaned_answer, "answer")
        question_figures = [figure for figure in figures if figure["role"] == "question"]

        option_rows = []
        for index, option in enumerate(question.get("options") or []):
            label = OPTION_LABELS[index] if index < len(OPTION_LABELS) else chr(65 + index)
            option_text = option.get("text") or ""
            option_text = re.split(r"\s*二、综合应用题", option_text)[0].strip()
            row = {
                "label": label,
                "source_label": option.get("sourceLabel") or option.get("label"),
                "text": option_text,
                "image": None,
            }
            image = option.get("image")
            if image:
                crop = image.get("crop") or {}
                media_name = question_figures[0]["file"] if question_figures else None
                crop_name = f"option-{year}-{number:02d}-{label}{Path(media_name).suffix if media_name else '.svg'}"
                if media_name and extract_asset(media_name):
                    made = make_option_crop(media_name, crop, crop_name, ASSETS)
                    if made:
                        row["image"] = {**made, "alt": image.get("alt") or f"选项 {label} 图", "crop": crop}
                    else:
                        option_crop_failures.append([year, number, label])
                else:
                    option_crop_failures.append([year, number, label])
            option_rows.append(row)

        score = 2 if qtype == "single_choice" else parse_total_score(question.get("stem") or "")
        if qtype == "free_response" and score is None:
            missing_scores[str(year)].append(number)

        has_explanation = bool(
            (answer.get("explanation") or answer.get("solution"))
            or (answer_text and "来源仅提供答案表" not in answer_text and len(answer_text) >= 15)
            or any(figure["role"] == "answer" for figure in figures)
        )
        if not has_explanation:
            missing_explanations[str(year)].append(number)

        answer_value = answer.get("value") or (question.get("answer") or {}).get("value")
        if qtype == "single_choice":
            expected = (answer_key.get(str(year)) or {}).get(str(number))
            if answer_value != expected:
                mismatches.append([year, number, answer_value, expected])
            if not answer_value:
                answer_notes.append([year, number, "missing_answer"])

        content_hash = hashlib.sha256(json.dumps({
            "year": year, "number": number, "qtype": qtype,
            "question": question_text, "options": option_rows, "answer": answer_value,
        }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

        row = {
            "id": f"cs408-{year}-{number:02d}",
            "subject": "408",
            "paper_id": f"cs408-{year}",
            "year": year,
            "number": number,
            "seq_label": str(number),
            "title": title,
            "section": section,
            "qtype": qtype,
            "question_type_label": record.get("question_type_label"),
            "question_html": question_html,
            "question_text": question_text,
            "stem_text": question.get("stem") or "",
            "options": option_rows,
            "options_in_html": False,
            "source_options_in_html": source_options_in_html,
            "answer": answer_value,
            "answer_status": answer.get("status"),
            "answer_html": cleaned_answer,
            "answer_text": answer_text,
            "explanation": answer.get("explanation") or answer.get("solution") or "",
            "solution": answer.get("solution") or "",
            "has_explanation": has_explanation,
            "score": score,
            "score_x2": score * 2 if score is not None else None,
            "score_source": "section" if qtype == "single_choice" else ("source" if score is not None else "missing"),
            "figures": figures,
            "knowledge": [],
            "source": "real",
            "source_meta": {
                "paper_id": paper.get("id"),
                "question_id": answer.get("question_id"),
                "source_question_ids": safe_json(answer.get("source_question_ids_json")),
                "source_blocks": safe_json(answer.get("source_blocks_json")),
                "source_pages": safe_json(answer.get("source_pages_json")),
                "status": question.get("status"),
                "record_status": status,
            },
            "content_hash": content_hash,
            "status": "published",
            "is_fixture": False,
            "data_notes": [],
        }
        fix = MANUAL_FIXES.get(row["id"])
        if fix:
            row["question_text"] = fix["question_text"]
            row["question_html"] = fix["question_html"]
            if fix.get("option_D") and len(row["options"]) >= 4:
                row["options"][3]["text"] = fix["option_D"]
            row["data_notes"].append(fix["note"])
            row["content_hash"] = hashlib.sha256(json.dumps({
                "year": year, "number": number, "qtype": qtype,
                "question": row["question_text"], "options": row["options"], "answer": answer_value,
            }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        rows.append(row)
        paper_entry = papers.setdefault(year, {
            "id": f"cs408-{year}",
            "subject": "408",
            "year": year,
            "title": paper.get("title"),
            "kind": paper.get("kind"),
            "single_choice": 0,
            "free_response": 0,
            "question_count": 0,
            "free_score_sum": 0,
            "free_score_complete": True,
        })
        paper_entry["question_count"] += 1
        paper_entry[qtype] += 1
        if qtype == "free_response":
            if score is None:
                paper_entry["free_score_complete"] = False
            else:
                paper_entry["free_score_sum"] += score
        stats[qtype] += 1
        stats["questions"] += 1

    rows.sort(key=lambda row: (row["year"], row["number"]))
    BANK.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    paper_rows = []
    for year in sorted(papers):
        entry = papers[year]
        entry["single_score"] = entry["single_choice"] * 2
        entry["total_score"] = entry["single_score"] + entry["free_score_sum"] if entry["free_score_complete"] else None
        entry["missing_scores"] = missing_scores.get(str(year), [])
        entry["missing_explanations"] = missing_explanations.get(str(year), [])
        paper_rows.append(entry)
    PAPERS.write_text(json.dumps(paper_rows, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {
        "questions": stats["questions"],
        "single_choice": stats["single_choice"],
        "free_response": stats["free_response"],
        "years": len(papers),
        "year_range": [min(papers), max(papers)] if papers else None,
        "per_year": {str(year): papers[year]["question_count"] for year in sorted(papers)},
        "answer_mismatches": mismatches,
        "front_answer_leaks": front_leaks,
        "missing_explanations": {key: value for key, value in sorted(missing_explanations.items())},
        "missing_scores": {key: value for key, value in sorted(missing_scores.items())},
        "option_crop_failures": option_crop_failures,
        "media": {
            "files": len(asset_cache),
            "bytes": sum(asset_cache.values()),
            "missing": sorted({src for src in missing_media}),
        },
        "figures": {
            "question": sum(1 for row in rows for figure in row["figures"] if figure["role"] == "question"),
            "answer": sum(1 for row in rows for figure in row["figures"] if figure["role"] == "answer"),
            "image_options": sum(1 for row in rows for option in row["options"] if option["image"]),
        },
        "out": {"bank": str(BANK), "papers": str(PAPERS), "assets": str(ASSETS)},
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
