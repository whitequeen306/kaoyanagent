import sys
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE))

from extract_pdf import extract_document
from segment import segment_document

ROOT = PIPELINE.parent


class SamplePipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {}
        for year in (2005, 2009, 2021, 2026):
            pdf = ROOT / "数学二" / f"{year}年考研数学二真题（试卷）.pdf"
            document = extract_document(pdf)
            cls.results[year] = segment_document(document)

    def test_expected_question_counts(self):
        self.assertEqual(len(self.results[2005]), 23)
        self.assertEqual(len(self.results[2009]), 23)
        self.assertEqual(len(self.results[2021]), 22)
        self.assertEqual(len(self.results[2026]), 22)

    def test_every_question_has_source_and_hash(self):
        for year, questions in self.results.items():
            for question in questions:
                self.assertTrue(question["stem_draft"], f"{year} {question['seq_label']}")
                self.assertTrue(question["source_spans"])
                self.assertEqual(len(question["content_hash"]), 64)
                self.assertTrue(question["needs_model_latex"])

    def test_big_question_with_parts_kept_as_one_question(self):
        last = [q for q in self.results[2026] if q["has_parts"]]
        self.assertEqual(len(last), 1)
        self.assertEqual([item["label"] for item in last[0]["parts_draft"]], ["(1)", "(2)"])
        self.assertIn("极大线性无关组", last[0]["stem_draft"])

    def test_cross_page_question_is_retained(self):
        cross_page = [q for q in self.results[2009] if len(q["source_pages"]) > 1]
        self.assertGreaterEqual(len(cross_page), 1)


if __name__ == "__main__":
    unittest.main()
