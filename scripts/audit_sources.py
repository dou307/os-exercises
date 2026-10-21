"""只读审计上游快照和笔记目录，调查结果写到本项目 docs/audit。

python scripts/audit_sources.py --notes-root "D:\\desk\\Obsidian\\1大三秋冬\\OS"
依赖：beautifulsoup4。此脚本不是正式题目转换器，也不会修改笔记或上游文件。
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "vendor" / "kaoyan-408-os"
MIRROR = ROOT / "_work" / "upstream.git"
AUDIT = ROOT / "docs" / "audit"


def git(*args):
    return subprocess.check_output(
        ["git", f"--git-dir={MIRROR}", *args]
    )


def dump(name, value):
    (AUDIT / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes-root", type=Path, required=True)
    args = parser.parse_args()
    AUDIT.mkdir(parents=True, exist_ok=True)

    commit = git("rev-parse", "HEAD").decode().strip()
    entries = []
    for record in git("ls-tree", "-rz", "HEAD").split(b"\0"):
        if not record:
            continue
        meta, raw_path = record.split(b"\t", 1)
        mode, kind, blob = meta.decode().split()
        rel = raw_path.decode("utf-8")
        data = (UPSTREAM / rel).read_bytes()
        calculated = hashlib.sha1(
            b"blob " + str(len(data)).encode() + b"\0" + data
        ).hexdigest()
        if kind != "blob" or calculated != blob:
            raise ValueError(f"上游快照与 Git 对象不符：{rel}")
        entries.append({"path": rel, "git_blob": blob,
                        "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    actual = {p.relative_to(UPSTREAM).as_posix()
              for p in UPSTREAM.rglob("*") if p.is_file()}
    if actual != {e["path"] for e in entries}:
        raise ValueError("上游快照的文件集合不符")

    questions = []
    chapters = []
    external_assets = set()
    for page in sorted(UPSTREAM.rglob("*.html")):
        soup = BeautifulSoup(page.read_text(encoding="utf-8"), "html.parser")
        for tag in soup.select("script[src],link[href],img[src]"):
            url = tag.get("src") or tag.get("href")
            if url.startswith(("http://", "https://", "//")):
                external_assets.add(url)

    for page in sorted(UPSTREAM.glob("ch*/quiz.html")):
        soup = BeautifulSoup(page.read_text(encoding="utf-8"), "html.parser")
        article = soup.select_one("article")
        heading = None
        question_heading = None
        section_counts = Counter()
        chapter_questions = []
        for element in article.find_all(["h2", "h3", "details"]):
            if element.name == "h2":
                heading = element
                question_heading = None
                continue
            if element.name == "h3":
                question_heading = element
                continue
            if "qa" not in element.get("class", []):
                continue
            if heading is None:
                raise ValueError(f"题目缺少所属章节：{page}")
            section_id = heading.get("id")
            section_counts[section_id] += 1
            container = element.find_parent("div", class_="q")
            if container:
                title_node = container.find("p")
            elif question_heading is not None:
                title_node = question_heading
            else:
                title_node = element.find_previous("p")
            title = title_node.get_text(" ", strip=True) if title_node else ""
            answer = element.select_one(".answer-tag")
            answer_text = answer.get_text(" ", strip=True) if answer else ""
            single = bool(re.fullmatch(r"答案[：:]\s*[A-D]", answer_text))
            preliminary_id = (
                f"wd27-{page.parent.name}-{section_id}"
                f"-q{section_counts[section_id]:03d}"
            )
            item = {
                "provisional_id": preliminary_id,
                "source_path": page.relative_to(UPSTREAM).as_posix(),
                "source_section_id": section_id,
                "source_section_title": heading.get_text(" ", strip=True),
                "source_question_heading_id": question_heading.get("id")
                    if question_heading is not None and container is None else None,
                "source_question_label": (re.search(r"第\s*\d+\s*题", title).group()
                                          if re.search(r"第\s*\d+\s*题", title) else None),
                "title_preview": title[:220],
                "has_q_wrapper": container is not None,
                "answer_present": answer is not None,
                "simple_single_letter_answer": single,
                "answer_block_sha256": hashlib.sha256(
                    str(element).encode("utf-8")).hexdigest(),
            }
            chapter_questions.append(item)
            questions.append(item)
        chapters.append({
            "chapter": page.parent.name,
            "question_blocks": len(chapter_questions),
            "q_wrappers": len(article.select("div.q")),
            "single_letter_answers": sum(q["simple_single_letter_answer"]
                                         for q in chapter_questions),
            "sections": dict(section_counts),
        })
    if len({q["provisional_id"] for q in questions}) != len(questions):
        raise ValueError("调查题目 ID 重复")
    if not all(q["answer_present"] for q in questions):
        raise ValueError("存在未提取到答案标签的题目")

    notes = []
    for note in args.notes_root.glob("*.md"):
        match = re.match(r"^(\d+(?:\.\d+)?)-", note.name)
        if not match:
            continue
        raw = note.read_bytes()
        headings = []
        fence = None
        for number, line in enumerate(raw.decode("utf-8-sig").splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith(("```", "~~~")):
                marker = stripped[:3]
                fence = None if fence == marker else marker if fence is None else fence
                continue
            if fence is not None:
                continue
            h = re.match(r"^(#{1,3})\s+(.+)$", line)
            if h:
                headings.append({"level": len(h[1]), "text": h[2], "line": number})
        notes.append({"chapter_key": match[1], "file": note.name,
                      "sha256": hashlib.sha256(raw).hexdigest(),
                      "headings": headings})
    notes.sort(key=lambda n: tuple(int(x) for x in n["chapter_key"].split(".")))

    summary = {
        "audited_on": "2026-10-21",
        "upstream_repository": "https://github.com/jlshdsdk/kaoyan-408-os",
        "upstream_commit": commit,
        "upstream_commit_count": int(git("rev-list", "--all", "--count")),
        "vendor_file_count": len(entries),
        "vendor_total_bytes": sum(e["bytes"] for e in entries),
        "vendor_matches_git_blobs": True,
        "html_files": sum(e["path"].endswith(".html") for e in entries),
        "image_files": sum(e["path"].endswith(".png") for e in entries),
        "license_files": [e["path"] for e in entries
                          if Path(e["path"]).name.lower().startswith(("license", "copying"))],
        "question_blocks": len(questions),
        "q_wrappers": sum(c["q_wrappers"] for c in chapters),
        "single_letter_answer_blocks": sum(q["simple_single_letter_answer"] for q in questions),
        "chapters": chapters,
        "local_note_chapters": len(notes),
        "local_note_framework_only_not_learning_progress": True,
        "external_asset_urls": sorted(external_assets),
        "file_manifest": entries,
    }
    dump("source-inventory.json", summary)
    dump("notes-outline.json", {"note_count": len(notes), "chapters": notes})
    dump("question-catalog.json", {"status": "inventory_only_not_adapted_question_data",
                                   "upstream_commit": commit, "count": len(questions),
                                   "questions": questions})
    print(json.dumps({k: summary[k] for k in ["upstream_commit", "vendor_file_count",
          "vendor_matches_git_blobs", "question_blocks", "q_wrappers",
          "single_letter_answer_blocks", "local_note_chapters"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
