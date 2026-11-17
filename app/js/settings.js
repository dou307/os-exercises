/** 本机设置不随公开构建发布；令牌仅存在当前标签页会话中。 */
const KEY = "os-exercises:settings:v1";
const TOKEN = "os-exercises:github-token";
let current = {};
let token = "";

export function loadSettings() {
  try { current = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { current = {}; }
  if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
  try { token = sessionStorage.getItem(TOKEN) || ""; } catch { token = ""; }
  return { ...current };
}
export function getSettings() { return { ...current }; }
export function saveSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); return true; } catch { return false; }
}
export function setToken(value) {
  token = value.trim();
  try {
    if (token) sessionStorage.setItem(TOKEN, token); else sessionStorage.removeItem(TOKEN);
  } catch { /* 隐私模式仍允许当前页内存使用 */ }
}
export function getToken() { return token; }
export function noteLink(noteFile, meta) {
  const vault = current.notesVault || (meta.notes && meta.notes.vault) || "";
  const prefix = (current.notesPrefix || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!vault || !noteFile || noteFile.split(/[\\/]/).includes("..")) return "";
  return "obsidian://open?vault=" + encodeURIComponent(vault)
    + "&file=" + encodeURIComponent((prefix ? prefix + "/" : "") + noteFile);
}
