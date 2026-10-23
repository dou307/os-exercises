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
let questionPolicies = new Map();

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id) => /^c\d+-s\d+-\d+-q\d+(?:-\d+)?$/.test(id);
const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

function normalizeRecord(record, entry) {
  if (!isObject(record) || typeof record.selected !== "string" || !/^[A-H]?$/.test(record.selected)) return null;
  if (![true, false, null].includes(record.correct) || !["auto", "self_assess", "excluded"].includes(record.scoring)) return null;
  if (!Number.isSafeInteger(record.attempts) || record.attempts < 1) return null;
  if (!validDate(record.firstAt) || !validDate(record.lastAt) || Date.parse(record.firstAt) > Date.parse(record.lastAt)) return null;
  if (record.firstCorrect !== undefined && ![true, false, null].includes(record.firstCorrect)) return null;
  if (record.selfAssessment !== undefined && !["got", "review"].includes(record.selfAssessment)) return null;
  if (record.scoring === "auto" && (!record.selected || typeof record.correct !== "boolean")) return null;
  if (record.scoring !== "auto" && record.correct !== null) return null;
  if (entry && record.scoring === "auto"
    && (entry.type !== "single_choice" || ((entry.scoring !== "auto" || entry.review === "disputed") && !entry.legacyAutoAllowed))) return null;
  return {
    selected: record.selected, correct: record.correct, scoring: record.scoring,
    firstCorrect: record.firstCorrect === undefined ? record.correct : record.firstCorrect, attempts: record.attempts,
    firstAt: record.firstAt, lastAt: record.lastAt,
    ...(record.selfAssessment ? { selfAssessment: record.selfAssessment } : {}),
  };
}

function blank() {
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetVersion,
    answers: {},
    drafts: {},
    ui: { completedChapters: [], pending: {}, retrying: {} },
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

export function init(version, failureCallback, entries = []) {
  datasetVersion = version || "unknown";
  questionPolicies = new Map(entries.map((entry) => [entry.id, entry]));
  onFailure = failureCallback || null;
  memoryOnly = false;
  failureReason = "";
  if (!detectStorage()) {
    memoryOnly = true;
    state = blank();
    if (onFailure) onFailure(failureReason);
    return;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : blank();
    if (!isObject(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || !isObject(parsed.answers)
      || !isObject(parsed.drafts || {})) throw new Error("记录结构或版本不受支持");
    const answers = {};
    for (const [id, record] of Object.entries(parsed.answers)) {
      const normalized = validId(id) && normalizeRecord(record);
      if (!normalized) throw new Error("作答字段无效");
      answers[id] = normalized;
    }
    state = { ...blank(), answers, drafts: Object.fromEntries(Object.entries(parsed.drafts || {})
      .filter(([id, text]) => validId(id) && typeof text === "string")), ui: normalizeUI(parsed.ui || {}) };
    state.datasetVersion = datasetVersion;
  } catch (error) {
    memoryOnly = true;
    state = blank();
    failureReason = "读取本地记录失败或版本不受支持；原记录未覆盖，当前临时使用内存记录。";
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
  const record = state.answers[id];
  if (!record) return null;
  const policy = questionPolicies.get(id);
  if (record.scoring === "auto" && policy && (policy.scoring !== "auto" || policy.review === "disputed")) {
    // 原作答不覆盖、不删除；所有当前统计读取投影，导出仍保留真实旧选项、结果和次数。
    return { ...record, correct: null, scoring: "excluded", scoringRetired: true };
  }
  return record;
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
  delete state.ui.retrying[id];
  if (state.ui.pending) delete state.ui.pending[id];
  persist();
  return state.answers[id];
}

export function recordSelfAssessment(id, value) {
  const prev = state.answers[id];
  if (!prev || isRetrying(id)) recordAnswer(id, "", null, "self_assess");
  const now = new Date().toISOString();
  Object.assign(state.answers[id], { selfAssessment: value, lastAt: now });
  persist();
}

/**
 * 只清掉某一题的“自评”结果，不删整条记录里的作答事实。
 * 判断题/综合题再次点“提交答案”时用它重置旧的自评，避免旧结论被静默保留。
 */
export function clearSelfAssessment(id) {
  const prev = state.answers[id];
  if (!prev || !prev.selfAssessment) return;
  delete prev.selfAssessment;
  persist();
}

export function resetQuestion(id) {
  // 重做只开启新一轮；首次结果、次数、自答草稿保留，提交后更新最近结果。
  if (state.answers[id]) state.ui.retrying[id] = true;
  if (state.ui.pending) delete state.ui.pending[id];
  persist();
}

export function isRetrying(id) { return state.ui.retrying[id] === true; }

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

/**
 * `ui` 里既有标量也有数组（completedChapters）。历史版本用 Object.assign 合并，
 * 数组会被展开成 {"0":"3"} 这样的对象，导致“标记已学”实际上从未生效；
 * 读取时把这种形状还原成数组，旧记录不用手动清理也能正确识别。
 */
function normalizeUI(ui) {
  const merged = isObject(ui) ? Object.assign({}, ui) : {};
  if (merged.completedChapters && typeof merged.completedChapters === "object" && !Array.isArray(merged.completedChapters)) {
    merged.completedChapters = Object.values(merged.completedChapters);
  }
  if (!Array.isArray(merged.completedChapters)) merged.completedChapters = [];
  merged.completedChapters = merged.completedChapters.map(String);
  merged.pending = isObject(merged.pending) ? merged.pending : {};
  merged.retrying = isObject(merged.retrying) ? merged.retrying : {};
  return merged;
}

export function setUI(patch) {
  state.ui = normalizeUI(Object.assign({}, state.ui, patch));
  persist();
}

export function stats() {
  const values = Object.keys(state.answers).map(getAnswer);
  return {
    answered: values.length,
    correct: values.filter((a) => a.correct === true).length,
    wrong: values.filter((a) => a.correct === false).length,
    selfAssessed: values.filter((a) => a.selfAssessment).length,
  };
}

export function wrongIds() {
  return Object.keys(state.answers).filter((id) => getAnswer(id).correct === false);
}

/** 错题回顾用的记录：答错，或综合题自评“还需复习”。按最近一次时间倒序。 */
export function reviewEntries() {
  return Object.entries(state.answers)
    .map(([id]) => [id, getAnswer(id)])
    .filter(([, record]) => record.correct === false || record.selfAssessment === "review")
    .map(([id, record]) => ({ id, record: Object.assign({}, record) }))
    .sort((a, b) => String(b.record.lastAt || "").localeCompare(String(a.record.lastAt || "")));
}

/** 某一章的作答统计，题单顶部用它显示“本章进度”。 */
export function chapterStats(ids) {
  let answered = 0;
  let correct = 0;
  ids.forEach((id) => {
    const record = getAnswer(id);
    if (!record) return;
    answered += 1;
    if (record.correct === true) correct += 1;
  });
  return { answered, correct, total: ids.length };
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
    completedChapters: state.ui.completedChapters,
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
  if (!isObject(data)) return { ok: false, message: "文件内容不是对象。" };
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, message: `记录格式版本 ${data.schemaVersion ?? "缺失"} 与当前版本 ${SCHEMA_VERSION} 不一致。` };
  }
  if (!isObject(data.answers) || (data.drafts !== undefined && !isObject(data.drafts))) {
    return { ok: false, message: "文件里没有 answers 记录。" };
  }
  if (data.completedChapters !== undefined && (!Array.isArray(data.completedChapters)
    || data.completedChapters.some((id) => typeof id !== "string" || !/^(?:[1-9]|1[0-5]|2\.1)$/.test(id)))) {
    return { ok: false, message: "已学章节标记格式无效；未导入任何记录。" };
  }

  // 先完整验证，再变更内存或 localStorage，不能导入半份后才报错。
  const normalized = {};
  for (const [id, record] of Object.entries(data.answers)) {
    if (!knownIds.has(id)) continue;
    const clean = normalizeRecord(record, knownIds instanceof Map ? knownIds.get(id) : null);
    if (!clean) return { ok: false, message: `题目 ${id} 的作答字段、时间或计分方式无效；未导入任何记录。` };
    normalized[id] = clean;
  }
  for (const [id, draft] of Object.entries(data.drafts || {})) {
    if (knownIds.has(id) && typeof draft !== "string") return { ok: false, message: `题目 ${id} 的自答草稿不是文本；未导入任何记录。` };
  }

  let added = 0;
  let replaced = 0;
  let skippedUnknown = 0;
  let skippedOlder = 0;

  Object.entries(data.answers).forEach(([id, record]) => {
    if (!knownIds.has(id)) {
      skippedUnknown += 1;
      return;
    }
    const prev = state.answers[id];
    if (!prev) {
      state.answers[id] = normalized[id];
      added += 1;
      return;
    }
    const prevTime = prev.lastAt ? Date.parse(prev.lastAt) : 0;
    const nextTime = record.lastAt ? Date.parse(record.lastAt) : 0;
    if (nextTime > prevTime) {
      const next = normalized[id];
      if (Date.parse(prev.firstAt) < Date.parse(next.firstAt)) {
        next.firstAt = prev.firstAt;
        next.firstCorrect = prev.firstCorrect;
      }
      next.attempts = Math.max(next.attempts, prev.attempts);
      state.answers[id] = next;
      delete state.ui.retrying[id];
      delete state.ui.pending[id];
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
  state.ui.completedChapters = [...new Set([...state.ui.completedChapters, ...(data.completedChapters || [])])];

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
