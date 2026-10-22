/**
 * 学习记录存储。
 *
 * 只使用独立命名空间 `os-exercises:v1`，不读写原站的 `os408-*` 键。
 * 记录按稳定题目 ID 保存，包含实际选择、首次结果与最近结果。
 * localStorage 不可用时退回内存并显式告警，不让用户误以为已保存。
 */

const KEY = "os-exercises:v1";
const SCHEMA_VERSION = 1;

let datasetVersion = "unknown";
let state = null;
let memoryOnly = false;
let failureReason = "";
let onFailure = null;

function blank() {
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetVersion,
    answers: {},
    drafts: {},
    ui: {},
  };
}

function detectStorage() {
  try {
    const probe = "__os_exercises_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch (error) {
    failureReason = error && error.name === "SecurityError"
      ? "浏览器禁止了本站点的本地存储（可能是隐私模式或站点设置）。"
      : "浏览器本地存储不可用，可能是空间已满或处于隐私模式。";
    return false;
  }
}

export function init(version, failureCallback) {
  datasetVersion = version || "unknown";
  onFailure = failureCallback || null;
  if (!detectStorage()) {
    memoryOnly = true;
    state = blank();
    if (onFailure) onFailure(failureReason);
    return;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : blank();
    if (!state || typeof state !== "object") state = blank();
    state.answers = state.answers || {};
    state.drafts = state.drafts || {};
    state.ui = state.ui || {};
    if (state.schemaVersion !== SCHEMA_VERSION) {
      // 旧结构不静默丢弃：保留原数据副本后再重建
      window.localStorage.setItem(`${KEY}:backup:${state.schemaVersion}`, raw);
      state = Object.assign(blank(), { answers: state.answers, ui: state.ui });
    }
    state.datasetVersion = datasetVersion;
  } catch (error) {
    memoryOnly = true;
    state = blank();
    failureReason = "读取本地记录失败，已临时使用内存记录。";
    if (onFailure) onFailure(failureReason);
  }
}

function persist() {
  if (memoryOnly) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {
    memoryOnly = true;
    failureReason = "保存学习记录失败（存储空间可能已满），当前进度只保留在本页内存中。";
    if (onFailure) onFailure(failureReason);
  }
}

export function isPersistent() {
  return !memoryOnly;
}

export function storageFailure() {
  return failureReason;
}

export function getAnswer(id) {
  return state.answers[id] || null;
}

/**
 * 记录一次作答。
 * @param {string} id 题目 ID
 * @param {string} selected 实际选择的选项键；综合题传空字符串
 * @param {boolean|null} correct 判定结果；不判分时传 null
 * @param {string} scoring auto | self_assess | excluded
 */
export function recordAnswer(id, selected, correct, scoring) {
  const prev = state.answers[id];
  const now = new Date().toISOString();
  const attempts = (prev && prev.attempts ? prev.attempts : 0) + 1;
  state.answers[id] = {
    selected,
    correct,
    scoring,
    firstCorrect: prev ? prev.firstCorrect : correct,
    attempts,
    firstAt: prev ? prev.firstAt : now,
    lastAt: now,
  };
  persist();
  return state.answers[id];
}

export function recordSelfAssessment(id, value) {
  const prev = state.answers[id] || {};
  const now = new Date().toISOString();
  state.answers[id] = Object.assign(
    { selected: "", correct: null, scoring: "self_assess", firstAt: now },
    prev,
    { selfAssessment: value, lastAt: now, attempts: (prev.attempts || 0) + 1 }
  );
  persist();
}

export function resetQuestion(id) {
  if (state.answers[id]) {
    delete state.answers[id];
    persist();
  }
  if (state.drafts[id]) {
    delete state.drafts[id];
    persist();
  }
}

export function getDraft(id) {
  return state.drafts[id] || "";
}

export function saveDraft(id, text) {
  if (text) state.drafts[id] = text;
  else delete state.drafts[id];
  persist();
}

/** 未提交前的临时选择，用于刷新后恢复“实际选项”。 */
export function getPending(id) {
  return (state.ui.pending && state.ui.pending[id]) || "";
}

export function setPending(id, key) {
  state.ui.pending = Object.assign({}, state.ui.pending, { [id]: key });
  persist();
}

export function clearPending(id) {
  if (state.ui.pending && state.ui.pending[id]) {
    delete state.ui.pending[id];
    persist();
  }
}

export function getUI() {
  return Object.assign({}, state.ui);
}

export function setUI(patch) {
  state.ui = Object.assign({}, state.ui, patch);
  persist();
}

export function stats() {
  const values = Object.values(state.answers);
  return {
    answered: values.length,
    correct: values.filter((a) => a.correct === true).length,
    wrong: values.filter((a) => a.correct === false).length,
    selfAssessed: values.filter((a) => a.selfAssessment).length,
  };
}

export function wrongIds() {
  return Object.keys(state.answers).filter((id) => state.answers[id].correct === false);
}

export function answeredIds() {
  return Object.keys(state.answers);
}

/** 导出学习记录（跨浏览器备份用），含版本与时间，不含页面 UI 状态。 */
export function exportData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetVersion,
    exportedAt: new Date().toISOString(),
    answers: state.answers,
    drafts: state.drafts,
  };
}

/**
 * 导入学习记录：先校验格式与版本，再按题目 ID 合并。
 * 同一题保留 lastAt 较新的一份，未知 ID 跳过并计数，不直接清空现有记录。
 */
export function importData(text, knownIds) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: "不是合法的 JSON 文件。" };
  }
  if (!data || typeof data !== "object") return { ok: false, message: "文件内容不是对象。" };
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, message: `记录格式版本 ${data.schemaVersion ?? "缺失"} 与当前版本 ${SCHEMA_VERSION} 不一致。` };
  }
  if (!data.answers || typeof data.answers !== "object") {
    return { ok: false, message: "文件里没有 answers 记录。" };
  }

  let added = 0;
  let replaced = 0;
  let skippedUnknown = 0;
  let skippedOlder = 0;

  Object.entries(data.answers).forEach(([id, record]) => {
    if (!knownIds.has(id) || !record || typeof record !== "object") {
      skippedUnknown += 1;
      return;
    }
    const prev = state.answers[id];
    if (!prev) {
      state.answers[id] = record;
      added += 1;
      return;
    }
    const prevTime = prev.lastAt ? Date.parse(prev.lastAt) : 0;
    const nextTime = record.lastAt ? Date.parse(record.lastAt) : 0;
    if (nextTime > prevTime) {
      state.answers[id] = record;
      replaced += 1;
    } else {
      skippedOlder += 1;
    }
  });

  let draftsAdded = 0;
  Object.entries(data.drafts || {}).forEach(([id, text]) => {
    if (!knownIds.has(id) || typeof text !== "string" || !text) return;
    if (!state.drafts[id]) {
      state.drafts[id] = text;
      draftsAdded += 1;
    }
  });

  persist();
  return {
    ok: true,
    added,
    replaced,
    skippedUnknown,
    skippedOlder,
    draftsAdded,
    datasetVersion: data.datasetVersion || "unknown",
    persistent: !memoryOnly,
  };
}
