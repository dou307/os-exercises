#!/usr/bin/env python3
"""P1：从锁定上游快照无损提取题目数据。

只读取 ``vendor/kaoyan-408-os/``（禁止写入），输出：

* ``data/questions.json``        —— 规范化题目实体，每题只存一份
* ``data/source-registry.json``  —— 稳定 ID 与来源定位、内容哈希的登记表

设计要点：

1. 不只用 ``.q`` 容器：还有 47 道综合题直接写在 ``<p><strong>第 N 题</strong>`` 或
   ``<h3>第 N 题…</h3>`` 之下，必须按边界扫描，否则会整段丢失。
2. 题干保留全部子问、表格、代码、公式与提示框；只剥离 ``details.qa``（答案解析）
   和真正的选项段落，其余按白名单清洗后原样保留。
3. ``Ⅰ./Ⅱ./Ⅲ.`` 陈述列表用的是 ``<p class="mono">``，不是选项，不能误当选项切分。
4. ID 首次分配后写入登记表；重跑时优先复用登记表中的 ID，内容哈希用于发现变更。
   上游重排导致定位变化时，若内容哈希完全一致，则沿用旧 ID 并记录迁移。
"""

from __future__ import annotations

import copy
import hashlib
import html as html_lib
import json
import re
import sys
from collections import Counter, OrderedDict
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "kaoyan-408-os"
DATA_DIR = ROOT / "data"
WORK_REPORTS = ROOT / "_work" / "reports"

SCHEMA_VERSION = 1
DATASET_VERSION = "2026-10-21.1"

UPSTREAM = {
    "repository": "jlshdsdk/kaoyan-408-os",
    "revision": "e360b96fbd6522656d633ad9e26b7dd91f7bd1b4",
    "snapshotPath": "vendor/kaoyan-408-os",
}

CHAPTERS = ["ch1", "ch2", "ch3", "ch4", "ch5"]

# 真实复杂样本：覆盖普通单选、独立综合题、H3 综合题、含表格/公式/代码题与全部 5 道特殊题。
FIXTURE_IDS = [
    "c1-s1-0-q001",   # 普通单选
    "c1-s2-0-q013",   # 特殊题 1：四个空、单组选项
    "c1-s5-0-q001",   # ch1 独立综合题（无 .q 容器，含甘特图表格与公式）
    "c2-s1-0-q022",   # 特殊题 2：陈述列表 + 单组选项
    "c2-s2-0-q016",   # 特殊题 3：五选项多空
    "c2-s3-0-q031",   # 特殊题 4：两空、两组独立选项
    "c2-s5-0-q001",   # ch2 H3 综合题（代码块）
    "c3-s1-0-q034",   # 特殊题 5：两空、两组独立选项
    "c3-s3-1-q001",   # ch3 表格综合题
    "c3-s3-2-q011",   # ch3 公式综合题
    "c4-s4-1-q011",   # ch4 表格综合题（2016 真题）
    "c5-s4-3-q006",   # ch5 统考真题综合题（2010 C-SCAN，含表格与公式）
]

# 期望值来自 docs/调查记录.md 与 docs/audit/question-catalog.json 的盘点结果。
EXPECTED_PER_CHAPTER = {"ch1": 88, "ch2": 276, "ch3": 166, "ch4": 110, "ch5": 120}
EXPECTED_TOTAL = 760
EXPECTED_SINGLE_CHOICE = 645
EXPECTED_MULTI_BLANK = 5
EXPECTED_CONSTRUCTED = 110

LABEL_RE = re.compile(r"^\s*第\s*(\d+)\s*题\s*(.*)$", re.S)
OPTION_MARK_RE = re.compile(r"(?<![A-Za-z0-9])([A-H])[.．、]\s*")
YEAR_RE = re.compile(r"【\s*(\d{4})\s*统考真题\s*】")
WS_RE = re.compile(r"[ \t\r\f\v]+")
MULTI_WS_RE = re.compile(r"\s+")

# 内容清洗白名单：只保留题目正文需要的结构标签。
ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "sup", "sub", "span",
    "div", "ul", "ol", "li", "table", "caption", "thead", "tbody", "tfoot",
    "tr", "th", "td", "pre", "code", "blockquote", "hr", "img", "a", "small",
}
DROP_TAGS = {"script", "style", "iframe", "object", "embed", "noscript", "form", "input", "button"}
ALLOWED_CLASSES = {"mono", "callout", "callout-title", "tip", "notice", "warn", "danger", "note", "qa-body"}
ALLOWED_ATTRS = {"class", "colspan", "rowspan", "src", "alt", "href", "title", "lang"}


# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #
def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def normalize_space(text: str) -> str:
    return MULTI_WS_RE.sub(" ", text).strip()


def text_of(node: Tag | NavigableString) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    return node.get_text("", strip=False)


def is_question_container(node: Tag) -> bool:
    return node.name == "div" and "q" in (node.get("class") or [])


def label_of(node: Tag) -> tuple[int, str] | None:
    """识别题目起始标签，返回 (题号, 附加文字)。"""
    if node.name == "h3":
        m = LABEL_RE.match(node.get_text(" ", strip=True))
        return (int(m.group(1)), normalize_space(m.group(2))) if m else None
    if node.name == "p":
        strong = node.find("strong", recursive=False)
        if strong is None:
            return None
        m = LABEL_RE.match(strong.get_text(" ", strip=True))
        return (int(m.group(1)), normalize_space(m.group(2))) if m else None
    return None


# --------------------------------------------------------------------------- #
# 清洗
# --------------------------------------------------------------------------- #
def sanitize(node: Tag) -> Tag:
    """按白名单清洗：去脚本/事件属性，未知标签展开，保留受控 class。

    直接在深拷贝上原地清洗，避免 ``str()`` 往返时被解析器包上 html/body。
    """
    root = copy.copy(node)

    for tag in list(root.find_all(True)):
        if tag.name in DROP_TAGS:
            tag.decompose()
            continue
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()
            continue
        for attr in list(tag.attrs):
            value = tag.attrs[attr]
            if attr not in ALLOWED_ATTRS:
                del tag.attrs[attr]
                continue
            if attr == "class":
                kept = [c for c in (value or []) if c in ALLOWED_CLASSES]
                if kept:
                    tag.attrs["class"] = kept
                else:
                    del tag.attrs["class"]
            elif attr == "href":
                if not isinstance(value, str) or value.strip().lower().startswith(("javascript:", "data:")):
                    del tag.attrs[attr]
            elif attr == "src":
                if not isinstance(value, str) or value.strip().lower().startswith(("javascript:", "data:")):
                    del tag.attrs[attr]
        # 去掉空的 class/其他空属性
        for attr in list(tag.attrs):
            if tag.attrs[attr] in (None, [], ""):
                del tag.attrs[attr]
    return root


def inner_html(node: Tag) -> str:
    return "".join(str(c) for c in node.contents).strip()


def clean_html(node: Tag) -> str:
    return inner_html(sanitize(node))


def outer_html(node: Tag) -> str:
    return str(sanitize(node)).strip()


# --------------------------------------------------------------------------- #
# 选项解析
# --------------------------------------------------------------------------- #
def mono_plain_text(mono: Tag) -> str:
    raw = re.sub(r"<br\s*/?>", "\n", mono.decode_contents(), flags=re.I)
    return html_lib.unescape(re.sub(r"<[^>]+>", "", raw))


def parse_option_block(mono: Tag) -> dict | None:
    """把 ``<p class="mono">`` 解析成选项块；不是选项块则返回 None。

    ``Ⅰ./Ⅱ./Ⅲ.`` 陈述列表同样使用 mono 样式，必须排除。
    """
    text = mono_plain_text(mono)
    marks = list(OPTION_MARK_RE.finditer(text))
    if len(marks) < 2:
        return None
    keys = [m.group(1) for m in marks]
    raw_html = outer_html(mono)
    if keys[0] != "A":
        # 例如「①：A. …」这种多空题，首键前有全角冒号，属多空题选项块。
        return {"kind": "nonstandard", "keys": keys, "rawHtml": raw_html}
    expected = [chr(ord("A") + i) for i in range(len(keys))]
    if keys != expected:
        return {"kind": "nonstandard", "keys": keys, "rawHtml": raw_html}

    options = []
    for idx, m in enumerate(marks):
        start = m.start(1)
        end = marks[idx + 1].start(1) if idx + 1 < len(marks) else len(text)
        chunk = text[start:end].strip()
        chunk = re.sub(r"^[A-H][.．、]\s*", "", chunk)
        chunk = chunk.strip(" \u3000\n")
        # 去掉与下一个选项粘连的尾部空白/换行
        chunk = re.sub(r"[\s\u3000]+$", "", chunk)
        options.append({"key": m.group(1), "html": escape_text(chunk), "text": normalize_space(chunk)})
    return {"kind": "standard", "keys": keys, "options": options, "rawHtml": raw_html}


def escape_text(text: str) -> str:
    escaped = html_lib.escape(text, quote=False)
    return escaped.replace("\n", "<br>")


# --------------------------------------------------------------------------- #
# 题目边界扫描
# --------------------------------------------------------------------------- #
def top_level_children(article: Tag) -> list[Tag]:
    return [c for c in article.children if isinstance(c, Tag)]


def scan_article(article: Tag) -> list[dict]:
    """按真实边界扫描 article，返回题目原始节点集合（未解析）。"""
    nodes = top_level_children(article)
    found: list[dict] = []
    section = {"id": None, "title": None, "intro": [], "ordinal": 0}
    sections: list[dict] = []
    subsection = {"id": None, "title": None, "ordinal": 0}
    section_ordinal = 0
    subsection_ordinal = 0
    index = 0

    def flush_section():
        if section["id"]:
            sections.append(
                {
                    "id": section["id"],
                    "title": section["title"],
                    "ordinal": section["ordinal"],
                    "introHtml": "".join(section["intro"]).strip(),
                }
            )

    while index < len(nodes):
        node = nodes[index]

        if node.name == "h2":
            flush_section()
            section_ordinal += 1
            subsection_ordinal = 0
            section = {
                "id": node.get("id"),
                "title": normalize_space(node.get_text(" ", strip=True)),
                "intro": [],
                "ordinal": section_ordinal,
            }
            subsection = {"id": None, "title": None, "ordinal": 0}
            index += 1
            continue

        if node.name == "h3":
            label = label_of(node)
            if label:
                # H3 本身是题目标题（ch2 的综合应用题）
                body, next_index = collect_body(nodes, index + 1, allow_leading_label=label[0])
                found.append(
                    {
                        "kind": "h3",
                        "section": dict(section),
                        "subsection": dict(subsection),
                        "label": label[0],
                        "title": label[1],
                        "headingId": node.get("id"),
                        "body": body,
                    }
                )
                index = next_index
                continue
            subsection_ordinal += 1
            subsection = {
                "id": node.get("id"),
                "title": normalize_space(node.get_text(" ", strip=True)),
                "ordinal": subsection_ordinal,
            }
            index += 1
            continue

        if is_question_container(node):
            found.append(
                {
                    "kind": "container",
                    "section": dict(section),
                    "subsection": dict(subsection),
                    "container": node,
                }
            )
            index += 1
            continue

        label = label_of(node)
        if label:
            body, next_index = collect_body(nodes, index + 1, allow_leading_label=None, head=node)
            found.append(
                {
                    "kind": "bare",
                    "section": dict(section),
                    "subsection": dict(subsection),
                    "label": label[0],
                    "title": label[1],
                    "headingId": None,
                    "body": body,
                    "head": node,
                }
            )
            index = next_index
            continue

        if section["id"]:
            section["intro"].append(str(node))
        index += 1

    flush_section()
    return found, sections


def is_boundary(node: Tag) -> bool:
    if node.name in ("h2", "h3"):
        return True
    if is_question_container(node):
        return True
    if node.name == "p" and label_of(node):
        return True
    if node.name == "nav":
        return True
    return False


def collect_body(nodes: list[Tag], start: int, allow_leading_label: int | None, head: Tag | None = None):
    """从 start 起收集题目正文节点，直到下一个边界。

    ``allow_leading_label``：H3 题目的题干会紧跟一个重复题号的 ``<p><strong>第 N 题</strong>``，
    该段落属于本题而不是下一题。
    """
    body: list[Tag] = []
    if head is not None:
        body.append(head)
    index = start
    while index < len(nodes):
        node = nodes[index]
        if node.name in ("h2", "h3", "nav"):
            break
        if is_question_container(node):
            break
        if node.name == "p" and label_of(node):
            if allow_leading_label is not None and label_of(node)[0] == allow_leading_label and not body:
                body.append(node)
                index += 1
                continue
            break
        body.append(node)
        index += 1
    return body, index


# --------------------------------------------------------------------------- #
# 单题构建
# --------------------------------------------------------------------------- #
def split_answer_and_explanation(container: Tag) -> tuple[Tag | None, str | None, str | None, Tag | None]:
    """返回 (答案标签, 答案纯文本, 答案HTML, 解析容器)。"""
    qa = container.find("details", class_="qa")
    if qa is None:
        return None, None, None, None
    body = qa.find("div", class_="qa-body") or qa
    tag = body.find("span", class_="answer-tag")
    answer_text = None
    answer_html = None
    if tag is not None:
        answer_html = inner_html(tag)
        answer_text = normalize_space(text_of(tag))
        answer_text = re.sub(r"^答案\s*[:：]\s*", "", answer_text).strip()
    return tag, answer_text, answer_html, body


def build_stem(container: Tag, drop_details: bool = True) -> Tag:
    """复制容器并移除解析块与真正的选项段落，得到纯题干。"""
    root = copy.copy(container)
    for qa in root.find_all("details", class_="qa"):
        qa.decompose()
    for strong in root.find_all("strong"):
        if strong.parent and strong.parent.name in ("p", "div") and LABEL_RE.match(strong.get_text(" ", strip=True)):
            parent = strong.parent
            strong.decompose()
            # 剥掉题号标签后常残留一个空格，清理掉，避免题干首字前出现空白
            if parent.contents and isinstance(parent.contents[0], NavigableString):
                parent.contents[0].replace_with(str(parent.contents[0]).lstrip(" \t\n\u3000"))
            if parent.name == "p" and not normalize_space(parent.get_text("", strip=False)):
                parent.decompose()
    return root


def extract_options_from_stem(root: Tag) -> tuple[list[dict], list[dict], list[Tag]]:
    """从题干副本中摘出选项块，返回 (标准选项, 非标准选项块, 陈述列表段落)。"""
    standard: list[dict] = []
    nonstandard: list[dict] = []
    for mono in list(root.find_all("p", class_="mono")):
        parsed = parse_option_block(mono)
        if parsed is None:
            continue  # Ⅰ/Ⅱ/Ⅲ 陈述列表，留在题干中
        if parsed["kind"] == "standard":
            standard.append(parsed)
        else:
            nonstandard.append(parsed)
        mono.decompose()
    return standard, nonstandard, []


def answer_shape(answer: str | None, option_keys: list[str]) -> str:
    if not answer:
        return "missing"
    a = answer.strip()
    if re.fullmatch(r"[A-H]", a):
        return "single_letter" if a in option_keys else "single_letter_out_of_range"
    if re.fullmatch(r"[A-H](?:\s*[、,，]\s*[A-H])+", a):
        return "letter_sequence"
    if re.fullmatch(r"[A-H]{2,}", a):
        return "compact_letters"
    if re.search(r"[①②③④⑤⑥]", a):
        return "blank_sequence"
    return "text"


def classify(section_title: str, shape: str, standard: list[dict], nonstandard: list[dict]) -> str:
    is_choice_section = "选择题" in (section_title or "")
    if not is_choice_section:
        return "constructed_response"
    if shape == "single_letter" and len(standard) == 1 and not nonstandard:
        return "single_choice"
    return "multi_blank"


def build_question(raw: dict, chapter: str) -> dict:
    kind = raw["kind"]
    section = raw["section"]
    subsection = raw["subsection"]

    if kind == "container":
        container = raw["container"]
        label_node = container.find("strong")
        label_text = normalize_space(label_node.get_text(" ", strip=True)) if label_node else ""
        label_num = int(re.search(r"\d+", label_text).group()) if re.search(r"\d+", label_text) else None
        title = ""
        heading_id = None
        stem_root = build_stem(container)
        standard, nonstandard, _ = extract_options_from_stem(stem_root)
        qa_tag, answer_text, answer_html, qa_body = split_answer_and_explanation(container)
        raw_html = str(container)
        has_q_wrapper = True
    else:
        label_num = raw["label"]
        label_text = f"第 {label_num} 题"
        title = raw.get("title") or ""
        heading_id = raw.get("headingId")
        body_nodes = raw["body"]
        holder = BeautifulSoup("", "lxml").new_tag("div")
        for node in body_nodes:
            holder.append(copy.copy(node))
        stem_root = build_stem(holder)
        standard, nonstandard, _ = extract_options_from_stem(stem_root)
        qa_tag, answer_text, answer_html, qa_body = split_answer_and_explanation(holder)
        raw_html = "".join(str(n) for n in body_nodes)
        has_q_wrapper = False

    # 解析块：去掉答案标签本身，保留完整过程
    explanation_html = ""
    explanation_text = ""
    if qa_body is not None:
        qa_clone = copy.copy(qa_body)
        tag = qa_clone.find("span", class_="answer-tag")
        if tag is not None:
            parent = tag.parent
            tag.decompose()
            if parent is not None and parent.name == "p" and not normalize_space(parent.get_text("", strip=False)):
                parent.decompose()
        explanation_html = clean_html(qa_clone)
        explanation_text = normalize_space(qa_clone.get_text(" ", strip=False))

    stem_html = clean_html(stem_root)
    option_keys = [o["key"] for o in standard[0]["options"]] if standard else []
    shape = answer_shape(answer_text, option_keys)
    qtype = classify(section["title"], shape, standard, nonstandard)

    options: list[dict] = []
    option_blocks: list[dict] = []
    if qtype == "single_choice":
        options = standard[0]["options"]
    elif qtype == "multi_blank":
        # 多空/复合题保留原始选项块，不按字母强行归并，也不生成自动判分规则
        option_blocks = [{"rawHtml": b["rawHtml"], "keys": b["keys"]} for b in standard + nonstandard]

    stem_text = normalize_space(stem_root.get_text(" ", strip=False))
    full_text = " ".join([stem_text] + [o["text"] for o in options] + [answer_text or "", explanation_text])
    year_match = YEAR_RE.search(stem_text)

    assets = {
        "images": re.findall(r'<img[^>]+src="([^"]+)"', stem_html + explanation_html),
        "tables": stem_html.count("<table") + explanation_html.count("<table"),
        "codeBlocks": stem_html.count("<pre") + explanation_html.count("<pre"),
        "formulas": len(re.findall(r"\\\((?:.|\n)*?\\\)", stem_html + explanation_html)),
    }

    # 稳定 ID：章 + h2 序号 + h3 序号 + 原题号（首次分配后由登记表冻结）
    qid = f"c{chapter[2:]}-s{section['ordinal']}-{subsection['ordinal']}-q{label_num:03d}"

    return {
        "id": qid,
        "type": qtype,
        "chapter": chapter,
        "source": {
            "repository": UPSTREAM["repository"],
            "revision": UPSTREAM["revision"],
            "path": f"{chapter}/quiz.html",
            "sectionId": section["id"],
            "sectionTitle": section["title"],
            "subsectionId": subsection["id"],
            "subsectionTitle": subsection["title"],
            "questionHeadingId": heading_id,
            "originalLabel": label_text,
            "originalNumber": label_num,
            "title": title,
            "hasQContainer": has_q_wrapper,
            "contentHash": "sha256:" + sha256_text(normalize_space(raw_html)),
        },
        "stemHtml": stem_html,
        "stemText": stem_text,
        "options": options,
        "optionBlocks": option_blocks,
        "originalAnswer": answer_text,
        "originalAnswerHtml": answer_html,
        "answerFormat": shape,
        "originalExplanationHtml": explanation_html,
        "examYear": int(year_match.group(1)) if year_match else None,
        "examYearVerified": False,
        "assets": assets,
        "reviewStatus": "unreviewed",
        "searchText": full_text[:1200],
    }


# --------------------------------------------------------------------------- #
# 登记表
# --------------------------------------------------------------------------- #
def locator_for(q: dict) -> str:
    s = q["source"]
    sub = s["subsectionId"] or "0"
    return f'{s["path"]}#{s["sectionId"]}/{sub}/{s["originalLabel"]}'


def load_registry() -> dict:
    path = DATA_DIR / "source-registry.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"schemaVersion": SCHEMA_VERSION, "entries": [], "relocations": [], "retired": []}


def apply_registry(questions: list[dict], registry: dict) -> dict:
    """先用内容认领旧 ID，再分配新 ID；定位冲突不得覆盖另一道题的身份。"""
    by_locator = {e["locator"]: e for e in registry.get("entries", [])}
    by_hash: dict[str, list[dict]] = {}
    for entry in registry.get("entries", []):
        by_hash.setdefault(entry["contentHash"], []).append(entry)

    used_ids = {e["id"] for e in registry.get("entries", [])}
    assigned_ids: set[str] = set()
    relocations: list[dict] = []
    suffix_counter: Counter[str] = Counter()
    claims = {}
    if len({locator_for(q) for q in questions}) != len(questions):
        raise ValueError("新题目来源定位重复，停止登记，需人工核对")
    # 两遍认领：某题移到另一个仍存在的定位时，不能被“定位优先”错配给旧题 ID。
    for q in questions:
        locator = locator_for(q)
        candidates = [e for e in by_hash.get(q["source"]["contentHash"], []) if e["id"] not in assigned_ids]
        same = next((e for e in candidates if e["locator"] == locator), None)
        if same is None and len(candidates) > 1:
            raise ValueError(f"{locator}: 多个旧题内容相同，无法自动确定 ID，需人工核对")
        entry = same or (candidates[0] if candidates else None)
        if entry:
            claims[locator] = entry
            assigned_ids.add(entry["id"])

    # 定位没变但内容变了，可能是改题，也可能是另一题占据了旧位置；禁止静默认作同题。
    for q in questions:
        locator = locator_for(q)
        previous = by_locator.get(locator)
        if locator not in claims and previous and previous["id"] not in assigned_ids:
            raise ValueError(f"{locator}: 来源内容已变化，停止自动覆盖稳定 ID；需审核版本差异后迁移")

    for q in questions:
        locator = locator_for(q)
        entry = claims.get(locator)
        if entry is None:
            base_id = q["id"]
            qid = base_id
            while qid in used_ids:
                suffix_counter[base_id] += 1
                qid = f"{base_id}-{suffix_counter[base_id] + 1}"
            used_ids.add(qid)
            assigned_ids.add(qid)
            entry = {"id": qid, "firstSeen": DATASET_VERSION}
            registry["entries"].append(entry)
        elif entry["locator"] != locator:
            relocations.append({"id": entry["id"], "from": entry["locator"], "to": locator})
        q["id"] = entry["id"]
        entry.update({"locator": locator, "path": q["source"]["path"],
                      "sectionId": q["source"]["sectionId"], "subsectionId": q["source"]["subsectionId"],
                      "originalLabel": q["source"]["originalLabel"], "contentHash": q["source"]["contentHash"],
                      "lastSeen": DATASET_VERSION, "status": "active"})

    retired = [e for e in registry["entries"] if e["id"] not in assigned_ids]
    for entry in retired:
        entry["status"] = "retired"

    registry["relocations"] = registry.get("relocations", []) + relocations
    registry["retired"] = [e["id"] for e in retired]
    return registry


def write_fixtures(questions: list[dict]) -> None:
    """导出真实复杂样本，供 validate_dataset.py 做回归比对。"""
    fixtures_dir = ROOT / "tests" / "fixtures" / "samples"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    by_id = {q["id"]: q for q in questions}
    index = []
    for qid in FIXTURE_IDS:
        q = by_id.get(qid)
        if q is None:
            raise SystemExit(f"固定样本缺失：{qid}")
        path = fixtures_dir / f"{qid}.json"
        path.write_text(json.dumps(q, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        index.append(
            {
                "id": qid,
                "type": q["type"],
                "label": q["source"]["originalLabel"],
                "section": q["source"]["sectionTitle"],
                "reason": FIXTURE_REASONS.get(qid, ""),
            }
        )
    (ROOT / "tests" / "fixtures" / "index.json").write_text(
        json.dumps({"count": len(index), "samples": index}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )


FIXTURE_REASONS = {
    "c1-s1-0-q001": "普通单选：题干、四个选项、答案与解析边界",
    "c1-s2-0-q013": "特殊题：四个空共用一组选项，答案 B、A、C、D",
    "c1-s5-0-q001": "ch1 独立综合题：无 .q 容器，含两张甘特图表格与 dfrac 公式",
    "c2-s1-0-q022": "特殊题：Ⅰ～Ⅵ 陈述列表与选项同用 mono 样式，不能误切",
    "c2-s2-0-q016": "特殊题：五个选项、四个空、答案为紧凑字母 BECD",
    "c2-s3-0-q031": "特殊题：两空各有独立 A～D 选项组",
    "c2-s5-0-q001": "ch2 H3 综合题：题干由 h3 引入，含 pre/code 代码块",
    "c3-s1-0-q034": "特殊题：两空两组选项，首键前有全角冒号",
    "c3-s3-1-q001": "ch3 表格综合题：多张分区表完整保留",
    "c3-s3-2-q011": "ch3 公式综合题：位数换算公式保留",
    "c4-s4-1-q011": "ch4 表格综合题：目录树与 FAT 表完整保留",
    "c5-s4-3-q006": "ch5 统考真题综合题：C-SCAN 表格与位示图公式",
}


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WORK_REPORTS.mkdir(parents=True, exist_ok=True)

    registry = load_registry()
    all_questions: list[dict] = []
    file_entries: list[dict] = []
    section_index: list[dict] = []
    warnings: list[str] = []

    for chapter in CHAPTERS:
        path = VENDOR / chapter / "quiz.html"
        raw_bytes = path.read_bytes()
        soup = BeautifulSoup(raw_bytes.decode("utf-8"), "lxml")
        article = soup.find("article")
        if article is None:
            warnings.append(f"{chapter}: 找不到 article")
            continue

        raws, sections = scan_article(article)
        questions = [build_question(r, chapter) for r in raws]
        for q in questions:
            if not q["originalAnswer"]:
                warnings.append(f'{q["id"]}: 缺少答案')
            if not q["originalExplanationHtml"]:
                warnings.append(f'{q["id"]}: 缺少解析')
        all_questions.extend(questions)
        for sec in sections:
            section_index.append({"chapter": chapter, **sec, "questionCount": sum(1 for q in questions if q["source"]["sectionId"] == sec["id"])})
        file_entries.append(
            {
                "path": f"{chapter}/quiz.html",
                "bytes": len(raw_bytes),
                "sha256": sha256_bytes(raw_bytes),
                "questions": len(questions),
            }
        )

    registry = apply_registry(all_questions, registry)

    type_counts = Counter(q["type"] for q in all_questions)
    per_chapter = Counter(q["chapter"] for q in all_questions)
    specials = [q["id"] for q in all_questions if q["type"] == "multi_blank"]
    no_container = [q["id"] for q in all_questions if not q["source"]["hasQContainer"]]

    payload = OrderedDict(
        [
            ("schemaVersion", SCHEMA_VERSION),
            ("datasetVersion", DATASET_VERSION),
            ("generatedAt", date.today().isoformat()),
            ("upstream", UPSTREAM),
            (
                "counts",
                {
                    "total": len(all_questions),
                    "perChapter": {c: per_chapter.get(c, 0) for c in CHAPTERS},
                    "byType": dict(sorted(type_counts.items())),
                    "withoutQContainer": len(no_container),
                    "multiBlank": len(specials),
                },
            ),
            ("sections", section_index),
            ("questions", all_questions),
        ]
    )
    (DATA_DIR / "questions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    registry_payload = OrderedDict(
        [
            ("schemaVersion", SCHEMA_VERSION),
            ("datasetVersion", DATASET_VERSION),
            ("upstream", UPSTREAM),
            ("idScheme", "c{chapter}-s{h2序号}-{h3序号或0}-q{原题号}，首次分配后冻结"),
            ("files", file_entries),
            ("entries", sorted(registry.get("entries", []), key=lambda e: e["id"])),
            ("relocations", registry.get("relocations", [])),
            ("retired", registry.get("retired", [])),
        ]
    )
    (DATA_DIR / "source-registry.json").write_text(
        json.dumps(registry_payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    report = {
        "datasetVersion": DATASET_VERSION,
        "total": len(all_questions),
        "perChapter": dict(per_chapter),
        "byType": dict(type_counts),
        "multiBlankIds": specials,
        "withoutQContainer": len(no_container),
        "withoutQContainerIds": no_container,
        "answerFormats": dict(Counter(q["answerFormat"] for q in all_questions)),
        "withTables": sum(1 for q in all_questions if q["assets"]["tables"]),
        "withFormulas": sum(1 for q in all_questions if q["assets"]["formulas"]),
        "withCode": sum(1 for q in all_questions if q["assets"]["codeBlocks"]),
        "withImages": sum(1 for q in all_questions if q["assets"]["images"]),
        "examYearTagged": sum(1 for q in all_questions if q["examYear"]),
        "warnings": warnings,
        "files": file_entries,
    }
    (WORK_REPORTS / "import-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if "--write-fixtures" in sys.argv:
        write_fixtures(all_questions)
        print(f"已写出 {len(FIXTURE_IDS)} 个固定样本到 tests/fixtures/")

    print(f"提取完成：{len(all_questions)} 道（目标 {EXPECTED_TOTAL}）")
    for chapter in CHAPTERS:
        print(f"  {chapter}: {per_chapter.get(chapter, 0)}（目标 {EXPECTED_PER_CHAPTER[chapter]}）")
    print(f"  题型：{dict(type_counts)}")
    print(f"  无 .q 容器：{len(no_container)}；多空/特殊题：{len(specials)}")
    if warnings:
        print(f"  警告 {len(warnings)} 条：")
        for w in warnings[:10]:
            print("   -", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
