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
const { chromium } = require("playwright-core");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765/";
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "_work", "screenshots");
const results = [];
const consoleErrors = [];
const failedRequests = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
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
  check("首页显示第一章可判分数量", /第一章可判分/.test(homeText));
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
  const pressed = await page.locator(`.options .opt:nth-child(${"ABCD".indexOf(wrongKey) + 1})`).getAttribute("aria-pressed");
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
  const restoredPressed = await page.locator(`.options .opt:nth-child(${"ABCD".indexOf(wrongKey) + 1})`).getAttribute("aria-pressed");
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
  check("第 3 章可进入并标注系统映射", /系统映射/.test(ch3Text) && /未逐题人工复核/.test(ch3Text));

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
    if (url.startsWith("http://127.0.0.1:8765/")) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const offlinePage = await offlineCtx.newPage();
  await offlinePage.goto(BASE + "vendor/kaoyan-408-os/ch1/quiz.html", { waitUntil: "networkidle" });
  await offlinePage.waitForTimeout(900);
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

  // ---- P4：子路径部署 ----
  const SUB_BASE = "http://127.0.0.1:8766/dist/";
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

  check("无控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  check("无资源加载失败", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

  fs.writeFileSync(path.join(SHOTS, "acceptance.json"), JSON.stringify({ results, consoleErrors, failedRequests }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项检查，失败 ${failed.length} 项。`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error("运行失败：", error);
  process.exit(2);
});
