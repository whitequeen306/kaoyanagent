"""Build a three-level 408 knowledge tree from the 2027 syllabus pages."""
from __future__ import annotations

import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "data" / "cs408" / "all-cs408-answers.pdf"
OUT = ROOT / "pipeline" / "output" / "cs408-knowledge.json"

SUBJECTS = [("数据结构", "DS"), ("计算机组成原理", "CO"), ("操作系统", "OS"), ("计算机网络", "CN")]
CN_NUM = "一二三四五六七八九十"


def main() -> None:
    doc = fitz.open(PDF)
    text = "\n".join(doc[i].get_text() for i in range(3, 16))
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    subject_by_name = dict(SUBJECTS)
    nodes: list[dict] = []
    subject = chapter = None
    chapter_index = section_index = 0
    for line in lines:
        if line in subject_by_name:
            subject = subject_by_name[line]
            chapter_index = section_index = 0
            nodes.append({
                "id": subject, "parent_id": None, "code": subject, "name": line,
                "level": 1, "aliases": [line],
            })
        elif re.match(rf"^[{CN_NUM}]+、", line) and subject:
            chapter_index += 1
            section_index = 0
            chapter = f"{subject}{chapter_index}"
            nodes.append({
                "id": chapter, "parent_id": subject, "code": chapter, "name": line,
                "level": 2, "aliases": [line],
            })
        elif re.match(rf"^（[{CN_NUM}]+）", line) and chapter:
            section_index += 1
            code = f"{chapter}-{section_index:02d}"
            nodes.append({
                "id": code, "parent_id": chapter, "code": code, "name": line,
                "level": 3, "aliases": [line],
            })
    OUT.write_text(json.dumps(nodes, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {subject: sum(1 for node in nodes if node["id"].startswith(subject) and node["level"] == 2) for _, subject in SUBJECTS}
    print(json.dumps({"nodes": len(nodes), "chapters": counts, "out": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
