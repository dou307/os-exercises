/**
 * 分层判定。
 *
 * `data/mappings.json` 里的 `readinessTier` 是审核结论：core/bridge 表示“现在可做”，
 * later 表示“归到别的章节/还没学”，supplement 表示课程外补充。
 *
 * 用户可以在界面上把某一章标记为已学完（只存本机）。标记后，该章尚未逐题审核的题目
 * 会从 later 提升为 core（原始分层是 bridge 的仍算 bridge），并且**保留“系统映射/未审核”
 * 徽标**，不会被当成已审核内容。
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

/**
 * 当前学习进度下，一道题实际落在哪个练习范围。
 *
 * 验收脚本会在页面里 import 本模块直接断言，所以这里不依赖任何 DOM。
 * - 答案存疑的题（`disputed`）单独归入“待核对”，永远不自动计分；
 * - 课程外补充题保持 `supplement`；
 * - 本章已确认/本机标记已学时：原核心题保持 `core`，其余（原 bridge，以及跨章就近挂靠、
 *   尚未逐题确认的 later）统一归入 `bridge`——既进核心练习范围，口径上又不与“已审核核心题”混同；
 * - 本章未学时，later 保持 `later`，其余保持原分层，不因为“进度未知”把已审核核心题降级。
 */
export function effectiveTier(question, completed) {
  if (question.reviewStatus === "disputed") return "disputed";
  if (question.readinessTier === "supplement") return "supplement";
  if (completed.has(String(question.primaryChapterId))) {
    return question.readinessTier === "core" ? "core" : "bridge";
  }
  return question.readinessTier === "later" ? "later" : question.readinessTier;
}

/**
 * 合并出“当前进度下实际生效的分层”。题单与练习卡的徽标读的是 `readinessTier`，
 * 所以这里必须把它一起覆盖成实际生效值，只加 `effectiveTier` 会出现“已进核心练习、
 * 徽标却还写着稍后”的错位。
 */
export function withEffectiveTier(question, completed) {
  const tier = effectiveTier(question, completed);
  return Object.assign({}, question, {
    effectiveTier: tier,
    readinessTier: tier,
    originalReadinessTier: question.readinessTier,
  });
}

export function filterByScope(list, scope, completed) {
  const tagged = list.map((q) => withEffectiveTier(q, completed));
  if (scope === "all") return tagged;
  if (scope === "core") return tagged.filter((q) => q.effectiveTier === "core" || q.effectiveTier === "bridge");
  if (scope === "supplement") return tagged.filter((q) => q.effectiveTier === "supplement");
  if (scope === "disputed") return tagged.filter((q) => q.effectiveTier === "disputed");
  if (scope === "later") return tagged.filter((q) => q.effectiveTier === "later");
  if (scope === "wrong") {
    // 只看最近一次结果：答对之后会从错题范围里消失，不会永远挂在上面
    return tagged.filter((q) => {
      const record = storage.getAnswer(q.id);
      return Boolean(record && record.correct === false);
    });
  }
  return tagged;
}

/** 练习范围的中文说明，练习页与章节页共用，避免两处措辞不一致。 */
export const SCOPE_TEXT = {
  core: "核心 + 桥接",
  supplement: "补充内容（课程外）",
  disputed: "待核对（不计分）",
  later: "稍后再学",
  wrong: "本章错题重做",
  all: "全部题目",
};

/** 标记/取消标记本章已学完，只写本机存储。返回 false 表示该章已由用户确认，不允许取消。 */
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
