import json
import unittest
from pathlib import Path

PILOT = Path(__file__).resolve().parent.parent / "output" / "pilot-bank.jsonl"
AUDIT = Path(__file__).resolve().parent.parent / "output" / "pilot-bank-audit.json"


@unittest.skipUnless(PILOT.exists() and AUDIT.exists(), "run build_pilot_bank.py first")
class PilotBankTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = [json.loads(line) for line in PILOT.read_text(encoding="utf-8").splitlines() if line.strip()]
        cls.audit = json.loads(AUDIT.read_text(encoding="utf-8"))

    def test_scope(self):
        self.assertEqual(len(self.rows), 501)
        self.assertEqual(set(self.audit["years"]), set(range(2005, 2027)))

    def test_every_question_is_usable_but_unscored(self):
        for row in self.rows:
            self.assertTrue(row["stem_latex"].strip())
            self.assertTrue(row["answer_latex"].strip())
            self.assertTrue(row["knowledge"])
            self.assertIsNotNone(row["score_x2"])
            self.assertIn(row["score_status"], {"derived", "third_party_reference"})
            self.assertFalse(row["needs_model_latex"])

    def test_every_year_totals_150(self):
        audit = json.loads((PILOT.parent / "score-audit.json").read_text(encoding="utf-8"))
        self.assertEqual(len(audit), 22)
        self.assertTrue(all(row["total_points"] == 150 for row in audit.values()))

    def test_choice_options(self):
        for row in self.rows:
            if row["section"] == "choice":
                self.assertEqual(len(row["options_json"] or []), 4)

    def test_rubric_points_are_derived_from_question_scores(self):
        self.assertGreater(self.audit["rubric_steps"], 300)
        for row in self.rows:
            rubric = row["rubric_draft"]
            self.assertEqual(rubric["max_score_x2"], row["score_x2"])
            steps = rubric["steps"]
            if steps:
                self.assertEqual(sum(step["points_x2"] for step in steps), row["score_x2"])
                self.assertEqual(rubric["status"], "derived_points")


if __name__ == "__main__":
    unittest.main()
