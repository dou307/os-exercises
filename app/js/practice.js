/**
 * 题目卡与练习流程。
 *
 * 判分规则：
 * - `single_choice` 且 `scoring === "auto"`：提交后自动判分，保存实际选择与首次结果。
 * - `multi_blank`：只展示原始选项块与答案，不生成自动判分。
 * - `constructed_response`：先自答，再看参考答案并自评。
 * - `reviewStatus === "disputed"`：显示原答案与勘误，明确标注不计分。
 */

import * as storage from "./storage.js";
import { getMeta, getTopics, getChapterQuestions, topicTitle } from "./questions.js";
import { completedChapters, filterByScope } from "./tiers.js";
import { renderMath } from "./math.js";

const TIER_TEXT = { core: "核心", bridge: "桥接", supplement: "补充", later: "稍后" };
const REVIEW_TEXT = {
  verified: "已核对",
  reviewed: "已核对归属",
  disputed: "待核对",
  candidate: "未审核",
  unreviewed: "未审核",
  unresolved: "归属未定",
};
const TYPE_TEXT = {
  single_choice: "单选",
  multi_blank: "多空/复合",
  constructed_response: "综合题",
};

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

function badge(text, cls) {
  return el("span", { class: `badge${cls ? ` ${cls}` : ""}`, text });
}

function autoScored(q) {
  return q.scoring === "auto" && q.type === "single_choice";
}

function explainDetails(q) {
  const wrap = el("div", { class: "explain" });
  wrap.appendChild(el("div", { class: "answer-line", text: `原站答案：${q.originalAnswer || "—"}` }));
  const body = el("div", { html: q.originalExplanationHtml || "<p>（原站没有解析）</p>" });
  wrap.appendChild(body);
  return wrap;
}

function errataBlock(q) {
  if (!q.errata || !q.errata.length) return null;
  const box = el("div", { class: "errata" });
  box.appendChild(el("h4", { text: "本地审核备注" }));
  const list = el("ul");
  q.errata.forEach((entry) => {
    const kind = entry.kind === "disputed_answer" ? "答案存疑" : (entry.kind === "assumption" ? "前提说明" : "措辞备注");
    list.appendChild(el("li", { text: `${kind}：${entry.issue}${entry.detail ? ` ${entry.detail}` : ""}` }));
  });
  box.appendChild(list);
  if (q.errata.some((e) => e.scoring === "excluded")) {
    box.appendChild(el("p", { text: "本题不进入自动计分，只用于阅读与自评。", style: "margin:8px 0 0" }));
  }
  return box;
}

/**
 * 构建题目卡。
 * @param {object} q 题目
 * @param {{onChange?: Function, topics?: Map}} ctx
 */
export function buildCard(q, ctx) {
  const topics = ctx.topics || new Map();
  const card = el("article", { class: "card qcard", "data-qid": q.id });

  const head = el("div", { class: "qhead" });
  head.appendChild(badge(TIER_TEXT[q.readinessTier] || q.readinessTier, q.readinessTier));
  head.appendChild(badge(q.source.originalLabel));
  head.appendChild(badge(TYPE_TEXT[q.type] || q.type));
  const reviewCls = q.reviewStatus === "disputed" ? "disputed" : (q.reviewStatus === "verified" ? "ok" : "");
  head.appendChild(badge(REVIEW_TEXT[q.reviewStatus] || q.reviewStatus, reviewCls));
  head.appendChild(el("span", { class: "qid", text: q.id }));
  card.appendChild(head);

  card.appendChild(el("p", {
    class: "qmeta",
    text: `${q.source.sectionTitle}${q.source.subsectionTitle ? ` / ${q.source.subsectionTitle}` : ""}`,
  }));

  const stem = el("div", { class: "stem", html: q.stemHtml });
  card.appendChild(stem);

  const recorded = storage.getAnswer(q.id);
  const pending = storage.getPending(q.id);
  let selected = recorded && recorded.selected ? recorded.selected : (pending || "");
  const submitted = Boolean(
    recorded
    && (recorded.attempts || 0) > 0
    && (recorded.correct !== null || recorded.selfAssessment || recorded.scoring === "excluded")
  );

  // ---- 选项 ----
  let optionNodes = new Map();
  if (q.type === "single_choice") {
    const list = el("ul", { class: "options" });
    q.options.forEach((option) => {
      const btn = el("button", { type: "button", class: "opt", "aria-pressed": String(selected === option.key) });
      btn.appendChild(el("span", { class: "key", text: option.key }));
      btn.appendChild(el("span", { class: "opt-text", html: option.html }));
      btn.addEventListener("click", () => {
        if (submitted) return;
        selected = option.key;
        storage.setPending(q.id, selected);
        optionNodes.forEach((node, key) => node.setAttribute("aria-pressed", String(key === selected)));
      });
      optionNodes.set(option.key, btn);
      list.appendChild(btn);
    });
    card.appendChild(list);
  } else if (q.type === "multi_blank") {
    const wrap = el("div", { class: "opt-blocks" });
    q.optionBlocks.forEach((block) => wrap.appendChild(el("div", { html: block.rawHtml })));
    card.appendChild(wrap);
  } else {
    const box = el("div", { class: "self-answer" });
    const id = `draft-${q.id}`;
    box.appendChild(el("label", { for: id, text: "先自己作答（只保存在本机，不参与判分）" }));
    const area = el("textarea", { id, placeholder: "写下思路、时序表或关键结论…" });
    area.value = storage.getDraft(q.id);
    area.addEventListener("input", () => storage.saveDraft(q.id, area.value));
    area.addEventListener("keydown", (event) => event.stopPropagation());
    box.appendChild(area);
    card.appendChild(box);
  }

  // ---- 操作区 ----
  const actions = el("div", { class: "actions" });
  const submitBtn = el("button", { type: "button", class: "btn primary", text: "提交答案" });
  const revealBtn = el("button", { type: "button", class: "btn ghost", text: "查看解析" });
  actions.appendChild(submitBtn);
  actions.appendChild(revealBtn);
  card.appendChild(actions);

  const resultBox = el("div", { class: "result", hidden: "hidden" });
  card.appendChild(resultBox);
  const explainBox = explainDetails(q);
  explainBox.hidden = true;
  card.appendChild(explainBox);
  const errata = errataBlock(q);
  if (errata) card.appendChild(errata);

  if (q.topicIds && q.topicIds.length) {
    const topicsBox = el("div", { class: "topic-list" });
    q.topicIds.forEach((tid) => topicsBox.appendChild(badge(topicTitle(topics, tid))));
    card.appendChild(topicsBox);
  }

  const notes = ctx.meta && ctx.meta.notes;
  const firstTopic = q.topicIds && q.topicIds.length ? topics.get(q.topicIds[0]) : null;
  if (notes && notes.configured && firstTopic && firstTopic.noteFile) {
    const uri = `obsidian://open?vault=${encodeURIComponent(notes.vault)}&file=${encodeURIComponent(firstTopic.noteFile)}`;
    const row = el("div", { class: "actions" });
    row.appendChild(el("a", {
      class: "btn ghost small",
      href: uri,
      text: `在笔记中打开 ${firstTopic.noteFile}`,
    }));
    card.appendChild(row);
  }

  function paintSubmitted(record) {
    optionNodes.forEach((node, key) => {
      node.disabled = true;
      node.setAttribute("aria-pressed", String(record.selected === key));
      if (q.type === "single_choice") {
        if (key === q.originalAnswer) node.classList.add("is-right");
        else if (record.selected === key) node.classList.add("is-wrong");
      }
    });
    submitBtn.disabled = true;
    submitBtn.textContent = "已提交";
  }

  function showResult(kind, text) {
    resultBox.hidden = false;
    resultBox.className = `result ${kind}`;
    resultBox.textContent = text;
  }

  function reveal() {
    explainBox.hidden = false;
    revealBtn.disabled = true;
    revealBtn.textContent = "解析已展开";
  }

  if (submitted) {
    paintSubmitted(recorded);
    if (recorded.selfAssessment) {
      showResult("neutral", recorded.selfAssessment === "got" ? "自评：已掌握" : "自评：仍需复习");
    } else if (recorded.correct === true) {
      showResult("ok", `回答正确，选 ${recorded.selected}`);
    } else if (recorded.correct === false) {
      showResult("bad", `回答错误，你选了 ${recorded.selected}，原站答案 ${q.originalAnswer}`);
    } else {
      showResult("neutral", "本题不自动计分，答案与解析见下");
    }
    if (recorded.correct === false || recorded.selfAssessment) reveal();
  }

  function submit() {
    if (q.reviewStatus === "disputed") {
      showResult("neutral", `本题为待核对题，不计分。原站答案：${q.originalAnswer}`);
      storage.recordAnswer(q.id, selected, null, "excluded");
      storage.clearPending(q.id);
      if (optionNodes.size) paintSubmitted({ selected });
      reveal();
      if (ctx.onChange) ctx.onChange(q.id);
      return;
    }
    if (q.type === "single_choice") {
      if (!selected) {
        showResult("neutral", "请先选择一个选项。");
        return;
      }
      const correct = selected === q.originalAnswer;
      storage.recordAnswer(q.id, selected, correct, q.scoring);
      storage.clearPending(q.id);
      paintSubmitted({ selected });
      showResult(correct ? "ok" : "bad", correct
        ? `回答正确，选 ${selected}`
        : `回答错误，你选了 ${selected}，正确答案是 ${q.originalAnswer}`);
      reveal();
      if (ctx.onChange) ctx.onChange(q.id);
      return;
    }
    // 多空题与综合题：不自动判分，展开参考答案后自评
    reveal();
    storage.recordAnswer(q.id, "", null, "excluded");
    submitBtn.disabled = true;
    submitBtn.textContent = "已查看答案";
    showResult("neutral", "本题不自动判分，请对照参考答案自评。");
    appendSelfAssess(card, q, showResult, ctx);
    if (ctx.onChange) ctx.onChange(q.id);
  }

  submitBtn.addEventListener("click", submit);
  revealBtn.addEventListener("click", () => {
    reveal();
    if (q.type !== "single_choice" && !card.querySelector(".self-assess")) {
      appendSelfAssess(card, q, showResult, ctx);
    }
  });

  renderMath(card);
  return card;
}

function appendSelfAssess(card, q, showResult, ctx) {
  if (card.querySelector(".self-assess")) return;
  const box = el("div", { class: "actions self-assess" });
  const ok = el("button", { type: "button", class: "btn", text: "自评：会做" });
  const no = el("button", { type: "button", class: "btn", text: "自评：还需复习" });
  ok.addEventListener("click", () => {
    storage.recordSelfAssessment(q.id, "got");
    showResult("ok", "已记为“会做”。");
    if (ctx.onChange) ctx.onChange(q.id);
  });
  no.addEventListener("click", () => {
    storage.recordSelfAssessment(q.id, "review");
    showResult("neutral", "已记为“还需复习”，会出现在错题回顾里。");
    if (ctx.onChange) ctx.onChange(q.id);
  });
  box.appendChild(ok);
  box.appendChild(no);
  card.appendChild(box);
}

/** 练习页：按章节与范围逐题推进，位置写在 hash 里，刷新可恢复。 */
export async function renderPlayer(main, params) {
  const chapterId = params.chapterId;
  const scope = params.scope || "core";
  const [topics, meta] = await Promise.all([getTopics(), getMeta()]);
  const completed = completedChapters(meta);
  const list = filterByScope(await getChapterQuestions(chapterId), scope, completed);
  if (!list.length) {
    main.innerHTML = "";
    main.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "这个范围暂时没有题目" }),
      el("p", { class: "sub", text: "换一个范围，或回到章节页查看全部题目。" }),
      el("a", { class: "btn", href: `#/ch/${chapterId}`, text: "返回章节" }),
    ]));
    return;
  }
  let index = Number.parseInt(params.i, 10);
  if (!Number.isFinite(index) || index < 0) index = 0;
  if (index >= list.length) index = list.length - 1;

  const render = () => {
    const q = list[index];
    storage.setUI({ lastChapter: chapterId, lastQuestionId: q.id });
    main.innerHTML = "";

    const head = el("div", { class: "card" });
    const scopeText = scope === "core" ? "核心 + 桥接"
      : scope === "supplement" ? "补充内容"
      : scope === "disputed" ? "待核对"
      : "全部题目";
    head.appendChild(el("div", { class: "crumbs", html: `<a href="#/">首页</a> / <a href="#/ch/${chapterId}">第 ${chapterId} 章</a> / 练习` }));
    head.appendChild(el("h1", { text: `第 ${chapterId} 章练习 · ${scopeText}` }));
    head.appendChild(el("p", { class: "sub", text: `范围：${scopeText}。进度按稳定题目 ID 记录，换端口不会自动继承。` }));
    const bar = el("div", { class: "pager-bar" });
    bar.appendChild(el("span", { class: "pos", text: `第 ${index + 1} / ${list.length} 题` }));
    const nav = el("div", { class: "actions", style: "margin:0" });
    const prev = el("button", { type: "button", class: "btn small", text: "← 上一题" });
    prev.disabled = index === 0;
    prev.addEventListener("click", () => go(index - 1));
    const next = el("button", { type: "button", class: "btn small primary", text: "下一题 →" });
    next.disabled = index === list.length - 1;
    next.addEventListener("click", () => go(index + 1));
    nav.appendChild(prev);
    nav.appendChild(next);
    bar.appendChild(nav);
    head.appendChild(bar);
    main.appendChild(head);

    const card = buildCard(q, {
      topics,
      meta,
      onChange: () => {
        // 章节页的统计不常驻，这里只提示已保存状态
        if (!storage.isPersistent()) showToast("本地存储不可用，本次作答未持久保存");
      },
    });
    main.appendChild(card);

    const foot = el("div", { class: "actions" });
    const reset = el("button", { type: "button", class: "btn ghost small", text: "重做本题" });
    reset.addEventListener("click", () => {
      storage.resetQuestion(q.id);
      render();
    });
    foot.appendChild(reset);
    foot.appendChild(el("a", { class: "btn ghost small", href: `#/ch/${chapterId}`, text: "回到章节题单" }));
    main.appendChild(foot);
    main.focus({ preventScroll: true });
  };

  const go = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= list.length) return;
    location.hash = `#/practice/${chapterId}?scope=${scope}&i=${nextIndex}`;
  };

  render();

  const keyHandler = (event) => {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const card = main.querySelector(".qcard");
    if (!card) return;
    const key = event.key.toUpperCase();
    if (key === "ARROWRIGHT") { event.preventDefault(); go(index + 1); return; }
    if (key === "ARROWLEFT") { event.preventDefault(); go(index - 1); return; }
    const keys = ["A", "B", "C", "D", "E"];
    const target = keys.includes(key) ? key : (["1", "2", "3", "4", "5"].includes(event.key) ? keys[Number(event.key) - 1] : null);
    if (target) {
      const btn = card.querySelector(`.options .opt:nth-child(${keys.indexOf(target) + 1})`);
      if (btn && !btn.disabled) { event.preventDefault(); btn.click(); }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const submitBtn = card.querySelector(".actions .btn.primary");
      if (submitBtn && !submitBtn.disabled) { event.preventDefault(); submitBtn.click(); }
    }
  };
  document.addEventListener("keydown", keyHandler);
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", keyHandler), { once: true });
}

let toastTimer = null;
export function showToast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}
