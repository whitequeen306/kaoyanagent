import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TREE = ROOT / "contracts" / "knowledge-tree.json"
TAGS = ROOT / "pipeline" / "output" / "knowledge-tags-2026.json"


@unittest.skipUnless(TAGS.exists(), "run tag_knowledge.py first")
class KnowledgeTaggingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items = json.loads(TAGS.read_text(encoding="utf-8"))["items"]
        cls.valid = {node["code"] for node in json.loads(TREE.read_text(encoding="utf-8")) if node["level"] == 3}

    def test_all_2026_questions_tagged(self):
        self.assertEqual(len(self.items), 22)
        self.assertEqual(len({item["seq_label"] for item in self.items}), 22)

    def test_codes_are_legal_and_have_one_main(self):
        for item in self.items:
            codes = [tag["code"] for tag in item["knowledge"]]
            self.assertTrue(set(codes) <= self.valid, f"invalid code in {item['seq_label']}")
            self.assertGreaterEqual(len(codes), 2)
            self.assertLessEqual(len(codes), 3)
            self.assertEqual(sum(1 for tag in item["knowledge"] if tag["role"] == "main"), 1)


if __name__ == "__main__":
    unittest.main()
