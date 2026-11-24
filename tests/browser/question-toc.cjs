/** 本章题目目录回归：桌面右栏、状态更新、题号导航与窄屏抽屉。 */
const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require("playwright-core");

const base = process.env.BASE_URL || "http://127.0.0.1:8765/";
const engine = process.env.BROWSER || "chrome";
const first = "c1-s1-0-q001";
const second = "c1-s1-0-q002";
const third = "c1-s1-0-q003";

(async () => {
  const browser = await (engine === "webkit" ? webkit : engine === "firefox" ? firefox : chromium).launch(
    ["firefox", "webkit"].includes(engine) ? { headless: true } : { headless: true, channel: engine },
  );
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const go = async (hash) => {
      await page.goto(base + hash, { waitUntil: "networkidle" });
      await page.locator("main h1").waitFor();
    };
    const cardFor = (id) => page.locator(`.qcard[data-qid="${id}"]`).waitFor();
    const learningRecords = () => page.evaluate(() => {
      const data = window.__osExercises.storage.exportData();
      return { answers: data.answers, favorites: data.favorites, drafts: data.drafts };
    });

    await go("#/q/" + first);
    await cardFor(first);
    const toc = page.locator("#questionToc");
    await toc.waitFor({ state: "visible" });
    const chapterCount = await page.evaluate(() => (
      window.__osExercises.meta.chapters.find((chapter) => String(chapter.id) === "1").counts.total
    ));
    assert.equal(await toc.getByRole("heading", { name: "本章题目目录" }).count(), 1);
    assert.equal(await toc.locator("a[data-qid]").count(), chapterCount);
    assert.equal(await page.locator(`#questionToc a[data-qid="${first}"]`).getAttribute("aria-current"), "page");
    const layout = await page.evaluate(() => {
      const main = document.querySelector("main").getBoundingClientRect();
      const toc = document.getElementById("questionToc").getBoundingClientRect();
      return {
        mainRight: main.right,
        tocLeft: toc.left,
        tocRight: toc.right,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(layout.mainRight <= layout.tocLeft);
    assert.ok(layout.tocLeft > layout.viewport * 0.7);
    assert.ok(layout.tocRight <= layout.viewport);
    assert.equal(layout.overflow, 0);
    console.log(`PASS 桌面右侧目录覆盖本章 ${chapterCount} 题，排在主栏右侧且无横向溢出`);

    const before = await learningRecords();
    await page.evaluate((id) => {
      window.__osExercises.storage.recordAnswer(id, "A", false, "auto");
    }, second);
    assert.equal(await page.locator(`#questionToc a[data-qid="${second}"]`).getAttribute("data-status"), "wrong");
    await page.locator(`#questionToc a[data-qid="${third}"]`).click();
    await cardFor(third);
    assert.equal(await page.locator(`#questionToc a[data-qid="${third}"]`).getAttribute("aria-current"), "page");
    const after = await learningRecords();
    Object.entries(before.answers).forEach(([id, record]) => assert.deepEqual(after.answers[id], record));
    Object.entries(before.favorites).forEach(([id, record]) => assert.deepEqual(after.favorites[id], record));
    assert.deepEqual(after.drafts, before.drafts);
    assert.equal(await page.locator(`#questionToc a[data-qid="${second}"]`).getAttribute("data-status"), "wrong");
    console.log("PASS 目录实时显示作答状态，点击题号切换题目且不改写学习记录");

    await go("#/practice/1?scope=core&i=0");
    await cardFor(first);
    await toc.waitFor({ state: "visible" });
    assert.equal(await toc.locator("a[data-qid]").count(), chapterCount);
    assert.equal(await toc.locator(`a[data-qid="${first}"]`).getAttribute("aria-current"), "page");
    console.log("PASS 连续练习页使用同一份本章目录");

    for (const [width, expectsRail] of [[390, false], [860, false], [1180, false], [1181, true], [1920, true]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const rendersInViewport = await toc.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.visibility !== "hidden" && box.left < innerWidth && box.right > 0;
      });
      assert.equal(rendersInViewport, expectsRail);
      assert.equal(await page.locator("#tocToggle").isVisible(), !expectsRail);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#tocToggle").click();
    await toc.waitFor({ state: "visible" });
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("toc-open")), true);
    await toc.locator(`a[data-qid="${second}"]`).click();
    await cardFor(second);
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("toc-open")), false);
    await page.waitForTimeout(250);
    assert.equal(await toc.evaluate((element) => getComputedStyle(element).visibility), "hidden");
    console.log("PASS 窄屏通过右侧抽屉打开目录，选题后自动收起");

    assert.deepEqual(errors, []);
    console.log(`[${engine}] 本章题目目录回归全部通过`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
