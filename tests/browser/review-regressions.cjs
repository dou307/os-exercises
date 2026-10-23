/** 审查回归：始终用隔离的浏览器上下文，不读写用户浏览器的学习记录。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, firefox } = require("playwright-core");
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "_work/review-2026-10-23");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765/";
const ENGINE = process.env.BROWSER || "chrome";
const checks = [], errors = [], failures = [];
const check = (name, value, detail = "") => {
  checks.push({ name, ok: Boolean(value), detail });
  console.log(`${value ? "PASS" : "FAIL"} ${name} ${detail}`);
  assert.ok(value, name);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await (ENGINE === "firefox" ? firefox : chromium).launch(
    ENGINE === "firefox" ? { headless: true } : { headless: true, channel: ENGINE });
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    context.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
      p.on("response", (res) => { if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
    });
    const page = await context.newPage();
    const goto = async (hash) => {
      await page.goto(BASE + hash, { waitUntil: "networkidle" });
      await page.waitForSelector("main h1");
    };
    await goto("");
    check("首页数量采用互斥口径", (await page.locator("main").innerText()).includes("核心 40、桥接 1、补充 12、待核对 3"));
    await goto("#/ch/1");
    const listed = await page.locator('.chapter-lists a.qitem').evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    check("第一章 56 道全部且仅出现一次，包含 3 道待核对", listed.length === 56 && new Set(listed).size === 56
      && listed.includes("#/q/c1-s2-0-q009") && listed.includes("#/q/c1-s3-0-q011"));
    await page.screenshot({ path: path.join(OUT, `${ENGINE}-chapter.png`), fullPage: true });

    // 错题重做：首次历史、次数、未提交选项均应保持正确。
    const qid = "c1-s1-0-q001";
    await goto(`#/q/${qid}`);
    await page.locator(".opt").first().click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    const first = await page.evaluate((id) => window.__osExercises.storage.getAnswer(id), qid);
    check("首次错答计一次", first.correct === false && first.attempts === 1);
    await goto("#/review");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.waitForSelector(".qcard");
    const afterReset = await page.evaluate((id) => window.__osExercises.storage.getAnswer(id), qid);
    check("重做不删除历史且清除旧选择", afterReset.firstAt === first.firstAt && afterReset.attempts === 1
      && await page.locator('.opt[aria-pressed="true"]').count() === 0);
    await page.locator(".opt").nth(2).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".qcard");
    check("重做刷新恢复新选项并保持待提交", await page.locator('.opt[aria-pressed="true"]').innerText() === "C全部软硬件资源"
      || (await page.locator('.opt[aria-pressed="true"] .key').innerText()) === "C");
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    const second = await page.evaluate((id) => window.__osExercises.storage.getAnswer(id), qid);
    check("再次提交保留首次错答，更新最近结果并累计次数", second.correct === true && second.firstCorrect === false
      && second.attempts === 2 && second.firstAt === first.firstAt);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".qcard");
    check("正确题刷新后解析仍展开", await page.locator(".explain").isVisible());
    await goto("#/review");
    check("重做正确后退出错题列表", await page.locator(`a.txt[href="#/q/${qid}"]`).count() === 0);

    await goto("#/q/c1-s5-0-q001");
    await page.locator("textarea").fill("保留这段自答草稿");
    await page.getByRole("button", { name: "查看解析", exact: true }).click();
    await page.getByRole("button", { name: "自评：还需复习", exact: true }).click();
    await page.getByRole("button", { name: "自评：会做", exact: true }).click();
    const self = await page.evaluate(() => window.__osExercises.storage.getAnswer("c1-s5-0-q001"));
    check("修改同次自评不虚增次数", self.attempts === 1 && self.correct === null && self.selfAssessment === "got");
    await page.getByRole("button", { name: "重做本题", exact: true }).click();
    check("综合题重做保留自答草稿", await page.locator("textarea").inputValue() === "保留这段自答草稿");
    await goto("#/q/c1-s3-0-q009");
    await page.locator(".opt").first().click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    check("争议题无正确/错误颜色且不计分", await page.locator(".opt.is-right,.opt.is-wrong").count() === 0);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".qcard");
    check("争议题刷新后仍可查看解析与自评", await page.locator(".explain").isVisible() && await page.locator(".self-assess").isVisible());
    await goto("#/q/c1-s3-0-q017");
    check("桥接题显示尚未学完的前置知识", (await page.locator(".qcard").innerText()).includes("涉及尚未标记学完的知识点"));

    await goto("#/ch/3");
    await page.getByRole("button", { name: "标记本章已学完", exact: true }).click();
    await goto("#/search?ch=3&tier=bridge");
    const reviewIndex = await page.evaluate(async () => (await (await fetch("data/index.json")).json()).questions);
    const chapter3Available = reviewIndex.filter((q) => q.ch === "3" && q.review !== "disputed" && q.tier !== "supplement").length;
    check("已学标记在搜索桥接筛选中生效", await page.locator(".qlist li").count() === chapter3Available);
    await page.locator(".qlist a.qitem").nth(1).click();
    await page.waitForSelector(".qcard");
    check("单题徽标与搜索分层一致，已审题不再标系统映射", await page.locator(".qhead .badge.bridge").count() === 1
      && !(await page.locator(".qhead").innerText()).includes("系统映射"));
    await goto("#/search?ch=1&tier=disputed");
    check("待核对搜索仅显示三题", await page.locator(".qlist li").count() === 3);
    await goto("#/search?q=Threads%20and%20Concurrency");
    check("章节名称可搜索", await page.locator(".qlist li").count() === reviewIndex.filter((q) => q.ch === "4").length);
    const questions = JSON.parse(fs.readFileSync(path.join(ROOT, "data/questions.json"), "utf8")).questions;
    const long = questions.find((q) => q.stemText.length > 400 && q.type === "constructed_response");
    const tail = long.stemText.slice(-28).trim();
    await goto(`#/search?q=${encodeURIComponent(tail)}`);
    check("可搜索长题干末尾，不受旧 180 字截断限制", await page.locator(`a.qitem[href="#/q/${long.id}"]`).count() === 1);
    await goto("#/search?type=single_choice");
    check("搜索准确显示总命中量与前 100 条限制", (await page.locator("main .sub").first().innerText()).includes("命中 645 道")
      && await page.locator(".qlist li").count() === 100);

    // 验证导入先完整校验，再原子合并；正常旧版导出没有 completedChapters 也应可读。
    const imports = await page.evaluate(async () => {
      const s = window.__osExercises.storage;
      const index = await (await fetch("data/index.json")).json();
      const known = new Map(index.questions.map((q) => [q.id, q]));
      const before = JSON.stringify(s.exportData().answers);
      const good = s.getAnswer("c1-s1-0-q001");
      const a = s.importData(JSON.stringify({ schemaVersion: 1, answers: {
        "c1-s1-0-q003": good, "c1-s1-0-q002": { ...good, attempts: "oops" },
      } }), known);
      const b = s.importData(JSON.stringify({ schemaVersion: 1, answers: { "c1-s1-0-q002": null } }), known);
      const c = s.importData(JSON.stringify({ schemaVersion: 1, answers: { "c1-s1-0-q002": { ...good, lastAt: "wrong" } } }), known);
      const d = s.importData(JSON.stringify({ schemaVersion: 1, answers: { "c1-s3-0-q009": good } }), known);
      const unchanged = before === JSON.stringify(s.exportData().answers);
      const e = s.importData(JSON.stringify({ schemaVersion: 1, answers: {}, drafts: {}, completedChapters: ["4"] }), known);
      const f = s.importData(JSON.stringify({ schemaVersion: 1, answers: {} }), known);
      return { a, b, c, d, e, f, unchanged, completed: s.exportData().completedChapters };
    });
    check("损坏/空记录/错误日期/争议题自动分数均拒绝，且无部分导入", !imports.a.ok && !imports.b.ok && !imports.c.ok && !imports.d.ok && imports.unchanged);
    check("导出导入保留本机已学章节，并兼容旧备份", imports.e.ok && imports.f.ok && imports.completed.includes("3") && imports.completed.includes("4"));

    // 深层路由与无题章节均不得造成资源错误。
    for (const id of ["2.1", "15"]) {
      await goto(`#/practice/${id}?scope=core&i=0`);
      check(`无题章节 ${id} 有明确说明`, (await page.locator("main").innerText()).includes("暂无") || (await page.locator("main").innerText()).includes("没有覆盖"));
    }
    await goto("#/q/%E0%A4");
    check("畸形路由有可恢复的错误页", (await page.locator("main h1").innerText()) === "加载失败");
    await goto("");
    await page.locator(".skip-link").evaluate((node) => node.click());
    check("跳到主内容不破坏路由", await page.locator("main h1").innerText() === "OS 练习室" && await page.evaluate(() => document.activeElement.id) === "main");

    // 延迟首次章节请求，然后切首页；旧响应不得盖掉新页面。
    let started;
    const didStart = new Promise((r) => { started = r; });
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/data/questions/10.json", async (route) => {
      started(); await gate;
      await route.fulfill({ contentType: "application/json", body: fs.readFileSync(path.join(ROOT, "dist/data/questions/10.json"), "utf8") });
    });
    // 用索引确认目标归属第 10 章，避免以来源目录推断课程章节。
    const index = JSON.parse(fs.readFileSync(path.join(ROOT, "dist/data/index.json"), "utf8"));
    const tenth = index.questions.find((q) => q.ch === "10").id;
    await page.evaluate((id) => { location.hash = `#/q/${id}`; }, tenth);
    await didStart;
    await page.evaluate(() => { location.hash = "#/"; });
    await page.waitForFunction(() => document.querySelector("main h1")?.textContent === "OS 练习室");
    release(); await page.waitForLoadState("networkidle");
    check("快速换页时旧请求不会覆盖当前页", await page.locator("main h1").innerText() === "OS 练习室");

    await page.evaluate(() => {
      const s = window.__osExercises.storage;
      ["c1-s1-0-q001", "c1-s1-0-q002", "c1-s1-0-q003"].forEach((id) => s.recordAnswer(id, "A", false, "auto"));
    });
    await goto("#/practice/1?scope=wrong&i=0");
    await page.getByRole("button", { name: "重做本题", exact: true }).click();
    await page.locator(".opt").nth(2).click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    await page.getByRole("button", { name: "下一题 →", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".qcard")?.dataset.qid !== "c1-s1-0-q001");
    check("错题答对后列表缩短，下一题仍按稳定 ID 连续推进", await page.locator(".qcard").getAttribute("data-qid") === "c1-s1-0-q002");

    await page.setViewportSize({ width: 390, height: 844 });
    for (const hash of ["#/ch/1", "#/search?type=single_choice", "#/practice/1?scope=core&i=0"]) {
      await goto(hash);
      check(`390px 无横向溢出 ${hash}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.getByRole("button", { name: "打开章节导航" }).click();
    await page.keyboard.press("Escape");
    await page.locator("#sidebar").waitFor({ state: "hidden" });
    check("手机目录 Escape 关闭后不遮挡内容", await page.locator("#sidebar").isHidden());
    await page.screenshot({ path: path.join(OUT, `${ENGINE}-mobile.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(OUT, `${ENGINE}-dark.png`), fullPage: true });
    check("深色模式可渲染题卡", await page.locator(".qcard").isVisible());

    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); }; });
    const bp = await blocked.newPage();
    await bp.goto(BASE, { waitUntil: "networkidle" });
    check("存储被禁用时告警可见", await bp.locator("#storageWarning").isVisible());
    await bp.goto(BASE + "#/q/c1-s1-0-q001", { waitUntil: "networkidle" });
    await bp.waitForSelector(".qcard");
    await bp.locator(".opt").first().click();
    await bp.getByRole("button", { name: "提交答案", exact: true }).click();
    check("存储失败仍可内存作答且换页后告警保留", await bp.locator("#storageWarning").isVisible() && await bp.locator(".result").isVisible());
    await blocked.close();
    const malformed = await browser.newContext();
    await malformed.addInitScript(() => localStorage.setItem("os-exercises:v1", '{"schemaVersion":1,"answers":{"c1-s1-0-q001":null},"drafts":{}}'));
    const mp = await malformed.newPage();
    await mp.goto(BASE, { waitUntil: "networkidle" });
    check("损坏本机记录不导致白屏且原数据未覆盖", await mp.locator("#storageWarning").isVisible()
      && await mp.locator("main h1").innerText() === "OS 练习室"
      && await mp.evaluate(() => JSON.parse(localStorage.getItem("os-exercises:v1")).answers["c1-s1-0-q001"]) === null);
    await malformed.close();
    check("审查流程无脚本错误或资源 4xx/5xx", errors.length === 0 && failures.length === 0, JSON.stringify({ errors, failures }));
    await context.close();
  } finally {
    fs.writeFileSync(path.join(OUT, `${ENGINE}-regressions.json`), JSON.stringify({ engine: ENGINE, checks, errors, failures }, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
