#!/usr/bin/env python3
"""校验逐图/年份证据覆盖及来源哈希，生成可追溯年份报告。"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    "archival_text_correspondence": "文字片段定位（非完整一致认证）",
    "archival_passage_located": "已读正文定位",
    "archival_page_located": "已看页图定位",
    "archival_variant": "存档题面数值有差异",
    "label_conflict": "来源年份存在反证",
}


def validate():
    load = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))
    questions = {q["id"]: q for q in load("data/questions.json")["questions"]}
    years = load("data/reviews/exam-years.json")
    rows = years["questions"]
    expected = {q["id"] for q in questions.values() if q.get("examYear")}
    assert len(rows) == len({r["questionId"] for r in rows}) == len(expected) == 176
    assert {r["questionId"] for r in rows} == expected
    archives = {str(a["year"]): a for a in years["archives"]}
    for row in rows:
        q = questions[row["questionId"]]
        assert row["sourceContentHash"] == q["source"]["contentHash"]
        assert row["labelledYear"] == q["examYear"]
        assert row["authorityVerified"] is False and q["examYearVerified"] is False
        assert row["status"] in LABELS
        archive = archives[row["archiveKey"]]
        assert archive["status"].startswith("retrieved")
        assert all(1 <= n <= archive["pages"] for n in row.get("archivePages", []))
        assert row["note"]
    images = load("docs/audit/image-review.json")
    records = images["images"] if isinstance(images, dict) else images
    assert len(records) == 135
    vendor = ROOT / "vendor/kaoyan-408-os"
    assert {r["path"] for r in records} == {p.relative_to(vendor).as_posix() for p in (vendor/"assets").rglob("*.png")}
    for row in records:
        assert hashlib.sha256((vendor/row["path"]).read_bytes()).hexdigest() == row["sha256"]
        assert row["visualStatus"] in ("viewed", "caption_crop", "source_crop")
        assert row["decoded"] and row["finding"]
    return years, records


def render(years):
    rows = years["questions"]
    counts = Counter(r["status"] for r in rows)
    lines = ["# 真题年份与存档卷交叉核查", "", "日期：2026-11-17。176条原标年份全部建档；2009—2025均取得公开存档，2014、2021—2025另有高校转存扫描/整理卷。", "",
        years["policy"], "",
        "这是证据分级的核查结果：片段定位不能替代完整题面、选项及附图逐字校勘；高校转存也不等于主管机构认证。下列44条已直接查看页图，22条已读对应正文，108条仅有文字片段对应，另有2条具体差异。", "",
        "## 已发现的差异", "",
        "- `c4-s2-0-q051`：来源标2022；同题见2009存档PDF第3页第31题。2022扫描卷OS选择部分第4—5页无此题。网站显示年份勘误，原标签与原题保留。",
        "- `c2-s2-0-q045`：2017存档PDF第3页第23题J2运行时间为3、J3到达时刻为1，本站分别为5和2；两个版本仍都选择J1、J3。网站提示数值差异，不把转存卷当作唯一正式版本。", "",
        "## 证据分级", "", "| 状态 | 条数 |", "|---|---:|"]
    lines += [f"| {LABELS[k]} | {v} |" for k,v in counts.items()]
    lines += ["", "## 全部逐题记录", "", "页码为下载PDF从1起算的页序，可能与纸面页码不同。来源URL、文件SHA-256及页数保存在 `data/reviews/exam-years.json` 的archives中；本地PDF留在忽略的 `_work/finalization/exam-papers/`。", "",
        "| ID | 原标年份 | 结论 | 存档 / PDF页 / 题号 |", "|---|---:|---|---|"]
    for r in rows:
        locator = str(r["archiveKey"])
        if r.get("archivePages"): locator += " / " + ",".join(map(str,r["archivePages"]))
        if r.get("archiveQuestionNumber"): locator += " / " + str(r["archiveQuestionNumber"])
        lines.append(f'| {r["questionId"]} | {r["labelledYear"]} | {LABELS[r["status"]]} | {locator} |')
    lines += ["", "## 存档来源", "", "[厦门工学院408历年资料目录](https://www.xit.edu.cn/yjsfk/kyzykwtkw/list.htm)。此目录提供公开题卷副本，并非考试命题机构发布。", ""]
    for a in years["archives"]:
        if a["status"].startswith("retrieved"): lines.append(f'- [{a["year"]}]({a["url"]})：{a["pages"]}页，SHA-256 `{a["sha256"]}`。')
    (ROOT/"docs/真题年份核查.md").write_text("\n".join(lines)+"\n",encoding="utf-8")


if __name__ == "__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--write-doc",action="store_true");args=parser.parse_args()
    years, images=validate()
    if args.write_doc:render(years)
    print(f"年份176条来源哈希/证据与135张插图台账覆盖通过；不代表官方认证或裁切已修复。")
