/**
 * 真实浏览器验收脚本（第一章闭环）。
 *
 * 前置：
 *   1. 先构建并启动站点：.\scripts\start.ps1
 *   2. 安装依赖：npm install playwright-core（任意目录，能 require 到即可）
 *   3. 本机需有 Chrome 或 Edge；默认用 Chrome 通道
 *
 * 运行：
 *   node tests/browser/acceptance.js
 *   可用环境变量 BASE_URL 覆盖默认地址（默认 http://127.0.0.1:8765/）
 *
 * 输出：截图与 acceptance.json 写到 _work/screenshots/（不提交）。
 */
const fs = require("fs");
const path = require("path");
const { chromium, firefox } = require("playwright-core");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765/";
const BASE_ORIGIN = new URL(BASE).origin;
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "_work", "screenshots");
// BROWSER=firefox 可换第二个引擎（需先 npx playwright install firefox）
const ENGINE = (process.env.BROWSER || "chrome").toLowerCase();
const launcher = ENGINE === "firefox" ? firefox : chromium;
const launchOptions = ENGINE === "firefox" ? {} : { channel: ENGINE === "msedge" ? "msedge" : "chrome" };
const results = [];
const consoleErrors = [];
const failedRequests = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launcher.launch({ ...launchOptions, headless: true });
  console.log(`引擎：${ENGINE}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`));
  page.on("response", (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  check("首页加载", (await page.locator("h1").first().textContent()) === "OS 练习室");
  const homeText = await page.locator("main").innerText();
  check("首页显示第一章核心可判分数量", /第一章核心可判分/.test(homeText));
  await page.screenshot({ path: path.join(SHOTS, "01-home.png"), fullPage: true });

  // ---- 进入第一章核心练习 ----
  await page.getByRole("link", { name: "开始第一章核心练习" }).click();
  await page.waitForSelector(".qcard");
  const firstQid = await page.locator(".qcard").getAttribute("data-qid");
  check("进入练习并加载题卡", Boolean(firstQid), firstQid);

  // 取正确答案，故意选错一个，便于验证错题回顾
  const answers = await page.evaluate(async () => {
    const res = await fetch("data/questions/1.json");
    const doc = await res.json();
    const map = {};
    doc.questions.forEach((q) => { map[q.id] = q.originalAnswer; });
    return map;
  });
  const correct = answers[firstQid];
  const wrongKey = ["A", "B", "C", "D"].find((k) => k !== correct);
  check("读到正确答案用于构造错题", Boolean(correct && wrongKey), `正确 ${correct}，选择 ${wrongKey}`);

  // ---- 键盘选择（按字母键）----
  await page.keyboard.press(wrongKey);
  const pressed = await page.locator(`main .options .opt:nth-child(${"ABCD".indexOf(wrongKey) + 1})`).getAttribute("aria-pressed");
  check("键盘字母键选中选项", pressed === "true");

  await page.screenshot({ path: path.join(SHOTS, "02-practice-before-submit.png"), fullPage: true });

  // ---- 提交并检查解析 ----
  await page.keyboard.press("Enter");
  await page.waitForSelector(".result:not([hidden])");
  const resultText = await page.locator(".result").innerText();
  check("提交后显示判分结果", /回答错误|回答正确/.test(resultText), resultText.trim());
  const explainVisible = await page.locator(".explain").isVisible();
  check("提交后展开解析", explainVisible);
  await page.screenshot({ path: path.join(SHOTS, "03-practice-after-submit.png"), fullPage: true });

  // ---- 刷新恢复 ----
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const restoredQid = await page.locator(".qcard").getAttribute("data-qid");
  const restoredPressed = await page.locator(`main .options .opt:nth-child(${"ABCD".indexOf(wrongKey) + 1})`).getAttribute("aria-pressed");
  const restoredResult = await page.locator(".result").innerText();
  check("刷新后回到同一题", restoredQid === firstQid, restoredQid);
  check("刷新后恢复实际选项", restoredPressed === "true", `选中 ${wrongKey}`);
  check("刷新后仍显示已判分", /回答错误|回答正确/.test(restoredResult), restoredResult.trim());
  await page.screenshot({ path: path.join(SHOTS, "04-after-reload.png"), fullPage: true });

  // ---- 错题回顾 ----
  await page.goto(BASE + "#/review", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  const reviewText = await page.locator("main").innerText();
  check("错题回顾列出该题", reviewText.includes(firstQid) || reviewText.includes("答错 1"), reviewText.split("\n").slice(0, 6).join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "05-review.png"), fullPage: true });

  // ---- 重做 ----
  await page.getByRole("button", { name: "重做" }).first().click();
  await page.waitForSelector(".qcard");
  const redoSubmitEnabled = await page.locator(".qcard .actions .btn.primary").isEnabled();
  const redoResultVisible = await page.locator(".qcard .result").isVisible();
  check("重做后回到未作答状态", redoSubmitEnabled && !redoResultVisible);
  await page.screenshot({ path: path.join(SHOTS, "06-redo.png"), fullPage: true });

  // ---- 公式渲染 ----
  await page.goto(BASE + "#/q/c1-s2-0-q011", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  await page.evaluate(() => document.fonts.ready);
  const katexCount = await page.locator(".qcard .katex").count();
  check("本地 KaTeX 渲染公式", katexCount > 0, `katex 节点 ${katexCount}`);

  // ---- 综合题自评 ----
  await page.goto(BASE + "#/q/c1-s5-0-q001", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const hasTextarea = await page.locator(".qcard textarea").count();
  await page.locator(".qcard .actions .btn.primary").click();
  await page.waitForSelector(".self-assess");
  check("综合题提供自答与自评", hasTextarea === 1 && (await page.locator(".self-assess").isVisible()));
  await page.locator(".self-assess .btn").first().click();
  const selfText = await page.locator(".qcard .result").innerText();
  check("综合题自评已记录", /会做/.test(selfText), selfText.trim());

  // ---- 多空题不自动判分 ----
  await page.goto(BASE + "#/q/c1-s2-0-q013", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const blankResult = await page.evaluate(() => {
    const q = document.querySelector(".qcard");
    return { blocks: q.querySelectorAll(".opt-blocks .mono").length, opts: q.querySelectorAll(".options").length };
  });
  check("多空题保留原始选项块且无单选交互", blankResult.blocks === 1 && blankResult.opts === 0, JSON.stringify(blankResult));

  // ---- 多选题：不选也能提交，但不能被算成“答错” ----
  await page.locator(".qcard .actions .btn.primary").click();
  await page.waitForSelector(".qcard .self-assess");
  const blankRecord = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("os-exercises:v1") || "{}");
    return (raw.answers || {})["c1-s2-0-q013"] || null;
  });
  check("多空题只展开答案、不写入答错记录",
    blankRecord === null || (blankRecord.correct === null && blankRecord.scoring === "excluded"),
    JSON.stringify(blankRecord && { correct: blankRecord.correct, scoring: blankRecord.scoring }));

  // ---- 待核对题不计分 ----
  await page.goto(BASE + "#/q/c1-s3-0-q009", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const disputedBadge = await page.locator(".qcard .badge.disputed").count();
  await page.locator(".qcard .options .opt").first().click();
  await page.locator(".qcard .actions .btn.primary").click();
  const disputedResult = await page.locator(".qcard .result").innerText();
  check("待核对题明确不计分", disputedBadge > 0 && /不计分/.test(disputedResult), disputedResult.trim());

  // ---- 搜索 ----
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#searchInput", "中断");
  await page.press("#searchInput", "Enter");
  await page.waitForSelector(".qlist");
  const searchText = await page.locator("main h1").innerText();
  const hitCount = await page.locator(".qlist li").count();
  check("搜索直达结果", /搜索：中断/.test(searchText) && hitCount > 0, `命中 ${hitCount}`);

  // ---- 390px ----
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE + "#/practice/1?scope=core&i=0", { waitUntil: "networkidle" });
  await mobile.waitForSelector(".qcard");
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("390px 无横向溢出", overflow <= 1, `溢出 ${overflow}px`);
  const navBtnVisible = await mobile.locator("#navToggle").isVisible();
  check("390px 显示目录按钮", navBtnVisible);
  await mobile.screenshot({ path: path.join(SHOTS, "07-mobile-390.png"), fullPage: true });
  await mobile.locator("#navToggle").click();
  await mobile.waitForTimeout(350);
  const sidebarVisible = await mobile.locator("#sidebar").evaluate((el) => el.getBoundingClientRect().left >= -1);
  check("390px 目录可展开", sidebarVisible);
  await mobile.screenshot({ path: path.join(SHOTS, "08-mobile-nav.png") });

  // ---- 原题库入口 ----
  await page.goto(BASE + "#/source", { waitUntil: "networkidle" });
  const sourceLinks = await page.locator('a[href*="kaoyan-408-os"]').count();
  check("原题库阅读入口存在", sourceLinks >= 5, `${sourceLinks} 个入口`);

  // ---- P4：系统映射章节导航与“标记已学” ----
  await page.goto(BASE + "#/ch/3", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  const ch3Text = await page.locator("main").innerText();
  check("第 3 章可进入且已逐题复核部分不再冒充系统映射", /第 3 章/.test(ch3Text) && !/未逐题人工复核/.test(ch3Text));

  await page.goto(BASE + "#/ch/4", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  const ch4Text = await page.locator("main").innerText();
  check("线程章节有题（关键词拆分生效）", /第 4 章/.test(ch4Text) && !/暂无对应题/.test(ch4Text),
    ch4Text.split("\n").slice(0, 4).join(" | "));

  await page.goto(BASE + "#/ch/3", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  const markBtn = page.getByRole("button", { name: "标记本章已学完" });
  check("提供本机“标记已学”按钮", await markBtn.count() === 1);
  await markBtn.click();
  await page.waitForTimeout(300);
  const afterMark = await page.locator("main").innerText();
  check("标记后本章题目进入核心练习", /核心练习/.test(afterMark) && /开始核心练习/.test(afterMark));

  // ---- 2026-10-22 回归：提升为“核心”之后仍必须保留“系统映射”徽标（不能冒充已审核） ----
  // 用浏览器里的真实计数，不依赖 Playwright 选择器对“哪个子集”的语义。
  // 判定“标记已学生效”只认存储 + DOM：localStorage 里的 completedChapters 必须包含本章，
  // 且本机标记状态在当前页面上真的把题目提到核心练习。
  const markState = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("os-exercises:v1") || "{}");
    const badges = Array.from(document.querySelectorAll("main .qlist .badge"));
    return {
      stored: (raw.ui && raw.ui.completedChapters) || [],
      core: badges.filter((n) => n.classList.contains("core")).length,
      bridge: badges.filter((n) => n.classList.contains("bridge")).length,
    };
  });
  await page.goto(BASE + "#/practice/3?scope=core&i=1", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const practiceBadges = await page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll(".qcard .badge"));
    const text = (label) => badges.filter((n) => n.textContent.trim() === label).length;
    return { systematic: text("系统映射"), core: text("核心"), bridge: text("桥接"), originalTier: text("原分层：稍后") };
  });
  // 标记状态必须落盘：本地存储里要有本章，且页面上题目真的进了核心练习
  const markConverged = markState.stored.map(String).includes("3") && markState.bridge > 0;
  check("“标记已学”写进本机存储并即时生效", markConverged,
    `stored=${JSON.stringify(markState.stored)} 核心 ${markState.core} / 桥接 ${markState.bridge}`);
  check("提升后的题目分层保持桥接，不虚构系统映射徽标",
    practiceBadges.systematic === 0 && practiceBadges.bridge === 1 && practiceBadges.originalTier === 1,
    `练习卡徽标：系统映射 ${practiceBadges.systematic}、桥接 ${practiceBadges.bridge}、原分层 ${practiceBadges.originalTier}`);

  // ---- 2026-10-22 回归：跨章挂靠的“稍后”题不随“标记已学”一起冒进核心，避免重复出现 ----
  // 第 3 章 56 道里 1 道是从第 1 章挂靠过来的 later；标记已学后它应算桥接，核心只含原 55 道 systematic。
  // systematic 用数据侧统计（meta 里的 later 统计的是原始分层，标记已学后仍是 56）。
  const chMeta = await page.evaluate(async () => {
    const doc = await (await fetch("data/questions/3.json")).json();
    return { available: doc.questions.filter((q) => q.readinessTier !== "supplement" && q.reviewStatus !== "disputed").length };
  });
  check("跨章挂靠题标记已学后归入桥接而非核心",
    markState.core === 0 && markState.bridge === chMeta.available,
    `核心 ${markState.core}、桥接 ${markState.bridge}、可用 ${chMeta.available}`);

  // ---- 2026-10-22 回归：“稍后”范围可直接练习，范围标题不再出现 undefined ----
  await page.goto(BASE + "#/practice/2?scope=later&i=1", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const laterH1 = await page.locator("main h1").innerText();
  const laterPos = await page.locator(".pager-bar .pos").first().innerText();
  check("“稍后”范围可直接练习且标题无 undefined",
    /稍后再学/.test(laterH1) && !/undefined/.test(laterH1) && /第 2 \//.test(laterPos),
    `${laterH1.trim()} · ${laterPos.trim()}`);

  // ---- 2026-10-22 回归：连续跳题后按键只作用在当前题卡上（旧实现监听会叠加） ----
  await page.goto(BASE + "#/practice/1?scope=core&i=0", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  for (let k = 1; k <= 3; k += 1) {
    await page.goto(`${BASE}#/practice/1?scope=core&i=${k}`);
    await page.waitForFunction((n) => {
      const pos = document.querySelector(".pager-bar .pos");
      return Boolean(pos && pos.textContent.trim() === `第 ${n + 1} / 41 题`);
    }, k);
  }
  const qidBeforeKey = await page.locator(".qcard").getAttribute("data-qid");
  const readAttempts = (id) => page.evaluate((qid) => {
    const raw = JSON.parse(localStorage.getItem("os-exercises:v1") || "{}");
    return (raw.answers || {})[qid] ? (raw.answers[qid].attempts || 0) : 0;
  }, id);
  await page.keyboard.press("B");
  const attempts = await readAttempts(qidBeforeKey);
  check("连续跳题后键盘只作用于当前题", attempts === 0, `${qidBeforeKey} attempts=${attempts}`);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".result:not([hidden])");
  const attemptsAfter = await readAttempts(qidBeforeKey);
  check("提交只记录一次作答", attemptsAfter === 1, `${qidBeforeKey} attempts=${attemptsAfter}`);

  // ---- 2026-10-22 回归：单题页的原题库入口必须能真正跳到小节 ----
  await page.goto(BASE + "#/q/c1-s1-0-q001", { waitUntil: "networkidle" });
  await page.waitForSelector(".qcard");
  const sourceHrefCount = await page.locator('main a[href*="kaoyan-408-os"]').count();
  const sourceHref = await page.locator('main a[href*="kaoyan-408-os"]').first().getAttribute("href");
  check("单题页的原题库入口指向真实小节", sourceHrefCount === 1 && /#toc-\d+/.test(sourceHref), sourceHref);

  // ---- 2026-10-22 新增：搜索支持章节 / 题型筛选 ----
  await page.goto(BASE + "#/search?q=%E4%B8%AD%E6%96%AD&ch=12", { waitUntil: "networkidle" });
  await page.waitForSelector(".filters");
  const chHitRows = await page.locator(".qlist li").count();
  const chExpected = await page.evaluate(async () => {
    const index = await (await fetch("data/index.json")).json();
    return index.questions.filter((q) => String(q.ch) === "12" && q.stem.includes("中断")).length;
  });
  check("搜索按章节筛选", chHitRows > 0 && chHitRows === Math.min(100, chExpected), `命中 ${chHitRows} 行，数据侧 ${chExpected} 道`);
  // 题型筛选用一定含综合题的章节（ch1 有 14 道综合题），并断言命中数等于数据侧
  await page.goto(BASE + "#/search?ch=1&type=constructed_response", { waitUntil: "networkidle" });
  await page.waitForSelector(".qlist");
  const typeRows = await page.locator(".qlist li").count();
  const typeExpected = await page.evaluate(async () => {
    const index = await (await fetch("data/index.json")).json();
    return index.questions.filter((q) => String(q.ch) === "1" && q.type === "constructed_response").length;
  });
  const typeFilteredSub = await page.locator("main .sub").first().innerText();
  check("搜索按题型筛选", typeRows > 0 && typeRows === typeExpected && /综合/.test(typeFilteredSub),
    `命中 ${typeRows} 行，数据侧 ${typeExpected} 道`);

  // ---- 2026-10-22 新增：知识点缺口在章节页明确列出 ----
  const gapChapters = await page.evaluate(async () => {
    const meta = await (await fetch("data/meta.json")).json();
    const index = await (await fetch("data/index.json")).json();
    const out = [];
    meta.chapters.forEach((c) => {
      if (!c.counts.total) return;
      const covered = new Set();
      index.questions.forEach((q) => { if (String(q.ch) === String(c.id)) q.topics.forEach((t) => covered.add(t)); });
      const missing = (c.topicIds || []).filter((t) => !covered.has(t));
      if (missing.length) out.push(`${c.id}:${missing.length}`);
    });
    return out;
  });
  if (gapChapters.length) {
    const [gapCh, gapCount] = gapChapters[0].split(":");
    await page.goto(`${BASE}#/ch/${gapCh}`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1");
    const gapText = await page.locator("main").innerText();
    check("章节页列出没有题目的知识点", gapText.includes(`没有对应题的知识点（${gapCount}）`), `第 ${gapCh} 章 ${gapCount} 个`);
  } else {
    check("章节页列出没有题目的知识点", true, "当前数据没有知识点缺口，跳过");
  }

  // ---- 2026-10-22 新增：错题回顾标出题目所在章节 ----
  await page.goto(BASE + "#/review", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  const reviewChapterLinks = await page.locator('.qlist a[href^="#/ch/"]').count();
  check("错题回顾标出题目所属章节", reviewChapterLinks > 0, `${reviewChapterLinks} 个章节入口`);

  // ---- P4：记录导出 / 导入 ----
  await page.goto(BASE, { waitUntil: "networkidle" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出记录" }).click(),
  ]);
  const exportPath = path.join(SHOTS, "exported-progress.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  const exportedCount = Object.keys(exported.answers || {}).length;
  check("导出记录含版本与作答", exported.schemaVersion === 1 && exportedCount >= 1, `answers ${exportedCount}`);

  const freshCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const freshPage = await freshCtx.newPage();
  await freshPage.goto(BASE, { waitUntil: "networkidle" });
  const beforeImport = await freshPage.locator("main").innerText();
  await freshPage.setInputFiles('input[type="file"]', exportPath);
  await freshPage.waitForTimeout(600);
  const afterImport = await freshPage.locator("main").innerText();
  check("新浏览器导入后恢复记录",
    /本机已记录 0 道/.test(beforeImport) && new RegExp(`本机已记录 ${exportedCount} 道`).test(afterImport),
    `导入前 0 道，导入后应为 ${exportedCount} 道`);
  await freshCtx.close();

  // ---- P4：断网时公式与图片本地可用 ----
  const offlineCtx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const blocked = [];
  await offlineCtx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE_ORIGIN)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const offlinePage = await offlineCtx.newPage();
  await offlinePage.goto(BASE + "vendor/kaoyan-408-os/ch1/quiz.html", { waitUntil: "networkidle" });
  await offlinePage.waitForTimeout(900);
  await offlinePage.evaluate(() => document.fonts.ready).catch(() => {});
  const offlineKatex = await offlinePage.locator(".katex").count();
  check("断网时原题库公式仍渲染", offlineKatex > 0, `katex ${offlineKatex}`);
  check("断网时无外部依赖请求", blocked.length === 0, blocked.slice(0, 2).join(" | "));
  await offlinePage.goto(BASE + "#/q/c1-s2-0-q011", { waitUntil: "networkidle" });
  await offlinePage.waitForSelector(".qcard");
  await offlinePage.getByRole("button", { name: "查看解析" }).click();
  await offlinePage.waitForTimeout(300);
  const offlineAppKatex = await offlinePage.locator(".qcard .katex").count();
  check("断网时练习页公式仍渲染", offlineAppKatex > 0, `katex ${offlineAppKatex}`);
  await offlineCtx.close();

  // ---- P4：子路径部署（仅本地有第二个服务时适用） ----
  const SUB_BASE = "http://127.0.0.1:8766/dist/";
  if (BASE === "http://127.0.0.1:8765/") {
    const subCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const subFailed = [];
    const subPage = await subCtx.newPage();
    subPage.on("response", (res) => { if (res.status() >= 400) subFailed.push(`${res.status()} ${res.url()}`); });
    await subPage.goto(SUB_BASE, { waitUntil: "networkidle" });
    await subPage.waitForSelector("h1");
    const subTitle = await subPage.locator("h1").first().innerText();
    await subPage.goto(SUB_BASE + "#/practice/1?scope=core&i=0", { waitUntil: "networkidle" });
    await subPage.waitForSelector(".qcard");
    check("子路径 /dist/ 下可加载并作答", subTitle === "OS 练习室" && (await subPage.locator(".options .opt").count()) >= 4);
    check("子路径下无 4xx 资源", subFailed.length === 0, subFailed.slice(0, 2).join(" | "));
    await subCtx.close();
  } else {
    check("子路径部署", true, "非本地 BASE_URL，跳过（线上本身就在 /os-exercises/ 子路径下，已由上面的加载检查覆盖）");
  }

  check("无控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  // ERR_ABORTED 表示请求被浏览器主动取消（通常是紧接着的跳转），不等于资源有问题；
  // 真正要抓的是连接失败、DNS 失败与 4xx/5xx。
  const aborted = failedRequests.filter((r) => r.includes("ERR_ABORTED"));
  const realFailures = failedRequests.filter((r) => !r.includes("ERR_ABORTED"));
  check("无资源加载失败", realFailures.length === 0, realFailures.slice(0, 3).join(" | ") || `（另有 ${aborted.length} 次跳转导致的 ERR_ABORTED）`);

  fs.writeFileSync(path.join(SHOTS, "acceptance.json"), JSON.stringify({ engine: ENGINE, results, consoleErrors, failedRequests }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[${ENGINE}] 共 ${results.length} 项检查，失败 ${failed.length} 项。`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error("运行失败：", error);
  process.exit(2);
});
