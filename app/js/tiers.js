/**
 * 分层判定。
 *
 * `data/mappings.json` 里的 `readinessTier` 是审核结论：core/bridge 表示“现在可做”，
 * later 表示“归到别的章节/还没学”，supplement 表示课程外补充。
 *
 * 用户可以在界面上把某一章标记为已学完（只存本机）。标记后，该章尚未逐题审核的题目
 * 会从 later 提升为 core，但仍然保留“未审核”徽标，不会被当成已审核内容。
 */

import * as storage from "./storage.js";

export function completedChapters(meta) {
  const set = new Set((meta.studyDefaults.confirmedCompletedChapters || []).map(String));
  const local = storage.getUI().completedChapters || [];
  local.forEach((id) => set.add(String(id)));
  return set;
}

export function isChapterCompleted(meta, chapterId) {
  return completedChapters(meta).has(String(chapterId));
}

export function effectiveTier(question, completed) {
  if (question.reviewStatus === "disputed") return "disputed";
  if (question.readinessTier === "supplement") return "supplement";
  if (completed.has(String(question.primaryChapterId))) {
    return question.readinessTier === "bridge" ? "bridge" : "core";
  }
  return "later";
}

export function withEffectiveTier(question, completed) {
  return Object.assign({}, question, { effectiveTier: effectiveTier(question, completed) });
}

export function filterByScope(list, scope, completed) {
  const tagged = list.map((q) => withEffectiveTier(q, completed));
  if (scope === "all") return tagged;
  if (scope === "core") return tagged.filter((q) => q.effectiveTier === "core" || q.effectiveTier === "bridge");
  if (scope === "supplement") return tagged.filter((q) => q.effectiveTier === "supplement");
  if (scope === "disputed") return tagged.filter((q) => q.effectiveTier === "disputed");
  return tagged;
}

/** 标记/取消标记本章已学完，只写本机存储。 */
export function toggleChapterCompleted(meta, chapterId) {
  const base = new Set((meta.studyDefaults.confirmedCompletedChapters || []).map(String));
  if (base.has(String(chapterId))) {
    // 用户确认过的章节不允许在界面上取消，避免误操作覆盖既有事实
    return false;
  }
  const local = new Set((storage.getUI().completedChapters || []).map(String));
  if (local.has(String(chapterId))) local.delete(String(chapterId));
  else local.add(String(chapterId));
  storage.setUI({ completedChapters: Array.from(local) });
  return true;
}
