import json
import unittest
from pathlib import Path

TREE = Path(__file__).resolve().parent.parent.parent / "contracts" / "knowledge-tree.json"


class KnowledgeTreeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree = json.loads(TREE.read_text(encoding="utf-8"))

    def test_structure_counts(self):
        levels = {level: sum(1 for node in self.tree if node["level"] == level) for level in (1, 2, 3)}
        self.assertEqual(levels, {1: 2, 2: 11, 3: 124})
        self.assertEqual(len(self.tree), 137)

    def test_ids_are_unique_and_parented(self):
        self.assertEqual(len({node["id"] for node in self.tree}), len(self.tree))
        ids = {node["id"] for node in self.tree}
        for node in self.tree:
            if node["level"] == 1:
                self.assertIsNone(node["parent_id"])
            else:
                self.assertIn(node["parent_id"], ids)

    def test_expected_chapters(self):
        chapters = [node["name"] for node in self.tree if node["level"] == 2]
        self.assertIn("一、行列式", chapters)
        self.assertIn("五、常微分方程", chapters)


if __name__ == "__main__":
    unittest.main()
