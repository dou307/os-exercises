#!/usr/bin/env python3
"""把数据与前端资源组装成可运行的静态站点 ``dist/``。

``dist/`` 是可重建产物，不提交；所有输入都在仓库内（``data/``、``app/``、``vendor/``）。

产物结构：

    dist/
    ├─ index.html / styles.css / js/…      前端应用
    ├─ data/meta.json                      章节、题量、学习默认值
    ├─ data/index.json                     全库轻量索引（搜索、错题、统计）
    ├─ data/questions/ch1.json …           按主归属章节切分的完整题目
    ├─ data/topics.json / errata.json
    └─ vendor/kaoyan-408-os/               原题库快照（原站阅读入口）
    └─ vendor/katex/                       本地公式渲染资源
"""

from __future__ import annotations

import json
import shutil
import sys
from collections import Counter, OrderedDict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
APP = ROOT / "app"
VENDOR = ROOT / "vendor" / "kaoyan-408-os"
DIST = ROOT / "dist"

TIER_LABELS = {
    "core": "核心",
    "bridge": "桥接",
    "later": "稍后",
    "supplement": "补充",
    "disputed": "争议",
}

# 上游页面统一从 jsDelivr 加载 KaTeX；构建时改写为本地相对路径，保证断网可用。
# 注意：只改 dist 副本，vendor/ 快照保持原始字节。
CDN_REWRITES = [
    ("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css", "katex.min.css"),
    ("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js", "katex.min.js"),
    ("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js", "auto-render.min.js"),
]


def localize_vendor_pages(target_root: Path) -> int:
    """把 dist 内上游页面的 CDN 公式资源改成相对路径，返回改写的文件数。"""
    rewritten = 0
    for path in target_root.rglob("*.html"):
        rel = path.relative_to(target_root)
        prefix = "../" * len(rel.parts)  # 回到 dist/vendor/
        raw = path.read_bytes().decode("utf-8")
        updated = raw
        for url, filename in CDN_REWRITES:
            updated = updated.replace(url, f"{prefix}katex/{filename}")
        if updated != raw:
            path.write_bytes(updated.encode("utf-8"))
            rewritten += 1
    return rewritten


def load_local_config() -> dict:
    """读取本机笔记路径配置；缺失或格式错误时返回空，不硬编码 vault 名称。"""
    path = ROOT / "config.local.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("顶层不是对象")
        return data
    except (json.JSONDecodeError, ValueError, OSError) as error:
        print(f"  警告：config.local.json 无法解析（{error}），笔记链接保持关闭。")
        return {}


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def main() -> int:
    questions_doc = load("questions.json")
    mappings_doc = load("mappings.json")
    chapters_doc = load("chapters.json")
    topics_doc = load("topics.json")
    study = load("study-defaults.json")
    errata = load("overrides/errata.json")

    errata_by_q: dict[str, list[dict]] = {}
    for entry in errata["entries"]:
        errata_by_q.setdefault(entry["questionId"], []).append(entry)

    questions = []
    for q in questions_doc["questions"]:
        m = mappings_doc["byQuestion"][q["id"]]
        merged = OrderedDict(q)
        merged["primaryChapterId"] = m["primaryChapterId"]
        merged["secondaryChapterIds"] = m.get("secondaryChapterIds", [])
        merged["topicIds"] = m.get("topicIds", [])
        merged["prerequisiteTopicIds"] = m.get("prerequisiteTopicIds", [])
        merged["readinessTier"] = m["readinessTier"]
        merged["mappingStatus"] = m["mappingStatus"]
        merged["mappingReason"] = m["mappingReason"]
        merged["reviewStatus"] = m.get("reviewStatus", "unreviewed")
        merged["errata"] = errata_by_q.get(q["id"], [])
        merged["scoring"] = (
            "excluded"
            if any(e.get("scoring") == "excluded" for e in merged["errata"])
            else ("self_assess" if q["type"] == "constructed_response" else "auto")
        )
        questions.append(merged)

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "data" / "questions").mkdir(parents=True)

    # ---- 前端资源 ----
    for name in ("index.html", "styles.css"):
        shutil.copy2(APP / name, DIST / name)
    shutil.copytree(APP / "js", DIST / "js")
    shutil.copytree(APP / "vendor", DIST / "vendor")
    shutil.copytree(VENDOR, DIST / "vendor" / "kaoyan-408-os")
    localized = localize_vendor_pages(DIST / "vendor" / "kaoyan-408-os")

    # ---- 数据 ----
    by_chapter: dict[str, list[dict]] = {}
    for q in questions:
        by_chapter.setdefault(q["primaryChapterId"] or "unmapped", []).append(q)

    for chapter_id, items in by_chapter.items():
        payload = {
            "chapterId": chapter_id,
            "datasetVersion": questions_doc["datasetVersion"],
            "questions": items,
        }
        (DIST / "data" / "questions" / f"{chapter_id}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )

    chapter_meta = []
    for chapter in chapters_doc["chapters"]:
        items = by_chapter.get(chapter["id"], [])
        tiers = Counter(q["readinessTier"] for q in items)
        statuses = Counter(q["reviewStatus"] for q in items)
        chapter_meta.append(
            {
                "id": chapter["id"],
                "order": chapter["order"],
                "kind": chapter["kind"],
                "title": chapter["title"],
                "titleZh": chapter["titleZh"],
                "file": chapter["file"],
                "topicIds": chapter["topicIds"],
                "counts": {
                    "total": len(items),
                    "core": tiers.get("core", 0),
                    "bridge": tiers.get("bridge", 0),
                    "later": tiers.get("later", 0),
                    "supplement": tiers.get("supplement", 0),
                    "disputed": statuses.get("disputed", 0),
                    "systematic": statuses.get("systematic", 0),
                    "unreviewed": statuses.get("unreviewed", 0) + statuses.get("systematic", 0),
                    "scored": sum(1 for q in items if q["scoring"] == "auto"),
                    "coreScored": sum(1 for q in items if q["scoring"] == "auto" and q["readinessTier"] == "core"),
                    "coreSelfAssess": sum(
                        1 for q in items if q["scoring"] == "self_assess" and q["readinessTier"] == "core"
                    ),
                },
            }
        )

    local_config = load_local_config()
    vault = (local_config.get("obsidianVault") or "").strip()
    notes_root = (local_config.get("notesRoot") or "").strip()
    meta = {
        "schemaVersion": 1,
        "datasetVersion": questions_doc["datasetVersion"],
        "generatedAt": date.today().isoformat(),
        "upstream": questions_doc["upstream"],
        "counts": questions_doc["counts"],
        "studyDefaults": study,
        "chapters": chapter_meta,
        "tierLabels": TIER_LABELS,
        "notes": {
            "configured": bool(vault),
            "vault": vault,
            "root": notes_root,
        },
    }
    (DIST / "data" / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )

    index_items = []
    for q in questions:
        index_items.append(
            {
                "id": q["id"],
                "ch": q["primaryChapterId"],
                "sec": q["source"]["sectionTitle"],
                "sub": q["source"]["subsectionTitle"],
                "label": q["source"]["originalLabel"],
                "type": q["type"],
                "tier": q["readinessTier"],
                "status": q["mappingStatus"],
                "review": q["reviewStatus"],
                "scoring": q["scoring"],
                "stem": q["stemText"][:180],
                "topics": q["topicIds"],
                "errata": len(q["errata"]),
                "answer": q["originalAnswer"],
            }
        )
    (DIST / "data" / "index.json").write_text(
        json.dumps({"datasetVersion": questions_doc["datasetVersion"], "questions": index_items}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    shutil.copy2(DATA / "topics.json", DIST / "data" / "topics.json")
    shutil.copy2(DATA / "overrides" / "errata.json", DIST / "data" / "errata.json")

    total_bytes = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"构建完成：dist/（{len(questions)} 道题，{len(by_chapter)} 个章节文件，{total_bytes / 1024 / 1024:.1f} MB）")
    print(f"  上游页面公式资源本地化：{localized} 个 HTML 文件")
    print(f"  笔记链接：{'已配置 ' + vault if vault else '未配置（config.local.json 缺失或未填 obsidianVault）'}")
    ch1 = next((c for c in chapter_meta if c["id"] == "1"), None)
    if ch1:
        print(f"  第一章：共 {ch1['counts']['total']} 道，核心 {ch1['counts']['core']}、桥接 {ch1['counts']['bridge']}、"
              f"补充 {ch1['counts']['supplement']}、争议 {ch1['counts']['disputed']}；"
              f"核心可自动判分 {ch1['counts']['coreScored']} 道 + 自评 {ch1['counts']['coreSelfAssess']} 道")
    return 0


if __name__ == "__main__":
    sys.exit(main())
