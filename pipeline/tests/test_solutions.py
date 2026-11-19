import json
import unittest
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "output"
SOLUTIONS = OUTPUT / "solutions-all.json"
AUDIT = OUTPUT / "solutions-audit.json"


@unittest.skipUnless(SOLUTIONS.exists() and AUDIT.exists(), "run extract_solutions.py first")
class SolutionsExtractionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(SOLUTIONS.read_text(encoding="utf-8"))
        cls.audit = json.loads(AUDIT.read_text(encoding="utf-8"))

    def test_scope_and_coverage(self):
        self.assertEqual(len(self.data), 22)
        self.assertEqual(sum(len(records) for records in self.data.values()), 501)
        self.assertFalse([year for year, row in self.audit.items() if row["expected"] != row["parsed"]])

    def test_2026_choice_has_official_exam_point_and_steps(self):
        record = self.data["2026"]["1"]
        self.assertEqual(record["answer_raw"], "A")
        self.assertIn("等价无穷小", record["exam_point_raw"])
        self.assertGreaterEqual(len(record["steps_raw"]), 3)

    def test_2026_last_question_has_four_official_steps(self):
        record = self.data["2026"]["22"]
        self.assertIn("极大无关组", record["exam_point_raw"])
        self.assertEqual(len(record["steps_raw"]), 4)

    def test_missing_proof_is_not_invented(self):
        record = self.data["2005"]["19"]
        self.assertEqual(record["answer_raw"], "见证明")
        self.assertEqual(record["steps_raw"], [])


if __name__ == "__main__":
    unittest.main()
