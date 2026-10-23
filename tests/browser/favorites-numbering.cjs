/** 编号与收藏端到端回归。使用隔离上下文，不修改用户记录。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, firefox } = require("playwright-core");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765/";
const ENGINE = process.env.BROWSER || "chrome";
const OUT = path.resolve(__dirname, "../../_work/favorites-numbering");
const checks = [], errors = [], resources = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log((ok ? "PASS " : "FAIL ") + name);
  assert.ok(ok, name);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await (ENGINE === "firefox" ? firefox : chromium).launch(
    ENGINE === "firefox" ? { headless: true } : { channel: ENGINE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  context.on("page", page => {
    page.on("pageerror", e => errors.push(e.message));
    page.on("response", r => { if (r.status() >= 400) resources.push(r.status() + " " + r.url()); });
  });
  const page = await context.newPage();
  const goto = async hash => {
    await page.goto(BASE + hash, { waitUntil: "networkidle" });
    await page.waitForSelector("main h1");
  };
  const label = () => page.locator(".qhead .question-number").innerText();
  const refresh = () => page.reload({ waitUntil: "networkidle" });
  const state = () => page.evaluate(() => window.__osExercises.storage.exportData());
  try {
    await goto("#/ch/1");
    const core = page.locator(".chapter-lists .card").first();
    const rows = await core.locator(".qitem").evaluateAll(nodes => nodes.map(n => ({
      href: n.getAttribute("href"), number: n.querySelector(".no").textContent,
    })));
    check("核心题单为1至41", rows.length === 41 && rows.every((x, i) => x.number === "第" + (i + 1) + "题"));
    for (const i of [5, 6, 40]) {
      await goto(rows[i].href);
      check("题单与单题编号一致：" + rows[i].number, await label() === rows[i].number);
      await refresh();
      check("刷新保持新编号：" + rows[i].number, await label() === rows[i].number);
    }
    await goto("#/practice/1?scope=core&i=6");
    check("练习题卡也显示第7题，隐藏来源题号和内部ID", await label() === "第7题"
      && await page.locator(".qhead .qid").count() === 0);
    await page.getByRole("button", { name: /下一题/ }).first().click();
    await page.waitForFunction(() => document.querySelector(".question-number")?.textContent === "第8题");
    check("上下题更新新编号", await label() === "第8题");

    await goto("#/ch/1");
    await page.getByLabel("按题型筛选").selectOption("constructed_response");
    const filtered = page.locator(".chapter-lists .qitem").first();
    const filteredLabel = await filtered.locator(".no").innerText();
    await filtered.click();
    check("题型筛选后点入保持筛选编号", await label() === filteredLabel && filteredLabel === "第1题");
    await refresh();
    check("筛选编号刷新仍一致", await label() === filteredLabel);

    await goto("#/q/c1-s1-0-q009");
    check("未收藏题初始可收藏", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "false");
    await page.locator(".favorite-toggle").click();
    await refresh();
    check("手动收藏刷新保留", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "true");
    await goto("#/favorites");
    check("侧栏收藏入口与列表可用", await page.locator('#chapterNav a[href="#/favorites"]').count() === 1
      && await page.locator('a.txt[href="#/q/c1-s1-0-q009"]').count() === 1);
    await page.locator('a.txt[href="#/q/c1-s1-0-q009"]').click();
    check("收藏题沿用题单新编号", await label() === "第6题");

    await goto("#/q/c1-s1-0-q001");
    await page.locator(".opt").first().click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    check("答错自动收藏且按钮立即更新", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "true"
      && (await page.locator(".result").innerText()).includes("已加入收藏"));
    const first = (await state()).answers["c1-s1-0-q001"];
    await page.getByRole("button", { name: "重做本题", exact: true }).click();
    await page.waitForSelector(".opt:not([disabled])");
    await page.locator(".opt").nth(2).click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    const second = (await state()).answers["c1-s1-0-q001"];
    check("重做答对仍收藏，首次结果与累计次数不丢", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "true"
      && second.correct === true && second.firstCorrect === false && second.attempts === 2 && second.firstAt === first.firstAt);
    await page.locator(".favorite-toggle").click();
    await refresh();
    check("取消收藏刷新后不会恢复", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "false");
    await page.getByRole("button", { name: "重做本题", exact: true }).click();
    await page.waitForSelector(".opt:not([disabled])");
    await page.locator(".opt").first().click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    check("取消后再次答错重新收藏", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "true");
    await goto("#/ch/1");
    await page.getByRole("button", { name: "已收藏", exact: true }).click();
    const favorites = await page.locator(".chapter-lists .qitem").count();
    check("章节已收藏筛选只含收藏题", favorites === 2);
    const firstFiltered = page.locator(".chapter-lists .qitem").first();
    const firstFilteredLabel = await firstFiltered.locator(".no").innerText();
    await firstFiltered.click();
    check("收藏筛选后题卡编号一致", await label() === firstFilteredLabel);
    await goto("#/favorites?ch=1");
    await page.getByRole("button", { name: "取消收藏", exact: true }).first().click();
    check("收藏列表可直接取消", await page.locator(".qlist li").count() === 1);

    await goto("#/q/c1-s3-0-q009");
    await page.locator(".opt").first().click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    check("争议题不因选择不同自动收藏", await page.locator(".favorite-toggle").getAttribute("aria-pressed") === "false");

    const imported = await page.evaluate(async () => {
      const s = window.__osExercises.storage;
      const index = (await (await fetch("data/index.json")).json()).questions;
      const known = new Map(index.map(q => [q.id, q]));
      const id = "c1-s1-0-q002";
      const old = "2025-01-01T00:00:00.000Z", newer = "2026-01-01T00:00:00.000Z";
      const backup = { schemaVersion: 1, answers: {}, favorites: { [id]: { saved: true, updatedAt: old } } };
      const add = s.importData(JSON.stringify(backup), known);
      const added = s.isFavorite(id);
      s.setFavorite(id, false);
      const replay = s.importData(JSON.stringify(backup), known);
      const removed = !s.isFavorite(id);
      const snapshot = () => JSON.stringify({ ...s.exportData(), exportedAt: null });
      const before = snapshot();
      const bad = s.importData(JSON.stringify({ ...backup, favorites: {
        [id]: { saved: true, updatedAt: newer }, "c1-s1-0-q003": { saved: "yes", updatedAt: newer },
      }}), known);
      const unchanged = snapshot() === before;
      const unknown = s.importData(JSON.stringify({ schemaVersion: 1, answers: {}, favorites: {
        "unknown-question": { saved: "bad" },
      }}), known);
      return { add, added, replay, removed, bad, unchanged, unknown };
    });
    check("收藏备份可导入，旧备份不撤销较新的取消", imported.add.ok && imported.added && imported.replay.ok && imported.removed);
    check("非法收藏整份拒绝，不部分写入", !imported.bad.ok && imported.unchanged);
    check("未知题目收藏跳过，不阻断已知数据", imported.unknown.ok);
    const legacyImport = await page.evaluate(async () => {
      const s = window.__osExercises.storage;
      const index = (await (await fetch("data/index.json")).json()).questions;
      const known = new Map(index.map(q => [q.id, q]));
      const id = "c1-s1-0-q003", now = "2026-01-01T00:00:00.000Z";
      const backup = { schemaVersion: 1, answers: { [id]: { selected: "A", correct: false, scoring: "auto",
        firstCorrect: false, attempts: 1, firstAt: now, lastAt: now } } };
      const added = s.importData(JSON.stringify(backup), known).ok && s.isFavorite(id);
      s.setFavorite(id, false);
      const replay = s.importData(JSON.stringify(backup), known).ok && !s.isFavorite(id);
      return { added, replay };
    });
    check("旧备份错题补收藏且不恢复手动取消", legacyImport.added && legacyImport.replay);
    const backup = await state();
    const restored = await browser.newContext();
    const restoredPage = await restored.newPage();
    await restoredPage.goto(BASE, { waitUntil: "networkidle" });
    const restoredOk = await restoredPage.evaluate(async data => {
      const s = window.__osExercises.storage;
      const index = (await (await fetch("data/index.json")).json()).questions;
      const result = s.importData(JSON.stringify(data), new Map(index.map(q => [q.id, q])));
      return result.ok && JSON.stringify(s.exportData().favorites) === JSON.stringify(data.favorites)
        && JSON.stringify(s.exportData().answers) === JSON.stringify(data.answers);
    }, backup);
    check("新浏览器导入保留收藏与取消标记及作答", restoredOk);
    await restoredPage.reload({ waitUntil: "networkidle" });
    check("导入后刷新仍保留收藏", await restoredPage.evaluate(() =>
      Object.keys(window.__osExercises.storage.exportData().favorites).length > 0));
    await restored.close();

    const legacy = await browser.newContext();
    const lp = await legacy.newPage();
    await lp.goto(BASE, { waitUntil: "networkidle" });
    await lp.evaluate(() => {
      const now = "2026-01-01T00:00:00.000Z";
      const record = { selected: "A", correct: false, scoring: "auto", firstCorrect: false,
        attempts: 1, firstAt: now, lastAt: now };
      localStorage.setItem("os-exercises:v1", JSON.stringify({ schemaVersion: 1, answers: {
        "c1-s1-0-q001": record, "c2-s1-0-q027": record,
      }, drafts: {} }));
    });
    await lp.reload({ waitUntil: "networkidle" });
    check("旧记录首次补收藏，只补当前可判分的错题", await lp.evaluate(() => {
      const s = window.__osExercises.storage;
      return s.isFavorite("c1-s1-0-q001") && !s.isFavorite("c2-s1-0-q027");
    }));
    await lp.evaluate(() => window.__osExercises.storage.setFavorite("c1-s1-0-q001", false));
    await lp.reload({ waitUntil: "networkidle" });
    check("升级后取消收藏不在刷新时被旧错题恢复", await lp.evaluate(() => !window.__osExercises.storage.isFavorite("c1-s1-0-q001")));
    await legacy.close();

    const malformed = await browser.newContext();
    const mp = await malformed.newPage();
    await mp.goto(BASE, { waitUntil: "networkidle" });
    const broken = JSON.stringify({ schemaVersion: 1, answers: {}, drafts: {}, favorites: {
      "c1-s1-0-q001": { saved: true, updatedAt: "bad-date" },
    } });
    await mp.evaluate(value => localStorage.setItem("os-exercises:v1", value), broken);
    await mp.reload({ waitUntil: "networkidle" });
    check("损坏收藏告警且保留原始本机记录", await mp.locator("#storageWarning").isVisible()
      && await mp.evaluate(() => localStorage.getItem("os-exercises:v1")) === broken);
    await malformed.close();

    const blocked = await browser.newContext();
    await blocked.addInitScript(() => Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("blocked", "SecurityError"); },
    }));
    const bp = await blocked.newPage();
    await bp.goto(BASE + "#/q/c1-s1-0-q001", { waitUntil: "networkidle" });
    await bp.locator(".favorite-toggle").click();
    check("禁用本地存储时可临时收藏并持续告警", await bp.locator("#storageWarning").isVisible()
      && await bp.locator(".favorite-toggle").getAttribute("aria-pressed") === "true");
    await blocked.close();

    await goto("#/search?q=c1-s1-0-q009");
    const searchNumber = await page.locator(".qlist .no").first().innerText();
    await page.locator(".qlist .qitem").first().click();
    check("搜索进入题卡仍沿用新编号", searchNumber === "第6题" && await label() === searchNumber);

    await goto("#/favorites");
    await page.setViewportSize({ width: 390, height: 844 });
    check("收藏页390px无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(OUT, ENGINE + "-favorites-mobile.png"), fullPage: true, animations: "disabled" });
    await goto("#/q/c1-s1-0-q009");
    check("题卡收藏按钮窄屏可见", await page.locator(".favorite-toggle").isVisible()
      && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(OUT, ENGINE + "-card-mobile.png"), fullPage: true, animations: "disabled" });
    check("无脚本错误与资源失败", errors.length === 0 && resources.length === 0);
  } finally {
    fs.writeFileSync(path.join(OUT, ENGINE + "-results.json"), JSON.stringify({ base: BASE, checks, errors, resources }, null, 2));
    await context.close();
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
