/**
 * 题目卡与练习流程。
 *
 * 判分规则：
 * - `single_choice` 且 `scoring === "auto"`：提交后自动判分，保存实际选择与首次结果。
 * - `multi_blank`：只展示原始选项块与答案，不生成自动判分。
 * - `constructed_response`：先自答，再看参考答案并自评。
 * - `reviewStatus === "disputed"`：显示原答案与勘误，明确标注不计分。
 *
 * 事件一律挂在这一张卡自己的 DOM 上，不往 document 上加监听：
 * 练习页用 hash 直接跳题时不会重新加载文档，留在 document 上的监听会叠加，
 * 导致键盘选中的选项同时落到看不见的旧题卡上。
 */

import * as storage from "./storage.js";
import { getMeta, getTopics, getChapterQuestions, topicTitle } from "./questions.js";
import { completedChapters, filterByScope, SCOPE_TEXT } from "./tiers.js";
import { renderMath } from "./math.js";

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
  // 多空题：题干用（ ）占位，答案用 ①②③ 或“依次对应”编号；这里把两者对应关系写清楚，
  // 否则读者要在长题干里自己数第几个空。
  if (q.type === "multi_blank" && q.optionBlocks && q.optionBlocks.length) {
    wrap.appendChild(el("p", {
      class: "answer-hint",
      text: "多空题按题干中括号的顺序对应：独立空位会标 ①、②……；“依次对应Ⅰ～Ⅵ”表示答案按 Ⅰ、Ⅱ、Ⅲ… 的顺序排列。",
    }));
  }
  const body = el("div", { class: "explain-body", html: q.originalExplanationHtml || "<p>（原站没有解析）</p>" });
  wrap.appendChild(body);
  return wrap;
}

function errataBlock(q) {
  if (!q.errata || !q.errata.length) return null;
  const box = el("div", { class: "errata" });
  box.appendChild(el("h4", { text: "本地审核备注" }));
  const list = el("ul");
  q.errata.forEach((entry) => {
      const kind = entry.kind === "disputed_answer" ? "答案存疑" : (entry.kind === "assumption" ? "前提说明" : (entry.kind === "explanation" ? "解析勘误" : "措辞备注"));
      const item = el("li", { text: `${kind}：${entry.issue}${entry.detail ? ` ${entry.detail}` : ""}` });
      if (entry.suggestedCorrection) item.appendChild(el("p", { text: `修正建议：${entry.suggestedCorrection}` }));
      (entry.evidenceLinks || []).forEach((source) => {
        if (!/^https:\/\//.test(source.url)) return;
        item.appendChild(el("a", { href: source.url, target: "_blank", rel: "noopener noreferrer", text: ` 依据：${source.title}` }));
      });
      list.appendChild(item);
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
 * @param {{onChange?: Function, topics?: Map, meta?: object, chapterLabel?: Function}} ctx
 */
export function buildCard(q, ctx) {
  const topics = ctx.topics || new Map();
  const card = el("article", { class: "card qcard", "data-qid": q.id });

  const head = el("div", { class: "qhead" });
  // readinessTier 是“当前进度下实际生效的分层”，与题单徽标一致；原始审核分层另做一个浅色徽标，
  // 这样“标记已学后被提到核心”的题不会看起来像已通过人工审核的核心题。
  const tier = q.effectiveTier || q.readinessTier;
  head.appendChild(badge(TIER_TEXT[tier] || tier, tier));
  if (q.originalReadinessTier && q.originalReadinessTier !== tier) {
    head.appendChild(badge(`原分层：${TIER_TEXT[q.originalReadinessTier] || q.originalReadinessTier}`, "later"));
  }
  head.appendChild(badge(q.source.originalLabel));
  head.appendChild(badge(TYPE_TEXT[q.type] || q.type));
  const reviewCls = q.reviewStatus === "disputed" ? "disputed" : (q.reviewStatus === "verified" ? "ok" : "");
  head.appendChild(badge(q.answerReview?.status === "qualified" ? "已复核（有备注）" : (REVIEW_TEXT[q.reviewStatus] || q.reviewStatus), reviewCls));
  head.appendChild(el("span", { class: "qid", text: q.id }));
  card.appendChild(head);

  card.appendChild(el("p", {
    class: "qmeta",
    text: `${q.source.sectionTitle}${q.source.subsectionTitle ? ` / ${q.source.subsectionTitle}` : ""}`,
  }));
  if (q.source.title) card.appendChild(el("p", { class: "qmeta", text: `原题标题：${q.source.title}（年份为原站标注）` }));
  if (q.mappingReason) card.appendChild(el("p", { class: "qmeta", text: `章节归属依据：${q.mappingReason}` }));
  const needed = (q.prerequisiteTopicIds || []).filter((id) => {
    const topic = topics.get(id);
    return topic && !(ctx.meta ? completedChapters(ctx.meta) : new Set()).has(String(topic.chapterId));
  });
  if (needed.length) card.appendChild(el("div", { class: "notice", text: `涉及尚未标记学完的知识点：${needed.map((id) => topicTitle(topics, id)).join("、")}。可先阅读相关笔记，再练习本题。` }));
  if (q.reviewStatus === "systematic") card.appendChild(el("p", { class: "notice", text: "本题为系统映射，答案未逐题人工复核；判分依据为原站答案。" }));
  (q.prerequisiteGaps || []).forEach((gap) => card.appendChild(el("div", { class: "notice warn", text: `前置缺口：${gap}` })));

  const stem = el("div", { class: "stem", html: q.stemHtml });
  card.appendChild(stem);

  const recorded = storage.isRetrying(q.id) ? null : storage.getAnswer(q.id);
  const pending = storage.getPending(q.id);
  let selected = recorded && recorded.selected ? recorded.selected : (pending || "");
  let submitted = Boolean(
    recorded
    && (recorded.attempts || 0) > 0
    && (recorded.correct !== null || recorded.selfAssessment || recorded.scoring === "excluded")
  );

  // ---- 选项 ----
  const optionNodes = new Map();
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
    card.appendChild(el("div", {
      class: "notice",
      text: "本题是多个空位的复合题，不能自动判分：做完后展开解析，对照参考答案逐空核对自己写下的选项。",
    }));
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

  // 判分结果要能被读屏软件播报：只改 textContent 不会触发朗读，必须有 aria-live 容器
  const resultBox = el("div", { class: "result", hidden: "hidden", role: "status", "aria-live": "polite" });
  card.appendChild(resultBox);
  const explainBox = explainDetails(q);
  explainBox.hidden = true;
  card.appendChild(explainBox);
  const errata = errataBlock(q);
  if (errata) card.appendChild(errata);
  if (q.answerReview) card.appendChild(el("p", { class: "qmeta", text: `本地逐题复核（${q.answerReview.reviewedAt}）：${q.answerReview.conclusion}` }));

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
    submitted = true;
    optionNodes.forEach((node, key) => {
      node.disabled = true;
      node.setAttribute("aria-pressed", String(record.selected === key));
      if (autoScored(q)) {
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
    // 手机上一道题常常超过一屏，判分结果在折叠线以下；只有真的看不见时才滚动，
    // 桌面上结果本来就可见，强行滚动会打断阅读解析。
    const rect = resultBox.getBoundingClientRect();
    if (rect.top > window.innerHeight - 80) {
      resultBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function reveal() {
    explainBox.hidden = false;
    revealBtn.disabled = true;
    revealBtn.textContent = "解析已展开";
  }

  const selfAssess = buildSelfAssess(q, card, showResult, ctx);

  if (submitted) {
    paintSubmitted(recorded);
    if (recorded.scoringRetired) {
      showResult("neutral", `本题现已列为争议，旧自动判分退出当前统计；原选 ${recorded.selected}、首次时间与次数仍保留。`);
    } else if (recorded.selfAssessment) {
      showResult("neutral", recorded.selfAssessment === "got" ? "自评：已掌握" : "自评：仍需复习");
    } else if (recorded.correct === true) {
      showResult("ok", `回答正确，选 ${recorded.selected}`);
    } else if (recorded.correct === false) {
      showResult("bad", `回答错误，你选了 ${recorded.selected}，原站答案 ${q.originalAnswer}`);
    } else {
      showResult("neutral", "本题不自动计分，答案与解析见下");
    }
    reveal();
    if (!autoScored(q)) selfAssess.show();
  }

  function submit() {
    if (submitted) return;
    if (q.reviewStatus === "disputed") {
      showResult("neutral", `本题为待核对题，不计分。原站答案：${q.originalAnswer}`);
      storage.recordAnswer(q.id, selected, null, "excluded");
      storage.clearPending(q.id);
      paintSubmitted({ selected });
      reveal();
      selfAssess.show();
      onChange();
      return;
    }
    if (autoScored(q)) {
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
        : `回答错误（按原站答案），你选了 ${selected}，原站答案是 ${q.originalAnswer}`);
      reveal();
      onChange();
      return;
    }
    // 多空题与综合题：不自动判分，展开参考答案后自评
    reveal();
    storage.recordAnswer(q.id, "", null, "excluded");
    paintSubmitted({ selected: "" });
    submitBtn.textContent = "已查看答案";
    showResult("neutral", "本题不自动判分，请对照参考答案自评。");
    selfAssess.show();
    onChange();
  }

  function onChange() {
    if (ctx.onChange) ctx.onChange(q.id);
  }

  submitBtn.addEventListener("click", submit);
  revealBtn.addEventListener("click", () => {
    reveal();
    if (q.type !== "single_choice") selfAssess.show();
  });

  renderMath(card);
  return card;
}

/**
 * 自评区：判断题与综合题用。做成“懒创建”，重复点击不会往卡里追加多份按钮。
 */
function buildSelfAssess(q, card, showResult, ctx) {
  let box = null;
  const show = () => {
    if (box) return;
    box = el("div", { class: "actions self-assess" });
    const ok = el("button", { type: "button", class: "btn", text: "自评：会做" });
    const no = el("button", { type: "button", class: "btn", text: "自评：还需复习" });
    const mark = (value, text, kind) => {
      storage.recordSelfAssessment(q.id, value);
      const submit = card.querySelector(".actions .btn.primary");
      submit.disabled = true;
      submit.textContent = "已自评";
      showResult(kind, text);
      if (ctx.onChange) ctx.onChange(q.id);
    };
    ok.addEventListener("click", () => mark("got", "已记为“会做”。", "ok"));
    no.addEventListener("click", () => mark("review", "已记为“还需复习”，会出现在错题回顾里。", "neutral"));
    box.appendChild(ok);
    box.appendChild(no);
    card.appendChild(box);
    renderMath(card);
  };
  return { show };
}

/**
 * 练习页：按章节与范围逐题推进，位置写在 hash 里，刷新可恢复。
 *
 * 返回一个 `dispose()`，路由在离开练习页时调用它撤掉键盘监听。
 */
export async function renderPlayer(main, params, isCurrent = () => true) {
  const chapterId = params.chapterId;
  const scope = params.scope || "core";
  const [topics, meta] = await Promise.all([getTopics(), getMeta()]);
  const completed = completedChapters(meta);
  const list = filterByScope(await getChapterQuestions(chapterId), scope, completed);
  if (!isCurrent()) return () => {};
  if (!list.length) {
    main.innerHTML = "";
    main.appendChild(el("div", { class: "card" }, [
      el("h1", { text: "这个范围暂时没有题目" }),
      el("p", { class: "sub", text: "换一个范围，或回到章节页查看全部题目。" }),
      el("a", { class: "btn", href: `#/ch/${chapterId}`, text: "返回章节" }),
    ]));
    return () => {};
  }
  let index = Number.parseInt(params.i, 10);
  if (params.qid) {
    const stableIndex = list.findIndex((q) => q.id === params.qid);
    if (stableIndex >= 0) index = stableIndex;
  }
  if (!Number.isFinite(index) || index < 0) index = 0;
  if (index >= list.length) index = list.length - 1;

  const chapter = meta.chapters.find((c) => String(c.id) === String(chapterId));
  const chapterTitle = chapter ? (chapter.kind === "supplement" ? `补充 · ${chapter.titleZh}` : `第 ${chapterId} 章`) : `第 ${chapterId} 章`;
  const scopeText = SCOPE_TEXT[scope] || scope;

  const render = () => {
    const q = list[index];
    storage.setUI({ lastChapter: chapterId, lastQuestionId: q.id });
    main.innerHTML = "";

    // 当前范围内的整体进度：只统计本范围，避免“第 3 章 276 道题”这种与练习无关的数字
    const answeredCount = list.filter((item) => {
      const record = storage.getAnswer(item.id);
      return Boolean(record && (record.attempts || 0) > 0);
    }).length;
    const correctCount = list.filter((item) => {
      const record = storage.getAnswer(item.id);
      return Boolean(record && record.correct === true);
    }).length;

    const head = el("div", { class: "card" });
    head.appendChild(el("div", { class: "crumbs", html: `<a href="#/">首页</a> / <a href="#/ch/${encodeURIComponent(chapterId)}">${chapterTitle}</a> / 练习` }));
    head.appendChild(el("h1", { text: `${chapterTitle}练习 · ${scopeText}` }));
    const summary = el("p", {
      class: "sub",
      text: `本范围 ${list.length} 道，已作答 ${answeredCount} 道、答对 ${correctCount} 道 · 进度按稳定题目 ID 记录，换端口不会自动继承`,
    });
    head.appendChild(summary);

    const percent = Math.round(((index + 1) / list.length) * 100);
    const progress = el("div", {
      class: "progress",
      role: "progressbar",
      "aria-valuemin": "1",
      "aria-valuemax": String(list.length),
      "aria-valuenow": String(index + 1),
      "aria-label": `练习进度：第 ${index + 1} 题，共 ${list.length} 题`,
    });
    progress.appendChild(el("span", { class: "bar", style: `width:${percent}%` }));
    head.appendChild(progress);

    const bar = el("div", { class: "pager-bar" });
    const prev = el("button", { type: "button", class: "btn small", text: "← 上一题" });
    prev.disabled = index === 0;
    prev.addEventListener("click", () => go(index - 1));
    const next = el("button", { type: "button", class: "btn small primary", text: "下一题 →" });
    next.disabled = index === list.length - 1;
    next.addEventListener("click", () => go(index + 1));
    const nav = el("div", { class: "actions", style: "margin:0" });
    nav.appendChild(prev);
    nav.appendChild(next);
    const pos = el("span", { class: "pos", text: `第 ${index + 1} / ${list.length} 题` });

    // 题号直达：276 道题的章节靠“下一题”翻页不现实，输入题号即可跳
    const jump = el("label", { class: "jump" });
    jump.appendChild(el("span", { class: "sr-only", text: "跳到第几题" }));
    const jumpInput = el("input", {
      type: "number",
      class: "jump-input",
      min: "1",
      max: String(list.length),
      value: String(index + 1),
      inputmode: "numeric",
      "aria-label": `跳到第几题（1 到 ${list.length}）`,
    });
    const jumpBtn = el("button", { type: "button", class: "btn small", text: "跳转" });
    const doJump = () => {
      const parsed = Number.parseInt(jumpInput.value, 10);
      if (!Number.isFinite(parsed)) { jumpInput.value = String(index + 1); return; }
      const target = Math.min(Math.max(parsed, 1), list.length) - 1;
      if (target === index) { jumpInput.value = String(index + 1); return; }
      go(target);
    };
    jumpBtn.addEventListener("click", doJump);
    jumpInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      // 回车在这里是“跳题”，不能让全局监听把它当成“提交答案”
      event.preventDefault();
      event.stopPropagation();
      doJump();
    });
    jump.appendChild(jumpInput);
    jump.appendChild(jumpBtn);

    bar.appendChild(pos);
    bar.appendChild(jump);
    bar.appendChild(nav);
    head.appendChild(bar);
    head.appendChild(el("p", { class: "kbd-hint", text: "键盘：A–E 选选项 · Enter 提交 · ← → 切题" }));
    main.appendChild(head);

    main.appendChild(buildCard(q, {
      topics,
      meta,
      onChange: () => {
        const answered = list.filter((item) => storage.getAnswer(item.id)).length;
        const correct = list.filter((item) => storage.getAnswer(item.id)?.correct === true).length;
        summary.textContent = `本范围 ${list.length} 道，已作答 ${answered} 道、答对 ${correct} 道 · 进度按稳定题目 ID 记录，换端口不会自动继承`;
        if (!storage.isPersistent()) showToast("本地存储不可用，本次作答未持久保存");
      },
    }));

    const foot = el("div", { class: "actions" });
    const reset = el("button", { type: "button", class: "btn ghost small", text: "重做本题" });
    reset.addEventListener("click", () => {
      storage.resetQuestion(q.id);
      render();
    });
    foot.appendChild(reset);
    foot.appendChild(el("a", { class: "btn ghost small", href: `#/ch/${encodeURIComponent(chapterId)}`, text: "回到章节题单" }));
    main.appendChild(foot);
    main.focus({ preventScroll: true });
  };

  const go = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= list.length) return;
    // 错题答对后会退出范围，重排后的数组下标已变化；用目标 ID 保证不跳过下一题。
    location.hash = `#/practice/${encodeURIComponent(chapterId)}?scope=${encodeURIComponent(scope)}&i=${nextIndex}&qid=${encodeURIComponent(list[nextIndex].id)}`;
  };

  render();

  const keyHandler = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    // 只认当前可见的这张卡，防止把按键作用到已移除的旧卡上
    const card = main.querySelector(".qcard");
    if (!card || !card.isConnected) return;
    const key = event.key.toUpperCase();
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); return; }
    const keys = ["A", "B", "C", "D", "E"];
    const picked = keys.includes(key) ? key : (["1", "2", "3", "4", "5"].includes(event.key) ? keys[Number(event.key) - 1] : null);
    if (picked) {
      const btn = card.querySelector(`.options .opt:nth-child(${keys.indexOf(picked) + 1})`);
      if (btn && !btn.disabled) { event.preventDefault(); btn.click(); }
    }
    if (event.key === "Enter" && !event.shiftKey && !target?.closest("button,a")) {
      const submitBtn = card.querySelector(".actions .btn.primary");
      if (submitBtn && !submitBtn.disabled) { event.preventDefault(); submitBtn.click(); }
    }
  };
  document.addEventListener("keydown", keyHandler);

  return () => document.removeEventListener("keydown", keyHandler);
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
