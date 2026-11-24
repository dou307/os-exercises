/** 当前大题所属章节的题目目录。只负责展示与导航，不改写作答记录。 */

import * as storage from "./storage.js";
import { questionGroup, questionNumbers } from "./numbering.js";
import { questionHash } from "./router.js";
import { SCOPE_TEXT } from "./tiers.js";

const GROUPS = [
  { key: "core", label: SCOPE_TEXT.core },
  { key: "later", label: SCOPE_TEXT.later },
  { key: "supplement", label: SCOPE_TEXT.supplement },
  { key: "disputed", label: "待核对" },
];

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    });
  }
  (children || []).forEach((child) => node.appendChild(child));
  return node;
}

function statusFor(id) {
  const record = storage.getAnswer(id);
  if (!record || !(record.attempts > 0)) return { key: "todo", text: "未作答" };
  if (record.correct === true || record.selfAssessment === "got") return { key: "right", text: "已答对" };
  if (record.correct === false || record.selfAssessment === "review") return { key: "wrong", text: "需复习" };
  return { key: "neutral", text: "已查看" };
}

function setDrawer(open) {
  document.body.classList.toggle("toc-open", open);
  document.getElementById("tocToggle")?.setAttribute("aria-expanded", String(open));
}

function scrollCurrentIntoView(host, active) {
  if (!active) return;
  requestAnimationFrame(() => {
    const hostBox = host.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const offset = activeBox.top - hostBox.top - (host.clientHeight - activeBox.height) / 2;
    host.scrollTop = Math.max(0, host.scrollTop + offset);
  });
}

export function hideChapterQuestionToc() {
  const host = document.getElementById("questionToc");
  if (!host) return;
  if (host._dispose) {
    host._dispose();
    host._dispose = null;
  }
  host.replaceChildren();
  host.hidden = true;
  document.body.classList.remove("question-toc-open");
  setDrawer(false);
}

/**
 * @param {{chapterId: string, chapterTitle: string, questions: object[], completed: Set<string>, currentId: string}} options
 */
export function showChapterQuestionToc({ chapterId, chapterTitle, questions, completed, currentId }) {
  const host = document.getElementById("questionToc");
  if (!host) return;
  if (host._dispose) {
    host._dispose();
    host._dispose = null;
  }

  host.hidden = false;
  host.replaceChildren();
  document.body.classList.add("question-toc-open");
  setDrawer(false);

  const numbers = questionNumbers(questions, completed);
  const grouped = new Map(GROUPS.map((group) => [group.key, []]));
  questions.forEach((question) => {
    const group = questionGroup(question, completed);
    if (grouped.has(group)) grouped.get(group).push(question);
  });

  const head = el("header", { class: "question-toc-head" });
  head.appendChild(el("h2", { text: "本章题目目录" }));
  head.appendChild(el("p", { class: "question-toc-chapter", text: chapterTitle }));
  const progress = el("p", { class: "question-toc-progress" });
  head.appendChild(progress);
  host.appendChild(head);

  const body = el("div", { class: "question-toc-body" });
  const links = [];
  GROUPS.forEach((group) => {
    const items = grouped.get(group.key);
    if (!items.length) return;
    const section = el("section", { class: "question-toc-group" });
    section.appendChild(el("h3", null, [
      el("span", { text: group.label }),
      el("span", { class: "question-toc-count", text: String(items.length) }),
    ]));
    const grid = el("div", { class: "question-toc-grid" });
    items.forEach((question) => {
      const link = el("a", {
        class: "question-toc-link",
        href: questionHash(question.id),
        "data-qid": question.id,
        "aria-current": question.id === currentId ? "page" : null,
      });
      link.appendChild(el("span", { text: String(numbers.get(question.id)) }));
      grid.appendChild(link);
      links.push({ link, question, number: numbers.get(question.id), groupLabel: group.label });
    });
    section.appendChild(grid);
    body.appendChild(section);
  });
  host.appendChild(body);

  const update = () => {
    const answered = questions.filter((question) => {
      const record = storage.getAnswer(question.id);
      return Boolean(record && record.attempts > 0);
    }).length;
    progress.textContent = `已作答 ${answered} / ${questions.length} 道`;
    links.forEach(({ link, question, number, groupLabel }) => {
      const status = statusFor(question.id);
      link.dataset.status = status.key;
      link.title = `${groupLabel} · 第 ${number} 题 · ${status.text}`;
      link.setAttribute("aria-label", `${groupLabel}，第 ${number} 题，${status.text}`);
    });
  };
  update();

  const changed = () => update();
  window.addEventListener("os-exercises:changed", changed);
  host._dispose = () => window.removeEventListener("os-exercises:changed", changed);

  const active = host.querySelector('[aria-current="page"]');
  scrollCurrentIntoView(host, active);
}
