/** 单用户 GitHub 私有仓库同步：先下载校验合并，再用 SHA 条件写回，冲突重读。 */
import * as storage from "./storage.js";
import { getSettings, getToken } from "./settings.js";

let known = new Map(), pending = false, timer = null, running = null;
let message = "尚未同步", notify = () => {}, revision = 0, merging = false;
const API = "https://api.github.com";
const FILE = "progress-v1.json";

export function initSync(entries, callback = () => {}) {
  known = new Map(entries.map(entry => [entry.id, entry]));
  notify = callback;
}
export function syncStatus() { return message; }
function status(text) { message = text; notify(text); }

async function request(path, method = "GET", payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try { response = await fetch(API + path, {
    method,
    signal: controller.signal,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + getToken(),
      "X-GitHub-Api-Version": "2022-11-28", ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }); } catch (error) {
    if (error.name === "AbortError") throw new Error("GitHub请求超时");
    throw error;
  } finally { clearTimeout(timeout); }
  if (response.status === 404 && method === "GET" && path.includes("/contents/")) return null;
  if (response.status === 409 || response.status === 422) {
    const error = new Error("远端在同步期间发生变化"); error.conflict = true; throw error;
  }
  if (!response.ok) throw new Error(response.status === 401 ? "GitHub令牌无效或已过期"
    : response.status === 403 ? "GitHub权限不足或请求受限"
    : response.status === 404 ? "私有仓库不存在或令牌无权访问"
    : "GitHub请求失败：" + response.status);
  return response.status === 204 ? null : response.json();
}

function encode(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function decode(content) {
  const binary = atob(content.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}
function endpoint() {
  const repository = getSettings().syncRepository || "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("请填写账号/私有仓库名");
  return "/repos/" + repository;
}

async function perform() {
  if (!getToken()) throw new Error("请在设置中连接GitHub，令牌仅用于当前标签页会话");
  const root = endpoint();
  // 每次实际同步检查私有属性，防止用户把学习记录写到公开题库仓库。
  const repository = await request(root);
  if (repository.private !== true) throw new Error("拒绝同步：目标仓库必须是私有仓库");
  if (repository.archived) throw new Error("目标仓库已归档，不能写入");
  const path = root + "/contents/" + FILE;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await request(path);
    if (remote) {
      if (remote.encoding !== "base64" || typeof remote.content !== "string") throw new Error("远端记录文件格式不受支持");
      const incoming = JSON.parse(decode(remote.content));
      const local = storage.exportData();
      // 旧备份没有草稿修改时间，两份不同文字无法推断谁较新，保留双方等待明确编辑。
      for (const [id, text] of Object.entries(incoming.drafts || {})) {
        if (known.has(id) && local.drafts[id] && text && local.drafts[id] !== text
          && !local.draftChanges[id] && !incoming.draftChanges?.[id]) {
          throw new Error(`旧草稿冲突（${id}）：双方均无修改时间；请先导出本机备份，再编辑保存希望保留的草稿后同步`);
        }
      }
      let result;
      merging = true;
      try { result = storage.importData(JSON.stringify(incoming), known); }
      finally { merging = false; }
      if (!result.ok) throw new Error("远端记录未通过校验：" + result.message);
    }
    const beforeUpload = revision;
    const data = storage.exportData();
    const stable = value => JSON.stringify(value, (key, item) => {
      if (key === "exportedAt") return undefined;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b)));
      }
      return item;
    });
    if (remote && stable(data) === stable(JSON.parse(decode(remote.content)))) {
      pending = beforeUpload !== revision; return;
    }
    if (!remote && !Object.keys(data.answers).length && !Object.keys(data.favorites).length
      && !Object.keys(data.drafts).length && !data.completedChapters.length
      && !Object.keys(data.draftChanges).length && !Object.keys(data.chapterChanges).length) {
      pending = false; return;
    }
    try {
      await request(path, "PUT", {
        message: "同步个人OS练习记录",
        content: encode(data),
        ...(remote ? { sha: remote.sha } : {}),
      });
      pending = beforeUpload !== revision;
      return;
    } catch (error) {
      if (!error.conflict || attempt === 2) throw error;
    }
  }
}

export function syncNow() {
  if (running) return running;
  clearTimeout(timer);
  status("正在同步…");
  running = perform().then(() => {
    status("已同步：" + new Date().toLocaleTimeString());
    window.dispatchEvent(new Event("os-exercises:synced"));
  }).catch(error => {
    pending = true;
    status("同步未完成：" + error.message + "；本机记录保留");
    throw error;
  }).finally(() => {
    running = null;
    if (pending && getSettings().syncAuto && getToken()) schedule(30000);
  });
  return running;
}
function schedule(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), delay);
}
export function changed() {
  if (merging) return;
  revision += 1;
  pending = true;
  if (getSettings().syncAuto && getToken()) schedule();
}
export function resumeSync() {
  if (getSettings().syncAuto && getToken()) syncNow().catch(() => {});
}
window.addEventListener("os-exercises:changed", changed);
window.addEventListener("online", resumeSync);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resumeSync(); });
