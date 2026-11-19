import json
import unittest
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "output"
STEMS = OUTPUT / "reconstructed-2026.jsonl"
ANSWERS = OUTPUT / "reconstructed-answers-2026.jsonl"


@unittest.skipUnless(STEMS.exists() and ANSWERS.exists(), "run reconstruct_latex.py and reconstruct_answers.py first")
class ReconstructionPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stems = [json.loads(line) for line in STEMS.read_text(encoding="utf-8").splitlines() if line.strip()]
        cls.answers = [json.loads(line) for line in ANSWERS.read_text(encoding="utf-8").splitlines() if line.strip()]

    def test_2026_has_all_questions(self):
        self.assertEqual(len(self.stems), 22)
        self.assertTrue(all(row["stem_latex"].strip() for row in self.stems))

    def test_choice_options_and_parts(self):
        with_options = [row for row in self.stems if row.get("options")]
        self.assertEqual(len(with_options), 10)
        self.assertTrue(all(len(row["options"]) == 4 for row in with_options))
        self.assertEqual(sum(1 for row in self.stems if row.get("parts")), 1)

    def test_answers_are_normalized(self):
        self.assertEqual(len(self.answers), 12)
        for row in self.answers:
            self.assertNotIn("\(", row["answer_latex"])
            self.assertIn("$", row["answer_latex"])


if __name__ == "__main__":
    unittest.main()
