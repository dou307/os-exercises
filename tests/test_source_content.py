"""证明全文守卫能抓住旧“前 60 字定位”检查遗漏的实际内容损失。"""
import copy
import json
import sys
import unittest
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_source_content import verify


class ContentGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions = json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["questions"]

    def test_appended_stem_and_truncated_explanation_are_detected(self):
        qs = copy.deepcopy(self.questions)
        q = next(q for q in qs if len(q["stemText"]) > 400)
        q["stemHtml"] += "<p>不是原题的尾部文字</p>"
        other = next(item for item in qs if item["id"] != q["id"] and len(item["originalExplanationHtml"]) > 400)
        other["originalExplanationHtml"] = "<p>被截断的解析</p>"
        report = verify(qs)
        self.assertFalse(report["ok"])
        self.assertTrue(any(q["id"] in e and "字符不守恒" in e for e in report["errors"]))
        self.assertTrue(any(other["id"] in e and "完整解析不同" in e for e in report["errors"]))

    def test_swapped_table_cells_are_detected_despite_same_characters(self):
        qs = copy.deepcopy(self.questions)
        q = next(item for item in qs if item["id"] == "c1-s5-0-q001")
        body = BeautifulSoup(q["originalExplanationHtml"], "html.parser")
        cells = body.find_all("td")
        first = cells[0]
        second = next(cell for cell in cells[1:] if cell.get_text() != first.get_text())
        a, b = first.decode_contents(), second.decode_contents()
        first.clear(); first.append(BeautifulSoup(b, "html.parser"))
        second.clear(); second.append(BeautifulSoup(a, "html.parser"))
        q["originalExplanationHtml"] = str(body)
        report = verify(qs)
        self.assertFalse(report["ok"])
        self.assertTrue(any(q["id"] in e and "结构不同" in e for e in report["errors"]))


if __name__ == "__main__":
    unittest.main()
