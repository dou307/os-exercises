/**
 * 应用入口：加载元数据、初始化存储、渲染课程导航与各视图。
 *
 * 视图：首页 / 章节题单 / 逐题练习 / 单题 / 错题回顾 / 搜索 / 原题库入口。
 */

import * as storage from "./storage.js";
import { getMeta, getIndex, getTopics, getChapterQuestions } from "./questions.js";
import { buildCard, renderPlayer, showToast } from "./practice.js";
import { parseHash, navigate } from "./router.js";
import { renderSearch } from "./search.js";

const state = {
  meta: null,
  index: null,
  topics: null,
  chapterCache: new Map(),
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

function statusText(chapter) {
  const status = state.meta.studyDefaults.chapterStatus[chapter.id];
  if (status === "completed") return "已确认学完";
  return "进度未知";
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
  mainGroup.appendChild(navLink("#/review", "错题回顾", null, false));
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
  const no = el("span", { class: "no", text: "" });
  const label = el("span", { class: "label", text });
  a.appendChild(no);
  a.appendChild(label);
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
  statRow.appendChild(statBox(ch1.counts.coreScored, "第一章可判分"));
  hero.appendChild(statRow);

  const actions = el("div", { class: "actions" });
  actions.appendChild(el("a", { class: "btn primary", href: "#/practice/1?scope=core&i=0", text: "开始第一章核心练习" }));
  const last = storage.getUI().lastQuestionId;
  if (last) actions.appendChild(el("a", { class: "btn", href: `#/q/${encodeURIComponent(last)}`, text: "继续上次的题" }));
  actions.appendChild(el("a", { class: "btn", href: "#/ch/1", text: "查看第一章题单" }));
  actions.appendChild(el("a", { class: "btn ghost", href: "#/review", text: "错题回顾" }));
  hero.appendChild(actions);
  container.appendChild(hero);

  const current = el("div", { class: "card" });
  current.appendChild(el("h2", { text: "当前学习范围" }));
  current.appendChild(el("p", {
    class: "sub",
    text: `第 1 章 ${ch1.title}：已确认学完。可做 ${ch1.counts.core} 道核心题、${ch1.counts.bridge} 道桥接题，其中 ${ch1.counts.disputed} 道待核对题不计分，另有 ${ch1.counts.supplement} 道课程外补充题。`,
  }));
  const note = el("div", { class: "notice" });
  note.textContent = "其余章节的题目只按上游分区初筛，尚未逐题审核；进入对应章节时会明确标注“未审核”，不会把未审核题当作已适配内容。";
  current.appendChild(note);
  container.appendChild(current);

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
    if (chapter.counts.unreviewed) metaBox.appendChild(el("span", { class: "badge", text: "未审核" }));
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
  head.appendChild(el("p", { class: "sub", text: `笔记文件 ${chapter.file} · ${statusText(chapter)}` }));

  if (!chapter.counts.total) {
    head.appendChild(el("div", { class: "notice", text: "原题库没有覆盖这一章的小节，按约定不自动造题填补；缺口在此明确显示。" }));
    container.appendChild(head);
    return;
  }

  const statRow = el("div", { class: "stat-row" });
  statRow.appendChild(statBox(chapter.counts.core, "核心"));
  statRow.appendChild(statBox(chapter.counts.bridge, "桥接"));
  statRow.appendChild(statBox(chapter.counts.supplement, "补充"));
  statRow.appendChild(statBox(chapter.counts.disputed, "待核对"));
  head.appendChild(statRow);

  const actions = el("div", { class: "actions" });
  if (chapter.counts.core || chapter.counts.bridge) {
    actions.appendChild(el("a", { class: "btn primary", href: `#/practice/${encodeURIComponent(chapterId)}?scope=core&i=0`, text: "开始核心练习" }));
  }
  if (chapter.counts.supplement) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=supplement&i=0`, text: "补充题" }));
  }
  if (chapter.counts.disputed) {
    actions.appendChild(el("a", { class: "btn", href: `#/practice/${encodeURIComponent(chapterId)}?scope=disputed&i=0`, text: "待核对题（不计分）" }));
  }
  head.appendChild(actions);
  container.appendChild(head);

  let questions = [];
  try {
    questions = await loadChapter(chapterId);
  } catch (error) {
    container.appendChild(el("div", { class: "card" }, [
      el("div", { class: "notice bad", text: `题目文件加载失败：${error.message}` }),
    ]));
    return;
  }

  const groups = [
    { key: "core", title: "核心练习", filter: (q) => q.readinessTier === "core" || q.readinessTier === "bridge" },
    { key: "supplement", title: "补充内容（课程外）", filter: (q) => q.readinessTier === "supplement" },
    { key: "later", title: "归入其他章节", filter: (q) => q.readinessTier === "later" },
  ];

  groups.forEach((group) => {
    const items = questions.filter(group.filter);
    if (!items.length) return;
    const card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: `${group.title}（${items.length}）` }));
    if (group.key === "core" && chapter.counts.disputed) {
      card.appendChild(el("p", { class: "sub", text: `其中 ${chapter.counts.disputed} 道标为待核对，只读不计分。` }));
    }
    const ul = el("ul", { class: "qlist" });
    items.forEach((q) => {
      const record = storage.getAnswer(q.id);
      const li = el("li");
      const a = el("a", { class: "qitem", href: `#/q/${encodeURIComponent(q.id)}` });
      a.appendChild(el("span", { class: "no", text: q.source.originalLabel.replace(/\s/g, "") }));
      a.appendChild(el("span", { class: "txt", text: q.stemText.slice(0, 90) }));
      const metaBox = el("span", { class: "meta" });
      metaBox.appendChild(el("span", { class: `badge ${q.readinessTier}`, text: tierText(q.readinessTier) }));
      if (q.reviewStatus === "disputed") metaBox.appendChild(el("span", { class: "badge disputed", text: "待核对" }));
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
    container.appendChild(card);
  });
}

function tierText(tier) {
  return { core: "核心", bridge: "桥接", supplement: "补充", later: "其他章" }[tier] || tier;
}

/* ------------------------------------------------------------------ */
/* 单题                                                                */
/* ------------------------------------------------------------------ */
async function renderQuestion(id) {
  const container = main();
  container.innerHTML = "";
  let question = null;
  try {
    const index = state.index;
    const entry = index.questions.find((q) => q.id === id);
    if (!entry) throw new Error("题目不存在");
    const list = await loadChapter(entry.ch);
    question = list.find((q) => q.id === id) || null;
  } catch (error) {
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

  const head = el("div", { class: "card" });
  head.appendChild(el("div", {
    class: "crumbs",
    html: `<a href="#/">首页</a> / <a href="#/ch/${encodeURIComponent(question.primaryChapterId)}">第 ${question.primaryChapterId} 章</a> / 单题`,
  }));
  head.appendChild(el("h1", { text: "单题查看" }));
  head.appendChild(el("p", { class: "sub", text: "这道题也可以从所属章节的练习流程里进入，作答记录与题单共用。" }));
  const actions = el("div", { class: "actions" });
  actions.appendChild(el("a", {
    class: "btn",
    href: `#/ch/${encodeURIComponent(question.primaryChapterId)}`,
    text: "回到章节题单",
  }));
  actions.appendChild(el("a", {
    class: "btn ghost",
    href: `vendor/kaoyan-408-os/${question.source.path}#${question.source.sectionId}`,
    target: "_blank",
    rel: "noopener",
    text: "在原题库中查看",
  }));
  head.appendChild(actions);
  container.appendChild(head);

  container.appendChild(buildCard(question, {
    topics: state.topics,
    onChange: () => showToast("记录已更新"),
  }));
}

/* ------------------------------------------------------------------ */
/* 错题回顾                                                            */
/* ------------------------------------------------------------------ */
async function renderReview() {
  const container = main();
  container.innerHTML = "";
  const head = el("div", { class: "card" });
  head.appendChild(el("div", { class: "crumbs", html: '<a href="#/">首页</a> / 错题回顾' }));
  head.appendChild(el("h1", { text: "错题回顾" }));
  const wrong = storage.wrongIds();
  head.appendChild(el("p", {
    class: "sub",
    text: `按稳定题目 ID 聚合：答错 ${wrong.length} 道。综合题自评为“还需复习”的也计入。`,
  }));
  container.appendChild(head);

  const index = state.index;
  const entries = index.questions.filter((q) => {
    const record = storage.getAnswer(q.id);
    return record && (record.correct === false || record.selfAssessment === "review");
  });

  if (!entries.length) {
    const empty = el("div", { class: "card" });
    empty.appendChild(el("p", { class: "empty", text: "还没有错题。做完第一章核心练习后，答错的题会自动出现在这里。" }));
    empty.appendChild(el("a", { class: "btn primary", href: "#/practice/1?scope=core&i=0", text: "去练习" }));
    container.appendChild(empty);
    return;
  }

  const card = el("div", { class: "card" });
  const ul = el("ul", { class: "qlist" });
  entries.forEach((entry) => {
    const record = storage.getAnswer(entry.id);
    const li = el("li");
    const row = el("div", { class: "qitem", style: "grid-template-columns:44px minmax(0,1fr) auto" });
    row.appendChild(el("span", { class: "no", text: entry.label.replace(/\s/g, "") }));
    row.appendChild(el("span", { class: "txt", text: entry.stem }));
    const metaBox = el("span", { class: "meta" });
    metaBox.appendChild(el("span", { class: "badge bad", text: record.correct === false ? `选 ${record.selected} / 答 ${entry.answer}` : "需复习" }));
    const redo = el("button", { type: "button", class: "btn small", text: "重做" });
    redo.addEventListener("click", () => {
      storage.resetQuestion(entry.id);
      showToast("已清除该题记录，重新作答");
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
  card.appendChild(el("div", { class: "notice", text: "原站页面依赖 CDN 加载公式；断网时公式不渲染，但题目文字仍可阅读。适配版已本地化 KaTeX。" }));
  container.appendChild(card);
}

/* ------------------------------------------------------------------ */
/* 路由与启动                                                          */
/* ------------------------------------------------------------------ */
async function route() {
  const { name, params } = parseHash();
  const container = main();
  try {
    if (name === "home") { renderNav("home"); await renderHome(); }
    else if (name === "chapter") { renderNav(params.chapterId); await renderChapter(params.chapterId); }
    else if (name === "practice") {
      renderNav(params.chapterId);
      const chapter = chapterMeta(params.chapterId);
      if (!chapter || !chapter.counts.total) { await renderChapter(params.chapterId); return; }
      container.innerHTML = "";
      await renderPlayer(container, params);
    }
    else if (name === "question") { renderNav(null); await renderQuestion(params.id); }
    else if (name === "review") { renderNav(null); await renderReview(); }
    else if (name === "search") { renderNav(null); await renderSearch(container, params.q); }
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
    container.innerHTML = "";
    container.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "加载失败" }),
      el("div", { class: "notice bad", text: error.message }),
      el("p", { class: "sub", text: "如果直接双击打开了 index.html，请改用 scripts/start.ps1 通过本地 HTTP 服务访问。" }),
    ]));
  }
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("navToggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function showStorageWarning(message) {
  const container = main();
  const box = el("div", { class: "notice bad", text: `学习记录无法保存：${message} 当前作答只保留在本页内存中，刷新后会丢失。` });
  container.insertBefore(box, container.firstChild);
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

  storage.init(state.meta.datasetVersion, showStorageWarning);
  if (!storage.isPersistent()) {
    showStorageWarning(storage.storageFailure());
  }

  document.getElementById("navToggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    document.getElementById("navToggle").setAttribute("aria-expanded", String(open));
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
