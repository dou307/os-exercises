/** 当前课程题单编号。与来源题号、稳定 ID、练习进度分别维护。 */
import * as storage from "./storage.js";
import { effectiveTier } from "./tiers.js";

export function questionGroup(question, completed) {
  const tier = effectiveTier({
    primaryChapterId: question.primaryChapterId ?? question.ch,
    readinessTier: question.readinessTier ?? question.tier,
    reviewStatus: question.reviewStatus ?? question.review,
  }, completed);
  return tier === "core" || tier === "bridge" ? "core" : tier;
}

export function matchesListFilters(question, filters = {}) {
  if (filters.type && filters.type !== "all" && question.type !== filters.type) return false;
  const record = storage.getAnswer(question.id);
  if (filters.status === "todo") return !record || !(record.attempts > 0);
  if (filters.status === "wrong") return Boolean(record && record.correct === false);
  if (filters.status === "right") return Boolean(record && record.correct === true);
  if (filters.status === "favorite") return storage.isFavorite(question.id);
  return true;
}

/** 无筛选时各章、各组独立连续编号，供搜索、收藏、错题与题卡共用。 */
export function questionNumbers(list, completed) {
  const counters = new Map();
  const numbers = new Map();
  list.forEach((q) => {
    const key = String(q.primaryChapterId ?? q.ch) + ":" + questionGroup(q, completed);
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    numbers.set(q.id, next);
  });
  return numbers;
}

/** 从筛选题单进入时沿用筛选编号；离开筛选范围后回退到所属组的编号。 */
export function questionNumber(list, question, completed, filters = {}) {
  const group = questionGroup(question, completed);
  const chapter = String(question.primaryChapterId ?? question.ch);
  const peers = list.filter((q) => String(q.primaryChapterId ?? q.ch) === chapter
    && questionGroup(q, completed) === group);
  const filtered = peers.filter((q) => matchesListFilters(q, filters));
  const index = filtered.findIndex((q) => q.id === question.id);
  return (index >= 0 ? index : peers.findIndex((q) => q.id === question.id)) + 1;
}
