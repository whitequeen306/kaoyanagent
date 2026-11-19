import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT = ROOT / "pipeline" / "output"
ANCHOR = ROOT / "pipeline" / "reference" / "difficulty-anchors-2019.json"
VALID = {"easy", "medium", "hard"}


def tier(p):
    return "easy" if p >= 0.65 else "medium" if p >= 0.40 else "hard"


class DifficultyTaggingTest(unittest.TestCase):
    def test_all_22_years_and_501_questions(self):
        total = 0
        for year in range(2005, 2027):
            path = OUTPUT / f"difficulty-tags-{year}.json"
            self.assertTrue(path.exists(), str(path))
            items = json.loads(path.read_text(encoding="utf-8"))["items"]
            total += len(items)
            self.assertTrue(all(item["difficulty"] in VALID for item in items))
        self.assertEqual(total, 501)

    def test_2019_matches_third_party_p_values(self):
        anchors = json.loads(ANCHOR.read_text(encoding="utf-8"))["questions"]
        tags = json.loads((OUTPUT / "difficulty-tags-2019.json").read_text(encoding="utf-8"))["items"]
        by_label = {item["seq_label"]: item for item in tags}
        for anchor in anchors:
            label = f"{'选择' if anchor['section']=='choice' else '填空' if anchor['section']=='blank' else '解答'}-{anchor['number']}"
            self.assertEqual(by_label[label]["difficulty"], tier(anchor["difficulty_p"]))
            self.assertEqual(by_label[label]["source"], "third_party_wendu_2019")


if __name__ == "__main__":
    unittest.main()
