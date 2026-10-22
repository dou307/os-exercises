"""来源位置变化不能串题；仅在内存中构造变动，不改 vendor 或题库。"""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from import_questions import apply_registry, locator_for


class StableRegistry(unittest.TestCase):
    def fixture(self):
        questions = []
        for i in (1, 2):
            questions.append({"id": f"c1-s{i}-0-q001", "source": {
                "path": "ch1/quiz.html", "sectionId": f"toc-{i}", "subsectionId": None,
                "originalLabel": "第 1 题", "contentHash": f"sha256:question-{i}",
            }})
        registry = {"entries": []}
        apply_registry(questions, registry)
        return questions, registry

    def test_locked_dataset_reimport_keeps_every_id(self):
        questions = json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["questions"]
        registry = json.loads((ROOT / "data/source-registry.json").read_text(encoding="utf-8"))
        expected = [(q["id"], q["source"]["contentHash"]) for q in questions]
        apply_registry(questions, registry)
        self.assertEqual(expected, [(q["id"], q["source"]["contentHash"]) for q in questions])
        self.assertFalse(registry["retired"])

    def test_swapped_source_positions_keep_content_ids(self):
        qs, reg = self.fixture()
        ids = [q["id"] for q in qs]
        qs[0]["source"]["sectionId"], qs[1]["source"]["sectionId"] = qs[1]["source"]["sectionId"], qs[0]["source"]["sectionId"]
        apply_registry(qs, reg)
        self.assertEqual(ids, [q["id"] for q in qs])
        self.assertEqual(2, len(reg["relocations"]))
        self.assertEqual([locator_for(q) for q in qs], [e["locator"] for e in reg["entries"]])

    def test_changed_content_requires_review_and_does_not_mutate_registry(self):
        qs, reg = self.fixture()
        before = copy.deepcopy(reg)
        qs[0]["source"]["contentHash"] = "sha256:changed"
        with self.assertRaisesRegex(ValueError, "内容已变化"):
            apply_registry(qs, reg)
        self.assertEqual(before, reg)

    def test_deleted_question_can_reappear_and_become_active(self):
        qs, reg = self.fixture()
        apply_registry(qs[1:], reg)
        self.assertEqual([qs[0]["id"]], reg["retired"])
        apply_registry(qs, reg)
        self.assertFalse(reg["retired"])
        self.assertTrue(all(e["status"] == "active" for e in reg["entries"]))


if __name__ == "__main__":
    unittest.main()
