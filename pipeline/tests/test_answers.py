import json
import sys
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PIPELINE))

from align_answers import attach_answers, load_answer_keys
from extract_pdf import extract_document
from segment import segment_document

ROOT = PIPELINE.parent
ANSWERS = PIPELINE / "reference" / "all-math2-answers-20261108.pdf"


class AnswerAlignmentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.keys = load_answer_keys(ANSWERS)

    def test_2005_choice_numbers_are_continuous(self):
        choice = self.keys[2005]["choice"]
        self.assertEqual(list(choice), [str(number) for number in range(7, 15)])
        self.assertEqual(choice["7"], "C")

    def test_2021_modern_numbering(self):
        self.assertEqual(self.keys[2021]["choice"]["1"], "C")
        self.assertEqual(len(self.keys[2021]["blank"]), 6)
        self.assertEqual(len(self.keys[2021]["solution"]), 6)

    def test_2026_numeric_answers_are_not_lost(self):
        blank = self.keys[2026]["blank"]
        self.assertEqual(blank["13"], "4.")
        self.assertEqual(blank["16"], "2.")
        self.assertEqual(blank["12"], "1 2.")

    def test_printed_page_numbers_are_not_part_of_answers(self):
        self.assertFalse(self.keys[2005]["solution"]["23"].endswith(" 41"))
        self.assertFalse(self.keys[2021]["solution"]["22"].endswith(" 73"))
        self.assertFalse(self.keys[2026]["solution"]["22"].endswith(" 83"))

    def test_2026_all_22_questions_receive_answers(self):
        pdf = ROOT / "数学二" / "2026年考研数学二真题（试卷）.pdf"
        questions = segment_document(extract_document(pdf))
        attach_answers(questions, self.keys)
        self.assertEqual(len(questions), 22)
        self.assertTrue(all(question["answer_status"] == "aligned" for question in questions))
        self.assertTrue(all(question.get("answer_source") == "official" for question in questions))


if __name__ == "__main__":
    unittest.main()
