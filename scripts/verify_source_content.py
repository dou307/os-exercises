#!/usr/bin/env python3
"""独立于导入器，逐题核对全部正文字符、完整解析及表格/代码/公式结构。

从每个 details.qa 向前找题干边界，不复用 import_questions 的扫描与构建函数。
题干和选项拆分后顺序不同，用全文非空白字符计数守恒检查丢失/重复；解析、
表格单元格、代码块和公式另按原始顺序逐项相等检查，避免仅总数相同却错位。
不修改 vendor、数据和固定样本。此检查不判断原答案的学术正确性。
"""
from __future__ import annotations

import copy
import json
import re
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup, Tag

ROOT = Path(__file__).resolve().parents[1]
LABEL = re.compile(r"^第\s*\d+\s*题")
OPTION = re.compile(r"(?<![A-Za-z0-9])([A-H])[.．、]\s*")


def norm(text: str) -> str:
    return re.sub(r"\s+", "", text)


def html_text(fragment: str) -> str:
    return BeautifulSoup(fragment, "html.parser").get_text("")


def source_body(qa: Tag) -> Tag:
    wrapper = qa.find_parent("div", class_="q")
    if wrapper:
        return copy.copy(wrapper)
    nodes = [qa]
    for sibling in qa.previous_siblings:
        if not isinstance(sibling, Tag):
            continue
        if sibling.name in ("h2", "h3", "details"):
            break
        nodes.insert(0, sibling)
        strong = sibling.find("strong", recursive=False)
        if strong and LABEL.match(strong.get_text(" ", strip=True)):
            break
    root = BeautifulSoup("", "html.parser").new_tag("div")
    for node in nodes:
        root.append(copy.copy(node))
    return root


def structures(root: Tag) -> dict:
    result = {}
    for tag in ("table", "pre", "code"):
        result[tag] = [norm(node.get_text("")) for node in root.find_all(tag)]
    result["cells"] = [(node.name, node.get("colspan", "1"), node.get("rowspan", "1"),
                       norm(node.get_text(""))) for node in root.find_all(["th", "td"])]
    result["images"] = [(node.get("src"), node.get("alt", "")) for node in root.find_all("img")]
    result["formulas"] = re.findall(r"\\\((.*?)\\\)|\\\[(.*?)\\\]", norm(root.get_text("")), re.S)
    return result


def verify(questions: list[dict]) -> dict:
    errors = []
    checked = 0
    for chapter in ("ch1", "ch2", "ch3", "ch4", "ch5"):
        source = ROOT / "vendor" / "kaoyan-408-os" / chapter / "quiz.html"
        soup = BeautifulSoup(source.read_bytes(), "lxml")
        answers = soup.select("article details.qa")
        items = [q for q in questions if q["chapter"] == chapter]
        if len(answers) != len(items):
            errors.append(f"{chapter}: 来源与数据题数不相等")
            continue
        for qa, q in zip(answers, items):
            body = source_body(qa)
            # 题号不是题干，已作为 source.originalLabel 单独保留。
            for tag in list(body.find_all("strong")):
                if LABEL.match(tag.get_text(" ", strip=True)):
                    tag.decompose()
            detail = body.find("details", class_="qa")
            explanation = copy.copy(detail.select_one(".qa-body"))
            answer = explanation.select_one(".answer-tag")
            if answer is None:
                errors.append(f"{q['id']}: 来源答案标签不存在")
                continue
            source_answer = re.sub(r"^答案\s*[:：]\s*", "", answer.get_text(" ", strip=True))
            answer.decompose()
            if norm(source_answer) != norm(q["originalAnswer"]):
                errors.append(f"{q['id']}: 完整答案不同")
            if norm(explanation.get_text("")) != norm(html_text(q["originalExplanationHtml"])):
                errors.append(f"{q['id']}: 完整解析不同")
            detail.decompose()
            stem_text = body.get_text("")
            if q["type"] == "single_choice":
                # 选项 A. 等被转换为结构化 key；仅从原选项段移除这些标记。
                for mono in body.select("p.mono"):
                    if re.match(r"\s*A[.．、]", mono.get_text("\n")):
                        mono.string = OPTION.sub("", mono.get_text("\n"))
                stem_text = body.get_text("")
            exported_stem = q["stemHtml"] + "".join(o["html"] for o in q["options"]) + "".join(b["rawHtml"] for b in q["optionBlocks"])
            if Counter(norm(stem_text)) != Counter(norm(html_text(exported_stem))):
                missing = Counter(norm(stem_text)) - Counter(norm(html_text(exported_stem)))
                extra = Counter(norm(html_text(exported_stem))) - Counter(norm(stem_text))
                errors.append(f"{q['id']}: 题干/选项字符不守恒，缺少 {dict(missing)}，多出 {dict(extra)}")
            combined_source = BeautifulSoup(str(body) + str(explanation), "html.parser")
            combined_output = BeautifulSoup(exported_stem + q["originalExplanationHtml"], "html.parser")
            if structures(combined_source) != structures(combined_output):
                errors.append(f"{q['id']}: 表格/代码/公式/图片的内容或结构不同")
            checked += 1
    return {"ok": not errors, "checked": checked, "errors": errors,
            "scope": "完整正文字符守恒、完整答案和解析、顺序化表格单元格/代码/公式/图片；不判定答案正确性"}


if __name__ == "__main__":
    questions = json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["questions"]
    report = verify(questions)
    dest = ROOT / "_work/reports/source-content-report.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"完整内容核对：{report['checked']} 道，发现 {len(report['errors'])} 项差异")
    for error in report["errors"][:15]:
        print(error)
    raise SystemExit(0 if report["ok"] else 1)
