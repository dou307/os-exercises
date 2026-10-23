/** 全库搜索：题干、章节、原题号、知识点，支持按章节、题型、分层过滤。结果直达对应题目。 */

import { getIndex, getTopics, getMeta, topicTitle } from "./questions.js";
import { completedChapters, effectiveTier } from "./tiers.js";
import { navigate, buildHash } from "./router.js";
import { questionNumbers } from "./numbering.js";

export const TYPE_FILTERS = [
  { key: "", label: "全部题型" },
  { key: "single_choice", label: "单选" },
  { key: "multi_blank", label: "多空" },
  { key: "constructed_response", label: "综合" },
];

export const TIER_FILTERS = [
  { key: "", label: "全部分层" },
  { key: "core", label: "核心" },
  { key: "bridge", label: "桥接" },
  { key: "supplement", label: "补充" },
  { key: "later", label: "稍后" },
  { key: "disputed", label: "待核对" },
];

const TIER_TEXT = { core: "核心", bridge: "桥接", supplement: "补充", later: "稍后", disputed: "待核对" };
const REVIEW_TEXT = {
  verified: "已核对",
  reviewed: "已核对归属",
  systematic: "系统映射",
  disputed: "待核对",
  candidate: "未审核",
  unreviewed: "未审核",
  unresolved: "归属未定",
};

const MAX_RESULTS = 100;

/** 关键词按空白切分，去重后小写；与搜索时使用的口径保持一致。 */
export function searchTerms(rawQuery) {
  const seen = new Set();
  (rawQuery || "").trim().split(/\s+/).forEach((term) => {
    const key = term.toLowerCase();
    if (key) seen.add(key);
  });
  return Array.from(seen);
}

/**
 * @param {object} index data/index.json
 * @param {Map} topics 知识点
 * @param {string} rawQuery 关键词（空格分隔表示“同时包含”）
 * @param {{ch?: string, type?: string, tier?: string}} filters
 * @returns {{items: object[], total: number, truncated: boolean}}
 */
export function searchQuestions(index, topics, rawQuery, filters) {
  const f = filters || {};
  const terms = searchTerms(rawQuery);
  if (!terms.length && !f.ch && !f.type && !f.tier) return { items: [], total: 0, truncated: false };
  const results = [];
  index.questions.forEach((entry) => {
    if (f.ch && String(entry.ch) !== String(f.ch)) return;
    if (f.type && entry.type !== f.type) return;
    if (f.tier && entry.tier !== f.tier) return;
    const topicText = entry.topics.map((id) => `${id} ${topicTitle(topics, id)}`).join(" ");
    const haystack = [
      entry.stem,
      entry.sec || "",
      entry.sub || "",
      entry.label || "",
      entry.id,
      entry.chapterText || "",
      topicText,
    ].join(" ").toLowerCase();
    let score = 0;
    let all = true;
    terms.forEach((term) => {
      if (!haystack.includes(term)) { all = false; return; }
      if (entry.id.toLowerCase() === term) score += 60;
      else if (entry.label && entry.label.toLowerCase().includes(term)) score += 25;
      else if (entry.stem.toLowerCase().includes(term)) score += 12;
      else score += 4;
    });
    if (!all) return;
    if (entry.tier === "core" || entry.tier === "bridge") score += 6;
    results.push({ entry, score });
  });
  results.sort((a, b) => b.score - a.score);
  return {
    items: results.slice(0, MAX_RESULTS).map((r) => r.entry),
    total: results.length,
    truncated: results.length > MAX_RESULTS,
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把命中的关键词包进 <mark>。用 DOM 节点拼接而不是拼 innerHTML：
 * 题干来自上游 HTML 清洗后的纯文本，但仍不应经过字符串拼接进 HTML。
 */
export function highlightInto(node, text, terms) {
  const valid = (terms || []).filter(Boolean);
  if (!valid.length) {
    node.textContent = text;
    return node;
  }
  const pattern = new RegExp(`(${valid.map(escapeRegExp).join("|")})`, "gi");
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > last) node.appendChild(document.createTextNode(text.slice(last, match.index)));
    const mark = document.createElement("mark");
    mark.textContent = match[0];
    node.appendChild(mark);
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  return node;
}

function segGroup(options, current, onPick) {
  const group = document.createElement("div");
  group.className = "seg";
  group.setAttribute("role", "group");
  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = option.label;
    btn.setAttribute("aria-pressed", String((current || "") === option.key));
    btn.addEventListener("click", () => onPick(option.key));
    group.appendChild(btn);
  });
  return group;
}

export async function renderSearch(main, params, isCurrent = () => true) {
  const [rawIndex, topics, meta] = await Promise.all([getIndex(), getTopics(), getMeta()]);
  if (!isCurrent()) return;
  const completed = completedChapters(meta);
  const index = { ...rawIndex, questions: rawIndex.questions.map((entry) => ({ ...entry,
    tier: effectiveTier({ primaryChapterId: entry.ch, readinessTier: entry.tier, reviewStatus: entry.review }, completed),
  })) };
  const query = params.q || "";
  const filters = { ch: params.ch || "", type: params.type || "", tier: params.tier || "" };
  main.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("h1");
  title.textContent = query ? `搜索：${query}` : "搜索题目";
  card.appendChild(title);

  const goto = (patch) => {
    const next = Object.assign({ q: query }, filters, patch);
    navigate(buildHash("#/search", next));
  };

  // ---- 过滤器 ----
  const filterBar = document.createElement("div");
  filterBar.className = "filters";
  const chapterSelect = document.createElement("select");
  chapterSelect.className = "select";
  chapterSelect.setAttribute("aria-label", "按章节筛选");
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "全部章节";
  chapterSelect.appendChild(allOpt);
  // 章节列表从索引里现算：不在前端硬编码章节号，数据变了这里跟着变
  const chapters = Array.from(new Set(index.questions.map((q) => String(q.ch))))
    .sort((a, b) => Number(a) - Number(b));
  chapters.forEach((ch) => {
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = `第 ${ch} 章`;
    chapterSelect.appendChild(opt);
  });
  chapterSelect.value = filters.ch;
  chapterSelect.addEventListener("change", () => goto({ ch: chapterSelect.value }));
  filterBar.appendChild(chapterSelect);
  filterBar.appendChild(segGroup(TYPE_FILTERS, filters.type, (key) => goto({ type: key })));
  filterBar.appendChild(segGroup(TIER_FILTERS, filters.tier, (key) => goto({ tier: key })));
  card.appendChild(filterBar);

  if (!query && !filters.ch && !filters.type && !filters.tier) {
    const hint = document.createElement("p");
    hint.className = "sub";
    hint.textContent = "输入题干关键词、知识点、章节名或题目 ID，例如「中断」「t1-4-2」「c1-s3-0-q019」；也可以只用下面的章节/题型/分层筛选。";
    card.appendChild(hint);
    main.appendChild(card);
    return;
  }

  const { items, total, truncated } = searchQuestions(index, topics, query, filters);
  const terms = searchTerms(query);
  const sub = document.createElement("p");
  sub.className = "sub";
  sub.setAttribute("role", "status");
  sub.setAttribute("aria-live", "polite");
  const filterText = [filters.ch ? `第 ${filters.ch} 章` : "", typeLabel(filters.type), tierLabel(filters.tier)]
    .filter(Boolean).join(" · ");
  const shownText = truncated ? `命中 ${total} 道，按相关度显示前 ${items.length} 道` : `命中 ${total} 道`;
  sub.textContent = `${shownText}${filterText ? `（筛选：${filterText}）` : ""}。点击任意结果直达题目。`;
  card.appendChild(sub);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配的题目。换个关键词或放宽筛选条件，也可以从左侧章节进入题单。";
    card.appendChild(empty);
    main.appendChild(card);
    return;
  }

  const list = document.createElement("ul");
  list.className = "qlist";
  const numbers = questionNumbers(rawIndex.questions, completed);
  items.forEach((entry) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "qitem";
    link.href = `#/q/${encodeURIComponent(entry.id)}`;
    const no = document.createElement("span");
    no.className = "no";
    no.textContent = "第" + numbers.get(entry.id) + "题";
    const txt = document.createElement("span");
    txt.className = "txt";
    highlightInto(txt, entry.stem, terms);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.appendChild(badge(`第 ${entry.ch} 章`, ""));
    if (entry.type !== "single_choice") {
      meta.appendChild(badge(entry.type === "multi_blank" ? "多空" : "综合", ""));
    }
    // 分层与审核状态直接标在结果上：搜到“稍后”或“系统映射”的题时，
    // 不用点进去才知道它还没学过 / 没人工复核。
    if (entry.tier && entry.tier !== "core") {
      meta.appendChild(badge(TIER_TEXT[entry.tier] || entry.tier, entry.tier));
    }
    if (entry.review === "disputed") meta.appendChild(badge("待核对", "disputed"));
    else if (entry.review === "systematic") meta.appendChild(badge("系统映射", ""));
    link.appendChild(no);
    link.appendChild(txt);
    link.appendChild(meta);
    li.appendChild(link);
    list.appendChild(li);
  });
  card.appendChild(list);

  if (truncated) {
    const note = document.createElement("p");
    note.className = "sub foot-note";
    note.textContent = `结果较多，只显示相关度最高的 ${items.length} 道。加一个关键词，或用上面的章节/题型筛选缩小范围。`;
    card.appendChild(note);
  }
  main.appendChild(card);
}

function badge(text, cls) {
  const node = document.createElement("span");
  node.className = `badge${cls ? ` ${cls}` : ""}`;
  node.textContent = text;
  return node;
}

function typeLabel(key) {
  return key ? (TYPE_FILTERS.find((t) => t.key === key) || {}).label || "" : "";
}

function tierLabel(key) {
  return key ? (TIER_FILTERS.find((t) => t.key === key) || {}).label || "" : "";
}
