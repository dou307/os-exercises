#!/usr/bin/env python3
"""P1：校验提取结果的完整性与可追溯性。

不是"JSON 能加载"式检查，而是逐项对照来源：

* 数量：760 题块、分章数量、645/5/110 题型分布、47 道无 ``.q`` 容器题。
* 身份：ID 唯一、与登记表一致、内容哈希一致。
* 内容：题干与答案文本必须能在来源文件中按去空白方式匹配到（防截断、防编造）。
* 安全：正文不含脚本、事件属性、外链资源与 ``<details>`` 残留。
* 回归：与 ``tests/fixtures/samples/`` 的真实复杂样本逐字段一致。
* 来源：vendor 文件字节未被改动。
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "kaoyan-408-os"
DATA = ROOT / "data"
FIXTURES = ROOT / "tests" / "fixtures"
REPORTS = ROOT / "_work" / "reports"

EXPECTED = {
    "total": 760,
    "perChapter": {"ch1": 88, "ch2": 276, "ch3": 166, "ch4": 110, "ch5": 120},
    "single_choice": 645,
    "multi_blank": 5,
    "constructed_response": 110,
    "withoutQContainer": 47,
    "ch1Choice": 86,
    "ch1Constructed": 2,
}

MULTI_BLANK_IDS = {
    "c1-s2-0-q013",
    "c2-s1-0-q022",
    "c2-s2-0-q016",
    "c2-s3-0-q031",
    "c3-s1-0-q034",
}

FORBIDDEN_PATTERNS = [
    (re.compile(r"<script", re.I), "含 <script>"),
    (re.compile(r"<details", re.I), "含 <details> 残留"),
    (re.compile(r"\son[a-z]+\s*=", re.I), "含事件属性"),
    (re.compile(r"javascript:", re.I), "含 javascript: 链接"),
    (re.compile(r'(?:src|href)="https?://', re.I), "引用外部资源"),
    (re.compile(r"<iframe", re.I), "含 iframe"),
]

errors: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def norm(text: str) -> str:
    """去掉全部空白，用于来源文本匹配。

    来源一侧先用 BeautifulSoup 取纯文本：这样真实标签被丢弃、``&lt;`` 被还原成 ``<``，
    与已提取的纯文本处于同一形态，不会把 ``<P0, P2>`` 这种正文误当成标签删掉。
    """
    return re.sub(r"\s+", "", text)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def check_counts(data: dict) -> None:
    questions = data["questions"]
    if len(questions) != EXPECTED["total"]:
        fail(f'题目总数 {len(questions)} ≠ {EXPECTED["total"]}')
    per_chapter = Counter(q["chapter"] for q in questions)
    for chapter, expected in EXPECTED["perChapter"].items():
        if per_chapter.get(chapter, 0) != expected:
            fail(f"{chapter} 题数 {per_chapter.get(chapter, 0)} ≠ {expected}")
    by_type = Counter(q["type"] for q in questions)
    for qtype in ("single_choice", "multi_blank", "constructed_response"):
        if by_type.get(qtype, 0) != EXPECTED[qtype]:
            fail(f"题型 {qtype} 数量 {by_type.get(qtype, 0)} ≠ {EXPECTED[qtype]}")
    no_container = [q for q in questions if not q["source"]["hasQContainer"]]
    if len(no_container) != EXPECTED["withoutQContainer"]:
        fail(f'无 .q 容器题 {len(no_container)} ≠ {EXPECTED["withoutQContainer"]}')
    ch1 = [q for q in questions if q["chapter"] == "ch1"]
    ch1_choice = [q for q in ch1 if q["type"] != "constructed_response"]
    ch1_constructed = [q for q in ch1 if q["type"] == "constructed_response"]
    if len(ch1_choice) != EXPECTED["ch1Choice"]:
        fail(f'第一章选择题 {len(ch1_choice)} ≠ {EXPECTED["ch1Choice"]}')
    if len(ch1_constructed) != EXPECTED["ch1Constructed"]:
        fail(f'第一章综合题 {len(ch1_constructed)} ≠ {EXPECTED["ch1Constructed"]}')
    notes.append(f"分章题数 {dict(per_chapter)}")
    notes.append(f"题型分布 {dict(by_type)}；无 .q 容器 {len(no_container)} 道")


def check_specials(data: dict) -> None:
    specials = {q["id"] for q in data["questions"] if q["type"] == "multi_blank"}
    if specials != MULTI_BLANK_IDS:
        fail(f"多空/特殊题集合不符：多 {sorted(specials - MULTI_BLANK_IDS)}，少 {sorted(MULTI_BLANK_IDS - specials)}")
    for q in data["questions"]:
        if q["type"] == "multi_blank":
            if q["options"]:
                fail(f'{q["id"]} 多空题不应生成单选项数组')
            if not q["optionBlocks"]:
                fail(f'{q["id"]} 多空题缺少原始选项块')
            if not q["originalAnswer"]:
                fail(f'{q["id"]} 多空题缺少答案文本')
    notes.append("5 道特殊题均保留原始选项块且不生成自动判分字段")


def check_ids(data: dict, registry: dict) -> None:
    ids = [q["id"] for q in data["questions"]]
    if len(ids) != len(set(ids)):
        dupes = [i for i, c in Counter(ids).items() if c > 1]
        fail(f"ID 重复：{dupes[:5]}")
    entries = {e["id"]: e for e in registry["entries"]}
    if len(entries) != len(registry["entries"]):
        fail("登记表内 ID 重复")
    for q in data["questions"]:
        entry = entries.get(q["id"])
        if entry is None:
            fail(f'{q["id"]} 不在登记表中')
            continue
        if entry["contentHash"] != q["source"]["contentHash"]:
            fail(f'{q["id"]} 内容哈希与登记表不一致')
        if entry["path"] != q["source"]["path"]:
            fail(f'{q["id"]} 来源路径与登记表不一致')
        if entry.get("status") != "active":
            fail(f'{q["id"]} 登记表状态为 {entry.get("status")}')
    notes.append(f"ID 唯一且与登记表一致：{len(entries)} 条")


def check_question_shape(data: dict) -> None:
    for q in data["questions"]:
        qid = q["id"]
        for key in ("id", "type", "chapter", "source", "stemHtml", "stemText", "originalAnswer",
                    "originalExplanationHtml", "answerFormat", "assets", "reviewStatus"):
            if key not in q:
                fail(f"{qid} 缺少字段 {key}")
        if not q["stemText"].strip():
            fail(f"{qid} 题干为空")
        if not q["originalAnswer"]:
            fail(f"{qid} 缺少答案")
        if not q["originalExplanationHtml"].strip():
            fail(f"{qid} 缺少解析")
        if q["type"] == "single_choice":
            keys = [o["key"] for o in q["options"]]
            if keys != [chr(ord("A") + i) for i in range(len(keys))] or len(keys) < 4:
                fail(f"{qid} 选项键异常：{keys}")
            if q["originalAnswer"] not in keys:
                fail(f"{qid} 答案 {q['originalAnswer']} 不在选项 {keys} 中")
        elif q["type"] == "constructed_response":
            if q["options"] or q["optionBlocks"]:
                fail(f"{qid} 综合题不应含选项")
        if q["reviewStatus"] not in ("unreviewed", "verified", "disputed", "corrected", "unresolved"):
            fail(f"{qid} 审核状态非法：{q['reviewStatus']}")
    notes.append("每题字段完整、答案与解析非空、单选选项键连续且包含答案")


def check_sanitized(data: dict) -> None:
    hits = 0
    for q in data["questions"]:
        payload = q["stemHtml"] + q["originalExplanationHtml"] + "".join(
            b["rawHtml"] for b in q.get("optionBlocks", [])
        )
        for pattern, label in FORBIDDEN_PATTERNS:
            if pattern.search(payload):
                fail(f'{q["id"]} {label}')
                hits += 1
    if hits == 0:
        notes.append("正文无脚本、事件属性、外链资源与 details 残留")


def check_source_fidelity(data: dict) -> None:
    cache: dict[str, str] = {}
    for q in data["questions"]:
        path = VENDOR / q["source"]["path"]
        if q["source"]["path"] not in cache:
            soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
            cache[q["source"]["path"]] = norm(soup.find("article").get_text(""))
        source = cache[q["source"]["path"]]
        stem_key = norm(q["stemText"])[:60]
        if stem_key and stem_key not in source:
            fail(f'{q["id"]} 题干前 60 字无法在来源中定位（可能被截断或改写）')
        answer_key = norm(q["originalAnswer"])[:30]
        if answer_key and answer_key not in source:
            fail(f'{q["id"]} 答案文本无法在来源中定位')
    # 每文件题数必须与来源中 details.qa 数量一致
    per_file = Counter(q["source"]["path"] for q in data["questions"])
    for path, count in per_file.items():
        soup = BeautifulSoup((VENDOR / path).read_text(encoding="utf-8"), "lxml")
        qa_count = len(soup.find("article").find_all("details", class_="qa"))
        if qa_count != count:
            fail(f"{path} 题块数 {count} ≠ 来源 details.qa 数 {qa_count}")
    notes.append("每题题干与答案均可在来源中定位；每文件题数与 details.qa 数一致")


def check_vendor_integrity(registry: dict) -> None:
    for entry in registry["files"]:
        path = VENDOR / entry["path"]
        if not path.exists():
            fail(f"vendor 文件缺失：{entry['path']}")
            continue
        raw = path.read_bytes()
        if len(raw) != entry["bytes"]:
            fail(f"{entry['path']} 字节数变化：{len(raw)} ≠ {entry['bytes']}")
        if sha256_bytes(raw) != entry["sha256"]:
            fail(f"{entry['path']} sha256 与登记表不一致")
    notes.append(f"vendor {len(registry['files'])} 个习题文件字节与登记表一致")


def check_fixtures(data: dict) -> None:
    index_path = FIXTURES / "index.json"
    if not index_path.exists():
        fail("缺少 tests/fixtures/index.json")
        return
    index = load_json(index_path)
    by_id = {q["id"]: q for q in data["questions"]}
    for sample in index["samples"]:
        qid = sample["id"]
        fixture_path = FIXTURES / "samples" / f"{qid}.json"
        if not fixture_path.exists():
            fail(f"缺少固定样本 {qid}.json")
            continue
        expected = load_json(fixture_path)
        actual = by_id.get(qid)
        if actual is None:
            fail(f"固定样本 {qid} 在数据集中不存在")
            continue
        # reviewStatus 属于后续映射审核结论，不属于提取结果，不参与回归比对
        expected_core = {k: v for k, v in expected.items() if k != "reviewStatus"}
        actual_core = {k: v for k, v in actual.items() if k != "reviewStatus"}
        if expected_core != actual_core:
            diff = [k for k in expected_core if expected_core[k] != actual_core.get(k)]
            fail(f"固定样本 {qid} 与当前提取不一致，字段：{diff}")
    notes.append(f"固定样本 {index['count']} 个逐字段一致")


def check_duplicates(data: dict) -> None:
    hashes = Counter(q["source"]["contentHash"] for q in data["questions"])
    dupes = [(h, c) for h, c in hashes.items() if c > 1]
    if dupes:
        notes.append(f"提示：{len(dupes)} 组内容完全相同的题块（按来源保留，未去重）")


def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    data = load_json(DATA / "questions.json")
    registry = load_json(DATA / "source-registry.json")

    check_counts(data)
    check_specials(data)
    check_ids(data, registry)
    check_question_shape(data)
    check_sanitized(data)
    check_source_fidelity(data)
    check_vendor_integrity(registry)
    check_fixtures(data)
    check_duplicates(data)

    report = {"ok": not errors, "errors": errors, "notes": notes}
    (REPORTS / "validate-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    for note in notes:
        print("✓", note)
    if errors:
        print(f"\n校验失败，共 {len(errors)} 项：")
        for err in errors[:40]:
            print(" ✗", err)
        if len(errors) > 40:
            print(f" ……其余 {len(errors) - 40} 项见 _work/reports/validate-report.json")
        return 1
    print("\n全部校验通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
