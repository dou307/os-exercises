/**
 * 应用入口：加载元数据、初始化存储、渲染课程导航与各视图。
 *
 * 视图：首页 / 章节题单 / 逐题练习 / 单题 / 错题回顾 / 搜索 / 原题库入口。
 * 每次路由切换前先调用上一页注册的 dispose()，撤掉它加的全局监听。
 */

import * as storage from "./storage.js";
import { getMeta, getIndex, getTopics, getChapterQuestions } from "./questions.js";
import { buildCard, renderPlayer, showToast } from "./practice.js";
import { parseHash, navigate } from "./router.js";
import { renderSearch } from "./search.js";
import { completedChapters, toggleChapterCompleted, withEffectiveTier, SCOPE_TEXT } from "./tiers.js";

const state = {
  meta: null,
  index: null,
  topics: null,
  chapterCache: new Map(),
  byId: null,
  dispose: null,
  routeVersion: 0,
};

const main = () => document.getElementById("main");

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    });
  }
  (children || []).forEach((child) => node.appendChild(child));
  return node;
}

function chapterMeta(id) {
  return state.meta.chapters.find((c) => c.id === id);
}

function chapterLabel(chapter) {
  const prefix = chapter.kind === "supplement" ? "补充" : `第 ${chapter.id} 章`;
  return `${prefix} · ${chapter.titleZh}`;
}

/** “第 3 章” / “补充 · 重建 Linux 内核”，题单与练习页共用。 */
function shortLabel(chapter) {
  if (!chapter) return "章节";
  return chapter.kind === "supplement" ? `补充 · ${chapter.titleZh}` : `第 ${chapter.id} 章`;
}

function statusText(chapter) {
  const completed = completedChapters(state.meta);
  if (completed.has(String(chapter.id))) {
    return state.meta.studyDefaults.chapterStatus[chapter.id] === "completed" ? "已确认学完" : "本机标记已学";
  }
  return "进度未知";
}

function indexEntry(id) {
  if (!state.byId) {
    state.byId = new Map(state.index.questions.map((q) => [q.id, q]));
  }
  return state.byId.get(id) || null;
}

function chapterTitleOf(chapterId) {
  const chapter = chapterMeta(String(chapterId));
  return chapter ? shortLabel(chapter) : `第 ${chapterId} 章`;
}

/**
 * 索引条目 → 题单需要的题目对象。
 *
 * 字段名与完整题目对齐（`readinessTier`/`reviewStatus`/`source.originalLabel`），
 * 这样 `withEffectiveTier` 等逻辑不用为“索引里的题”再写一套分支。
 */
function indexAsQuestion(entry) {
  return {
    id: entry.id,
    primaryChapterId: entry.ch,
    readinessTier: entry.tier,
    reviewStatus: entry.review,
    mappingStatus: entry.status,
    scoring: entry.scoring,
    type: entry.type,
    stemText: entry.stem,
    topicIds: entry.topics || [],
    source: { originalLabel: entry.label },
  };
}

async function loadChapter(id) {
  if (state.chapterCache.has(id)) return state.chapterCache.get(id);
  const list = await getChapterQuestions(id);
  state.chapterCache.set(id, list);
  return list;
}

/* ------------------------------------------------------------------ */
/* 导航                                                                */
/* ------------------------------------------------------------------ */
function renderNav(activeChapterId) {
  const nav = document.getElementById("chapterNav");
  nav.innerHTML = "";
  const mainGroup = el("div", { class: "nav-group" });
  mainGroup.appendChild(el("div", { class: "nav-label", text: "课程章节" }));
  mainGroup.appendChild(navLink("#/", "首页 · 概览", null, activeChapterId === "home"));
  mainGroup.appendChild(navLink("#/review", "错题回顾", null, activeChapterId === "review"));
  nav.appendChild(mainGroup);

  const groups = [
    { label: "主线", items: state.meta.chapters.filter((c) => c.kind === "main") },
    { label: "补充", items: state.meta.chapters.filter((c) => c.kind === "supplement") },
  ];
  groups.forEach((group) => {
    const box = el("div", { class: "nav-group" });
    box.appendChild(el("div", { class: "nav-label", text: group.label }));
    group.items.forEach((chapter) => {
      const total = chapter.counts.total;
      const link = navLink(
        `#/ch/${encodeURIComponent(chapter.id)}`,
        chapterLabel(chapter),
        total ? String(total) : "0",
        String(activeChapterId) === String(chapter.id)
      );
      if (!total) link.classList.add("is-empty");
      box.appendChild(link);
    });
    nav.appendChild(box);
  });

  const tools = el("div", { class: "nav-group" });
  tools.appendChild(el("div", { class: "nav-label", text: "工具" }));
  tools.appendChild(navLink("#/source", "原题库（完整阅读）", null, false));
  nav.appendChild(tools);
}

function navLink(href, text, count, active) {
  const a = el("a", { class: "nav-item", href });
  if (active) a.setAttribute("aria-current", "page");
  a.appendChild(el("span", { class: "no", text: "" }));
  a.appendChild(el("span", { class: "label", text }));
  if (count !== null && count !== undefined && count !== "0") {
    a.appendChild(el("span", { class: "count", text: count }));
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* 首页                                                                */
/* ------------------------------------------------------------------ */
async function renderHome() {
  const meta = state.meta;
  const stats = storage.stats();
  const ch1 = chapterMeta("1");
  const firstChapter = state.index.questions.filter((q) => q.ch === "1");
  const coreCount = firstChapter.filter((q) => q.tier === "core" && q.review !== "disputed").length;
  const supplementCount = firstChapter.filter((q) => q.tier === "supplement" && q.review !== "disputed").length;
  const container = main();
  container.innerHTML = "";

  const hero = el("div", { class: "card" });
  hero.appendChild(el("h1", { text: "OS 练习室" }));
  hero.appendChild(el("p", {
    class: "sub",
    text: `按本地笔记章节组织练习。数据集 ${meta.datasetVersion}，上游 ${meta.upstream.repository}@${meta.upstream.revision.slice(0, 7)}，全库 ${meta.counts.total} 道题。`,
  }));
  const statRow = el("div", { class: "stat-row" });
  statRow.appendChild(statBox(stats.answered, "已作答（本机）"));
  statRow.appendChild(statBox(stats.correct, "答对"));
  statRow.appendChild(statBox(stats.wrong, "答错"));
  statRow.appendChild(statBox(ch1.counts.coreScored, "第一章核心可判分"));
  hero.appendChild(statRow);

  const actions = el("div", { class: "actions" });
  actions.appendChild(el("a", { class: "btn primary", href: "#/practice/1?scope=core&i=0", text: "开始第一章核心练习" }));
  const ui = storage.getUI();
  const last = ui.lastQuestionId;
  if (last) {
    const entry = indexEntry(last);
    const where = entry ? `（${chapterTitleOf(entry.ch)} · ${entry.label.replace(/\s/g, "")}）` : "";
    actions.appendChild(el("a", { class: "btn", href: `#/q/${encodeURIComponent(last)}`, text: `继续上次的题${where}` }));
  }
  actions.appendChild(el("a", { class: "btn", href: "#/ch/1", text: "查看第一章题单" }));
  actions.appendChild(el("a", { class: "btn ghost", href: "#/review", text: "错题回顾" }));
  hero.appendChild(actions);

  // 第一章的手动核对结果可以直接看到：核心 42 = 39 道自动判分 + 1 道综合题自评 + 2 道争议题只读
  hero.appendChild(el("p", {
    class: "sub foot-note",
    text: `第一章核心 ${coreCount} 道：${ch1.counts.coreScored} 道单选按原站答案判分、${ch1.counts.coreSelfAssess} 道综合题自评；`
      + `另有 ${ch1.counts.bridge} 道桥接题。${ch1.counts.disputed} 道待核对题单独列出，不进入计分练习。`,
  }));
  container.appendChild(hero);

  const current = el("div", { class: "card" });
  current.appendChild(el("h2", { text: "当前学习范围" }));
  current.appendChild(el("p", {
    class: "sub",
    text: `第 1 章 ${ch1.title}：已确认学完。共 ${ch1.counts.total} 道：核心 ${coreCount}、桥接 ${ch1.counts.bridge}、补充 ${supplementCount}、待核对 ${ch1.counts.disputed}。`,
  }));
  current.appendChild(el("div", {
    class: "notice",
    text: "来源题库第一、二章共 364 道已逐题复核答案、映射和前置知识；第三至五章 396 道仍为系统映射。来源第二章覆盖课程的进程、线程、调度、同步与死锁。学完相应课程章后可在本机标记进度；争议题单列不计分。",
  }));
  current.appendChild(el("div", {
    class: "notice",
    text: "初始仅第一章确认学完。其他章的本机学习标记会显示在下方目录中。",
  }));
  container.appendChild(current);

  container.appendChild(buildRecordsCard());

  const list = el("div", { class: "card" });
  list.appendChild(el("h2", { text: "全部章节" }));
  const table = el("ul", { class: "qlist" });
  meta.chapters.forEach((chapter) => {
    const li = el("li");
    const a = el("a", { class: "qitem", href: `#/ch/${encodeURIComponent(chapter.id)}` });
    a.appendChild(el("span", { class: "no", text: chapter.id }));
    a.appendChild(el("span", { class: "txt", text: `${chapter.titleZh} · ${chapter.title}` }));
    const metaBox = el("span", { class: "meta" });
    const total = chapter.counts.total;
    metaBox.appendChild(el("span", {
      class: `badge${chapter.id === "1" ? " core" : ""}`,
      text: total ? `${total} 道` : "暂无对应题",
    }));
    if (chapter.counts.unreviewed) metaBox.appendChild(el("span", { class: "badge", text: "系统映射" }));
    metaBox.appendChild(el("span", { class: "badge", text: statusText(chapter) }));
    a.appendChild(metaBox);
    li.appendChild(a);
    table.appendChild(li);
  });
  list.appendChild(table);
  container.appendChild(list);
}

function statBox(value, label) {
  const box = el("div", { class: "stat" });
  box.appendChild(el("b", { text: String(value) }));
  box.appendChild(el("span", { text: label }));
  return box;
}

function buildRecordsCard() {
  const card = el("div", { class: "card" });
  card.appendChild(el("h2", { text: "学习记录" }));
  const stats = storage.stats();
  card.appendChild(el("p", {
    class: "sub",
    text: `本机已记录 ${stats.answered} 道（答对 ${stats.correct}、答错 ${stats.wrong}、自评 ${stats.selfAssessed}）。记录只存在当前浏览器与当前地址，换端口不会自动继承。`,
  }));

  const actions = el("div", { class: "actions" });
  const exportBtn = el("button", { type: "button", class: "btn", text: "导出记录" });
  exportBtn.addEventListener("click", () => {
    const data = storage.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `os-exercises-progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出学习记录");
  });

  const importLabel = el("button", { type: "button", class: "btn ghost", text: "导入记录" });
  const fileInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { showToast("无法读取所选文件，请重新选择。"); fileInput.value = ""; return; }
    const known = new Map(state.index.questions.map((q) => [q.id, q]));
    const result = storage.importData(text, known);
    fileInput.value = "";
    if (!result.ok) {
      showToast(`导入失败：${result.message}`);
      return;
    }
    showToast(`导入完成：新增 ${result.added}、更新 ${result.replaced}、跳过 ${result.skippedUnknown + result.skippedOlder}`);
    if (!result.persistent) showToast("本地存储不可用，导入只保留在内存中");
    route();
  });
  importLabel.addEventListener("click", () => fileInput.click());
  actions.appendChild(fileInput);
  actions.appendChild(exportBtn);
  actions.appendChild(importLabel);
  card.appendChild(actions);

  if (!storage.isPersistent()) {
    card.appendChild(el("div", { class: "notice bad", text: "当前浏览器无法持久保存记录；导出仍可用于备份。" }));
  }

  const wrong = storage.wrongIds().length;
  if (wrong) {
    card.appendChild(el("p", {
      class: "sub foot-note",
      text: `当前有 ${wrong} 道题最近一次答错，可以在“错题回顾”里逐题重做。`,
    }));
  }
  return card;
}

/* ------------------------------------------------------------------ */
/* 章节                                                                */
/* ------------------------------------------------------------------ */
async function renderChapter(chapterId) {
  const chapter = chapterMeta(chapterId);
  const container = main();
  container.innerHTML = "";
  if (!chapter) {
    container.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "找不到这一章" }),
      el("a", { class: "btn", href: "#/", text: "返回首页" }),
    ]));
    return;
  }

  const head = el("div", { class: "card" });
  head.appendChild(el("div", { class: "crumbs", html: '<a href="#/">首页</a> / 章节' }));
  head.appendChild(el("h1", { text: chapterLabel(chapter) }));
  const fileText = chapter.file ? `笔记文件 ${chapter.file}` : "这一章没有对应的笔记文件";
  head.appendChild(el("p", { class: "sub", text: `${fileText} · ${statusText(chapter)}` }));

  if (!chapter.counts.total) {
    head.appendChild(el("div", { class: "notice", text: "原题库没有覆盖这一章的小节，按约定不自动造题填补；缺口在此明确显示。" }));
    container.appendChild(head);
    return;
  }

  // 题单只用启动时已加载的索引（含题干、题型、分层、审核状态），不再下载整章题目 JSON：
  // 第 10 章那种 300 KB 的章节文件，只为渲染一个列表不值得。点进具体题目时才按需加载。
  const questions = state.index.questions
    .filter((entry) => String(entry.ch) === String(chapterId))
    .map(indexAsQuestion);

  const completed = completedChapters(state.meta);
  const tagged = questions.map((q) => withEffectiveTier(q, completed));
  const counts = {
    core: tagged.filter((q) => q.effectiveTier === "core").length,
    bridge: tagged.filter((q) => q.effectiveTier === "bridge").length,
    supplement: tagged.filter((q) => q.effectiveTier === "supplement").length,
    later: tagged.filter((q) => q.effectiveTier === "later").length,
    disputed: tagged.filter((q) => q.reviewStatus === "disputed").length,
  };
  const progress = storage.chapterStats(questions.map((q) => q.id));
  const wrongCount = tagged.filter((q) => {
    const record = storage.getAnswer(q.id);
    return Boolean(record && record.correct === false);
  }).length;

  const statRow = el("div", { class: "stat-row" });
  statRow.appendChild(statBox(counts.core, "核心"));
  statRow.appendChild(statBox(counts.bridge, "桥接"));
  statRow.appendChild(statBox(counts.supplement, "补充"));
  statRow.appendChild(statBox(counts.disputed, "待核对"));
  statRow.appendChild(statBox(`${progress.answered}/${progress.total}`, "已作答"));
  head.appendChild(statRow);

  const actions = el("div", { class: "actions" });
  if (counts.core || counts.bridge) {
    actions.appendChild(el("a", { class: "btn primary", href: `#/practice/${encodeURIComponent(chapterId)}?scope=core&i=0`, text: "开始核心练习" }));
  }
  if (counts.later) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=later&i=0`, text: `先练“稍后”题（${counts.later}）` }));
  }
  if (counts.supplement) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=supplement&i=0`, text: "补充题" }));
  }
  if (counts.disputed) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=disputed&i=0`, text: "待核对题（不计分）" }));
  }
  if (wrongCount) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=wrong&i=0`, text: `只练本章错题（${wrongCount}）` }));
  }
  actions.appendChild(el("a", { class: "btn ghost", href: `#/practice/${encodeURIComponent(chapterId)}?scope=all&i=0`, text: "全部题目" }));

  const confirmed = (state.meta.studyDefaults.confirmedCompletedChapters || []).map(String).includes(String(chapterId));
  if (!confirmed) {
    const isLocalDone = (storage.getUI().completedChapters || []).map(String).includes(String(chapterId));
    const toggle = el("button", {
      type: "button",
      class: "btn ghost",
      text: isLocalDone ? "取消“本章已学”标记" : "标记本章已学完",
    });
    toggle.addEventListener("click", () => {
      toggleChapterCompleted(state.meta, chapterId);
      route();
    });
    actions.appendChild(toggle);
  }
  head.appendChild(actions);

  if (chapter.counts.systematic) {
    head.appendChild(el("div", {
      class: "notice warn",
      text: `本章 ${chapter.counts.systematic} 道题按小节系统映射到知识点，答案与前置知识未逐题人工复核。可以练习，但不要把判分结果当作已审核结论；答错的题同样会进“错题回顾”，便于回头复核。`,
    }));
  }
  container.appendChild(head);

  const groups = [
    { key: "core", title: "核心练习", filter: (q) => q.effectiveTier === "core" || q.effectiveTier === "bridge" },
    { key: "later", title: "稍后再学", filter: (q) => q.effectiveTier === "later" },
    { key: "supplement", title: "补充内容（课程外）", filter: (q) => q.effectiveTier === "supplement" },
    { key: "disputed", title: "待核对（不计分）", filter: (q) => q.effectiveTier === "disputed" },
  ];

  // ---- 题单本地筛选：只在已加载的索引上过滤，不重新请求、不改地址栏 ----
  const listFilter = { status: "all", type: "all" };
  const filterCard = el("div", { class: "card" });
  filterCard.appendChild(el("h2", { text: "题单" }));
  const filterBar = el("div", { class: "filters", style: "margin:0" });
  const statusChips = el("div", { class: "chips", role: "group", "aria-label": "按作答状态筛选" });
  [
    { key: "all", label: "全部" },
    { key: "todo", label: "未作答" },
    { key: "wrong", label: "做错" },
    { key: "right", label: "做对" },
  ].forEach((option) => {
    const chip = el("button", { type: "button", class: "chip", text: option.label, "aria-pressed": String(listFilter.status === option.key) });
    chip.addEventListener("click", () => {
      listFilter.status = option.key;
      statusChips.querySelectorAll(".chip").forEach((node, i) => {
        node.setAttribute("aria-pressed", String(["all", "todo", "wrong", "right"][i] === option.key));
      });
      paint();
    });
    statusChips.appendChild(chip);
  });
  filterBar.appendChild(statusChips);

  const typeSelect = el("select", { class: "select", "aria-label": "按题型筛选" });
  [
    ["all", "全部题型"],
    ["single_choice", "单选"],
    ["multi_blank", "多空"],
    ["constructed_response", "综合"],
  ].forEach(([value, text]) => {
    typeSelect.appendChild(el("option", { value, text }));
  });
  typeSelect.addEventListener("change", () => {
    listFilter.type = typeSelect.value;
    paint();
  });
  filterBar.appendChild(typeSelect);
  filterCard.appendChild(filterBar);
  const filterNote = el("p", { class: "sub foot-note", text: "" });
  filterCard.appendChild(filterNote);
  container.appendChild(filterCard);

  const lists = el("div", { class: "chapter-lists" });
  container.appendChild(lists);

  function paint() {
    lists.innerHTML = "";
    const matchStatus = (q) => {
      const record = storage.getAnswer(q.id);
      if (listFilter.status === "todo") return !record || !(record.attempts > 0);
      if (listFilter.status === "wrong") return Boolean(record && record.correct === false);
      if (listFilter.status === "right") return Boolean(record && record.correct === true);
      return true;
    };
    const matchType = (q) => listFilter.type === "all" || q.type === listFilter.type;
    const filtering = listFilter.status !== "all" || listFilter.type !== "all";
    let shown = 0;

    groups.forEach((group) => {
      const all = tagged.filter(group.filter);
      const items = all.filter((q) => matchStatus(q) && matchType(q));
      shown += items.length;
      if (!items.length) return;
      const card = el("div", { class: "card" });
      card.appendChild(el("h2", { text: `${group.title}（${items.length === all.length ? all.length : `${items.length} / ${all.length}`}）` }));
      if (group.key === "disputed") card.appendChild(el("p", { class: "sub", text: "原答案存在疑点，保留原文与审核备注；这些题不计入核心或补充题数量。" }));
      if (group.key === "later") {
        card.appendChild(el("p", { class: "sub", text: "这些题归到本章，但当前学习进度未覆盖；标记本章已学后会进入核心练习。" }));
      }
      const ul = el("ul", { class: "qlist" });
      items.forEach((q) => {
        const record = storage.getAnswer(q.id);
        const li = el("li");
        const a = el("a", { class: "qitem", href: `#/q/${encodeURIComponent(q.id)}` });
        a.appendChild(el("span", { class: "no", text: q.source.originalLabel.replace(/\s/g, "") }));
        a.appendChild(el("span", { class: "txt", text: q.stemText.slice(0, 90) }));
        const metaBox = el("span", { class: "meta" });
        metaBox.appendChild(el("span", { class: `badge ${q.effectiveTier}`, text: tierText(q.effectiveTier) }));
        if (q.reviewStatus === "disputed") metaBox.appendChild(el("span", { class: "badge disputed", text: "待核对" }));
        else if (q.reviewStatus === "systematic") metaBox.appendChild(el("span", { class: "badge", text: "系统映射" }));
        else if (q.reviewStatus === "unreviewed" || q.mappingStatus === "candidate") {
          metaBox.appendChild(el("span", { class: "badge", text: "未审核" }));
        }
        if (q.type !== "single_choice") metaBox.appendChild(el("span", { class: "badge", text: q.type === "multi_blank" ? "多空" : "综合" }));
        if (record && record.correct === true) metaBox.appendChild(el("span", { class: "badge ok", text: "做对" }));
        if (record && record.correct === false) metaBox.appendChild(el("span", { class: "badge bad", text: "做错" }));
        if (record && record.selfAssessment === "got") metaBox.appendChild(el("span", { class: "badge ok", text: "自评会" }));
        if (record && record.selfAssessment === "review") metaBox.appendChild(el("span", { class: "badge bad", text: "需复习" }));
        a.appendChild(metaBox);
        li.appendChild(a);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      lists.appendChild(card);
    });

    if (!shown) {
      lists.appendChild(el("div", { class: "card" }, [
        el("p", { class: "empty", text: "当前筛选没有题目。换成“全部”或换一个题型试试。" }),
      ]));
    }
    filterNote.textContent = filtering
      ? `当前筛选显示 ${shown} / ${tagged.length} 道。`
      : `共 ${tagged.length} 道，按分层分组；点题号进入单题，或用上方按钮进入逐题练习。`;
  }

  paint();

  // 上游没有覆盖的笔记知识点：明确列出缺口，而不是静默地只显示有题的组
  const uncovered = uncoveredTopics(state.meta, state.index, state.topics, chapter.id);
  if (uncovered.length) {
    const card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: `没有对应题的知识点（${uncovered.length}）` }));
    card.appendChild(el("p", { class: "sub", text: "当前映射尚未给这些笔记小节关联题目；这不等于已逐题证明上游没有相关题。后续审核可补充关联，暂不自动造题。" }));
    const wrap = el("div", { class: "topic-list" });
    uncovered.slice(0, 40).forEach((topic) => wrap.appendChild(el("span", { class: "badge", text: topic.title })));
    if (uncovered.length > 40) wrap.appendChild(el("span", { class: "badge", text: `……另有 ${uncovered.length - 40} 个` }));
    card.appendChild(wrap);
    container.appendChild(card);
  }
}

/**
 * 本章知识点里，没有任何一道题把它当作主归属知识点的那些。
 * 只看主归属章 == 本章的题，避免把“挂在别人章节上的知识点”误判成已覆盖。
 */
function buildUncoveredTopics({ chapters, topics, entries }) {
  const covered = new Map();
  entries.forEach((entry) => {
    const key = String(entry.ch);
    if (!covered.has(key)) covered.set(key, new Set());
    entry.topics.forEach((id) => covered.get(key).add(id));
  });
  const out = [];
  chapters.forEach((chapter) => {
    if (!chapter.counts.total) return;
    const set = covered.get(String(chapter.id)) || new Set();
    const missing = (chapter.topicIds || [])
      .map((id) => topics.get(id))
      .filter((topic) => topic && !set.has(topic.id));
    if (missing.length) out.push({ id: String(chapter.id), topics: missing });
  });
  return out;
}

/**
 * 章节页的“没有对应题的知识点”卡片。缺口直接从 meta/index/topics 现算，
 * 这样导入的旧数据没有这个函数也能正常显示。
 */
function uncoveredTopics(meta, index, topics, chapterId) {
  const gaps = buildUncoveredTopics({ chapters: meta.chapters, topics, entries: index.questions });
  const hit = gaps.find((gap) => gap.id === String(chapterId));
  return hit ? hit.topics : [];
}

function tierText(tier) {
  return { core: "核心", bridge: "桥接", supplement: "补充", later: "稍后", disputed: "待核对" }[tier] || tier;
}

/* ------------------------------------------------------------------ */
/* 单题                                                                */
/* ------------------------------------------------------------------ */
async function renderQuestion(id, isCurrent = () => true) {
  const container = main();
  container.innerHTML = "";
  let question = null;
  try {
    const entry = indexEntry(id);
    if (!entry) throw new Error("题目不存在");
    const list = await loadChapter(entry.ch);
    if (!isCurrent()) return;
    question = list.find((q) => q.id === id) || null;
  } catch (error) {
    if (!isCurrent()) return;
    container.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "无法打开这道题" }),
      el("div", { class: "notice bad", text: error.message }),
      el("a", { class: "btn", href: "#/", text: "返回首页" }),
    ]));
    return;
  }
  if (!question) {
    container.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "无法打开这道题" }),
      el("a", { class: "btn", href: "#/", text: "返回首页" }),
    ]));
    return;
  }

  const chapter = chapterMeta(String(question.primaryChapterId));
  const head = el("div", { class: "card" });
  head.appendChild(el("div", {
    class: "crumbs",
    html: `<a href="#/">首页</a> / <a href="#/ch/${encodeURIComponent(question.primaryChapterId)}">${shortLabel(chapter)}</a> / 单题`,
  }));
  head.appendChild(el("h1", { text: "单题查看" }));
  head.appendChild(el("p", { class: "sub", text: "这道题也可以从所属章节的练习流程里进入，作答记录与题单共用。" }));
  const actions = el("div", { class: "actions" });
  actions.appendChild(el("a", {
    class: "btn",
    href: `#/ch/${encodeURIComponent(question.primaryChapterId)}`,
    text: "回到章节题单",
  }));
  if (question.source.sectionId) {
    actions.appendChild(el("a", {
      class: "btn ghost",
      href: `vendor/kaoyan-408-os/${question.source.path}#${question.source.sectionId}`,
      target: "_blank",
      rel: "noopener",
      text: "在原题库中打开本节",
    }));
  }
  head.appendChild(actions);
  container.appendChild(head);

  storage.setUI({ lastChapter: question.primaryChapterId, lastQuestionId: question.id });
  container.appendChild(buildCard(withEffectiveTier(question, completedChapters(state.meta)), {
    topics: state.topics,
    meta: state.meta,
    onChange: () => showToast(storage.isPersistent() ? "记录已保存" : "记录只保留在本页内存中"),
  }));
  const redo = el("button", { type: "button", class: "btn ghost", text: "重做本题" });
  redo.addEventListener("click", () => { storage.resetQuestion(question.id); route(); });
  container.appendChild(el("div", { class: "actions" }, [redo]));
}

/* ------------------------------------------------------------------ */
/* 错题回顾                                                            */
/* ------------------------------------------------------------------ */
async function renderReview(params) {
  const container = main();
  container.innerHTML = "";
  const activeChapter = params && params.ch ? String(params.ch) : "";
  const head = el("div", { class: "card" });
  head.appendChild(el("div", { class: "crumbs", html: '<a href="#/">首页</a> / 错题回顾' }));
  head.appendChild(el("h1", { text: "错题回顾" }));

  const all = storage.reviewEntries();
  const entries = all.filter((item) => !activeChapter || String(indexEntry(item.id)?.ch) === activeChapter);

  // 按章分组给筛选按钮：14 章里往往只有少数几章有错题，按数据现算
  const chapterCounts = new Map();
  all.forEach((item) => {
    const entry = indexEntry(item.id);
    if (!entry) return;
    chapterCounts.set(String(entry.ch), (chapterCounts.get(String(entry.ch)) || 0) + 1);
  });
  if (chapterCounts.size > 1 || activeChapter) {
    const bar = el("div", { class: "actions", style: "margin-top:12px" });
    bar.appendChild(filterChip("#/review", "全部", !activeChapter, all.length));
    Array.from(chapterCounts.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .forEach(([ch, count]) => {
        bar.appendChild(filterChip(`#/review?ch=${encodeURIComponent(ch)}`, `第 ${ch} 章`, activeChapter === ch, count));
      });
    head.appendChild(bar);
  }

  const selfReview = entries.filter((item) => item.record.selfAssessment === "review" && item.record.correct !== false).length;
  head.appendChild(el("p", {
    class: "sub",
    text: entries.length
      ? `共 ${entries.length} 道${activeChapter ? `（只看第 ${activeChapter} 章）` : ""}：答错 ${entries.length - selfReview} 道、自评“还需复习”且未判定答错 ${selfReview} 道。按最近作答时间倒序。`
      : "按最近一次结果统计：答错或自评“还需复习”的题会出现在这里。",
  }));
  container.appendChild(head);

  if (!entries.length) {
    const empty = el("div", { class: "card" });
    empty.appendChild(el("p", { class: "empty", text: activeChapter ? "这一章暂时没有错题。" : "还没有错题。做完第一章核心练习后，答错的题会自动出现在这里。" }));
    empty.appendChild(el("a", { class: "btn primary", href: activeChapter ? `#/ch/${encodeURIComponent(activeChapter)}` : "#/practice/1?scope=core&i=0", text: activeChapter ? "回到章节" : "去练习" }));
    container.appendChild(empty);
    return;
  }

  const card = el("div", { class: "card" });
  const ul = el("ul", { class: "qlist" });
  entries.forEach((item) => {
    const entry = indexEntry(item.id);
    if (!entry) return;
    const record = item.record;
    const li = el("li");
    const row = el("div", { class: "qitem" });
    row.appendChild(el("span", { class: "no", text: entry.label.replace(/\s/g, "") }));
    const txt = el("a", { class: "txt", href: `#/q/${encodeURIComponent(entry.id)}`, text: entry.stem });
    row.appendChild(txt);
    const metaBox = el("span", { class: "meta" });
    metaBox.appendChild(el("a", { class: "badge", href: `#/ch/${encodeURIComponent(entry.ch)}`, text: chapterTitleOf(entry.ch) }));
    if (record.correct === false) {
      metaBox.appendChild(el("span", { class: "badge bad", text: `选 ${record.selected || "—"} / 答 ${entry.answer}` }));
    }
    if (record.selfAssessment === "review") metaBox.appendChild(el("span", { class: "badge disputed", text: "需复习" }));
    const redo = el("button", { type: "button", class: "btn small", text: "重做" });
    redo.addEventListener("click", () => {
      storage.resetQuestion(entry.id);
      showToast("开始重做，首次作答与历史次数保留");
      navigate(`#/q/${encodeURIComponent(entry.id)}`);
    });
    metaBox.appendChild(redo);
    row.appendChild(metaBox);
    li.appendChild(row);
    ul.appendChild(li);
  });
  card.appendChild(ul);
  container.appendChild(card);
}

function filterChip(href, text, active, count) {
  const a = el("a", { class: "btn small ghost", href, text: count === undefined ? text : `${text}（${count}）` });
  if (active) a.classList.add("is-active");
  return a;
}

/* ------------------------------------------------------------------ */
/* 原题库入口                                                          */
/* ------------------------------------------------------------------ */
function renderSource() {
  const container = main();
  container.innerHTML = "";
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "crumbs", html: '<a href="#/">首页</a> / 原题库' }));
  card.appendChild(el("h1", { text: "原题库（完整阅读）" }));
  card.appendChild(el("p", {
    class: "sub",
    text: "这是上游快照的原页面，保留原有导航、搜索与作答脚本。练习记录与本项目互不影响。",
  }));
  const ul = el("ul", { class: "qlist" });
  const chapters = [
    ["第1章 计算机系统概述", "ch1/quiz.html"],
    ["第2章 进程与线程", "ch2/quiz.html"],
    ["第3章 内存管理", "ch3/quiz.html"],
    ["第4章 文件管理", "ch4/quiz.html"],
    ["第5章 输入/输出管理", "ch5/quiz.html"],
  ];
  chapters.forEach(([title, path]) => {
    const li = el("li");
    const a = el("a", { class: "qitem", href: `vendor/kaoyan-408-os/${path}`, target: "_blank", rel: "noopener" });
    a.appendChild(el("span", { class: "no", text: "" }));
    a.appendChild(el("span", { class: "txt", text: title }));
    a.appendChild(el("span", { class: "meta" }, [el("span", { class: "badge", text: "打开" })]));
    li.appendChild(a);
    ul.appendChild(li);
  });
  card.appendChild(ul);
  card.appendChild(el("div", {
    class: "notice",
    text: "公式已改为本站自带的本地 KaTeX 资源，断网也能渲染；原站自带的作答脚本仍可正常使用，但它把记录写在原站的键下，与练习室的记录互不相通。",
  }));
  container.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* 路由与启动                                                          */
/* ------------------------------------------------------------------ */
async function route() {
  const version = ++state.routeVersion;
  const isCurrent = () => state.routeVersion === version;
  if (state.dispose) {
    try { state.dispose(); } catch (error) { /* 清理失败不应阻断页面切换 */ }
    state.dispose = null;
  }
  let name, params;
  const container = main();
  try {
    ({ name, params } = parseHash());
    if (name === "home") { renderNav("home"); await renderHome(); }
    else if (name === "chapter") { renderNav(params.chapterId); await renderChapter(params.chapterId); }
    else if (name === "practice") {
      renderNav(params.chapterId);
      const chapter = chapterMeta(params.chapterId);
      if (!chapter || !chapter.counts.total) { await renderChapter(params.chapterId); return; }
      container.innerHTML = "";
      const dispose = await renderPlayer(container, params, isCurrent);
      if (!isCurrent()) { if (dispose) dispose(); return; }
      state.dispose = dispose;
    }
    else if (name === "question") { renderNav(null); await renderQuestion(params.id, isCurrent); }
    else if (name === "review") { renderNav("review"); await renderReview(params); }
    else if (name === "search") { renderNav(null); await renderSearch(container, params, isCurrent); }
    else if (name === "source") { renderNav(null); renderSource(); }
    else {
      renderNav(null);
      container.innerHTML = "";
      container.appendChild(el("div", { class: "card" }, [
        el("h1", { text: "页面不存在" }),
        el("a", { class: "btn", href: "#/", text: "返回首页" }),
      ]));
    }
  } catch (error) {
    if (!isCurrent()) return;
    container.innerHTML = "";
    container.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "加载失败" }),
      el("div", { class: "notice bad", text: error.message }),
      el("p", { class: "sub", text: "如果直接双击打开了 index.html，请改用 scripts/start.ps1 通过本地 HTTP 服务访问。" }),
    ]));
  }
  if (!isCurrent()) return;
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("navToggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  // 顶栏搜索框回填当前关键词：从搜索结果点进题目再返回时，输入框不该是空的
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = name === "search" ? (params.q || "") : "";
  // 换页后把焦点还给主内容区，读屏与键盘用户不用再从头 Tab
  if (name !== "practice") container.focus({ preventScroll: true });
}

function showStorageWarning(message) {
  const box = document.getElementById("storageWarning");
  box.hidden = false;
  box.textContent = `学习记录无法保存：${message} 当前作答只保留在本页内存中，刷新后会丢失。`;
}

async function boot() {
  try {
    state.meta = await getMeta();
    state.index = await getIndex();
    state.topics = await getTopics();
  } catch (error) {
    main().innerHTML = "";
    main().appendChild(el("div", { class: "card" }, [
      el("h1", { text: "无法加载数据" }),
      el("div", { class: "notice bad", text: error.message }),
      el("p", { class: "sub", text: "请先运行 python scripts/build.py 生成 dist/，再用 scripts/start.ps1 启动本地服务。" }),
    ]));
    return;
  }

  storage.init(state.meta.datasetVersion, showStorageWarning, state.index.questions);
  // 调试钩子：浏览器验收与排障时可以直接看内存里的真实状态（不影响功能）
  window.__osExercises = { storage, meta: state.meta };
  if (!storage.isPersistent()) {
    showStorageWarning(storage.storageFailure());
  }
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault(); main().focus(); main().scrollIntoView({ block: "start" });
  });

  document.getElementById("navToggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    document.getElementById("navToggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
      document.body.classList.remove("nav-open");
      const toggle = document.getElementById("navToggle");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });

  // 移动端点遮罩关闭目录
  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("nav-open")) return;
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("navToggle");
    if (sidebar.contains(event.target) || toggle.contains(event.target)) return;
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
  });

  // 侧栏内点击链接后自动收起
  document.getElementById("sidebar").addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      document.body.classList.remove("nav-open");
      document.getElementById("navToggle").setAttribute("aria-expanded", "false");
    }
  });

  const form = document.getElementById("searchForm");
  const input = document.getElementById("searchInput");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query) navigate(`#/search?q=${encodeURIComponent(query)}`);
  });

  window.addEventListener("hashchange", route);
  await route();
}

boot();
