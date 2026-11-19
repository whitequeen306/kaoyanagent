"""Build a machine-readable knowledge tree from the frozen product plan."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "docs" / "考研助手-参赛方案-v0.1.md"
OUTPUT = ROOT / "contracts" / "knowledge-tree.json"
CN_NUM = "一二三四五六七八九十"


def parse_tree(plan_text: str) -> list[dict]:
    block = plan_text.split("#### 完整树", 1)[1].split("节点统计", 1)[0]
    nodes: list[dict] = []
    subjects: list[dict] = []
    chapters: list[dict] = []
    current_subject = None
    current_chapter = None
    leaf_counts: dict[str, int] = {}
    for raw in block.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("```"):
            continue
        if not line.startswith(("├", "└", "│", " ")):
            # Subject line such as 高等数学（约 80%）
            name = stripped.split("（", 1)[0]
            code = "GS" if name == "高等数学" else "LA"
            current_subject = {"id": code, "parent_id": None, "code": code, "name": name, "level": 1}
            subjects.append(current_subject)
            current_chapter = None
            continue
        depth = 0
        index = 0
        while index < len(line) and line[index] in "│ ":
            if line.startswith("│   ", index) or line.startswith("    ", index):
                depth += 1
                index += 4
            else:
                index += 1
        label = re.sub(r"^[│\s]*[├└]──\s*", "", stripped).strip()
        if not label:
            continue
        if depth == 0:
            chapter_index = len([chapter for chapter in chapters if chapter["parent_id"] == current_subject["id"]]) + 1
            code = f"{current_subject['code']}{chapter_index}"
            current_chapter = {"id": code, "parent_id": current_subject["id"], "code": code, "name": label, "level": 2}
            chapters.append(current_chapter)
            leaf_counts[code] = 0
        elif depth == 1:
            if current_chapter is None:
                raise ValueError(f"leaf without chapter: {label}")
            leaf_counts[current_chapter["code"]] += 1
            code = f"{current_chapter['code']}-{leaf_counts[current_chapter['code']]:02d}"
            nodes.append({"id": code, "parent_id": current_chapter["id"], "code": code, "name": label, "level": 3})
    return subjects + chapters + nodes


def enrich(tree: list[dict]) -> list[dict]:
    for node in tree:
        node["aliases_json"] = [node["name"]]
        node["syllabus_ref"] = node["name"]
        node["description"] = node["name"]
    return tree


def main() -> None:
    tree = enrich(parse_tree(PLAN.read_text(encoding="utf-8")))
    OUTPUT.write_text(json.dumps(tree, ensure_ascii=False, indent=2), encoding="utf-8")
    levels = {level: sum(1 for node in tree if node["level"] == level) for level in (1, 2, 3)}
    print(json.dumps({"total": len(tree), "levels": levels, "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
