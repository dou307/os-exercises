/** 单题入口切题回归。浏览器上下文和学习记录均独立。 */
const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require("playwright-core");

const base = process.env.BASE_URL || "http://127.0.0.1:8765/";
const engine = process.env.BROWSER || "chrome";
const first = "c1-s1-0-q001";
const second = "c1-s1-0-q002";
const draft = "c1-s5-0-q001";

(async () => {
  const browser = await (engine === "webkit" ? webkit : engine === "firefox" ? firefox : chromium).launch(
    ["firefox", "webkit"].includes(engine) ? { headless: true } : { headless: true, channel: engine },
  );
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const go = async (hash) => {
      await page.goto(base + hash, { waitUntil: "networkidle" });
      await page.locator("main h1").waitFor();
    };
    const cardFor = (id) => page.locator(`.qcard[data-qid="${id}"]`).waitFor();
    const top = page.getByRole("group", { name: "顶部题目导航", exact: true });
    const bottom = page.getByRole("group", { name: "底部题目导航", exact: true });
    const previous = (bar) => bar.getByRole("button", { name: /上一题/ });
    const next = (bar) => bar.getByRole("button", { name: /下一题/ });
    const entries = (list) => list.evaluateAll((links) => links.map((link) => ({
      href: link.getAttribute("href"),
      id: link.hash.split("/").at(-1).split("?")[0],
    })));
    const records = () => page.evaluate(() => {
      const { exportedAt, ...data } = window.__osExercises.storage.exportData();
      return data;
    });

    await go("#/ch/1");
    await page.locator(".chapter-lists .qitem").first().click();
    await cardFor(first);
    assert.equal(await previous(top).isDisabled(), true);
    await page.locator(".opt").first().click();
    await next(bottom).click();
    await cardFor(second);
    await page.keyboard.press("ArrowLeft");
    await cardFor(first);
    assert.equal(await page.evaluate((id) => window.__osExercises.storage.getPending(id), first), "A");
    await page.keyboard.press("ArrowRight");
    await cardFor(second);
    await previous(top).click();
    await cardFor(first);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log("PASS 章节题单与窄屏单题的顶部、底部和方向键");

    await page.evaluate(({ first, second, draft }) => {
      const storage = window.__osExercises.storage;
      storage.recordAnswer(first, "A", false, "auto");
      storage.recordAnswer(second, "B", false, "auto");
      storage.setFavorite(draft, true);
      storage.saveDraft(draft, "已保存的自答");
    }, { first, second, draft });
    const before = await records();
    await go("#/ch/1");
    await page.getByRole("button", { name: "做错", exact: true }).click();
    await page.getByLabel("按题型筛选").selectOption("single_choice");
    const filtered = await entries(page.locator(".chapter-lists .qitem"));
    assert.deepEqual(filtered.map(({ id }) => id), [first, second]);
    await page.locator(".chapter-lists .qitem").first().click();
    await cardFor(first);
    await page.keyboard.press("ArrowRight");
    await cardFor(second);
    assert.equal(await next(bottom).isDisabled(), true);
    assert.match(page.url(), /status=wrong/);
    assert.match(page.url(), /type=single_choice/);
    console.log("PASS 章节题单同时保留作答状态与题型筛选");

    for (const name of ["favorites", "review"]) {
      await go(`#/${name}?ch=1`);
      const links = page.locator(".qlist a.txt");
      const list = await entries(links);
      assert.ok(list.length > 1);
      await links.first().click();
      await cardFor(list[0].id);
      await next(bottom).click();
      await cardFor(list[1].id);
      await page.reload({ waitUntil: "networkidle" });
      await cardFor(list[1].id);
      await page.keyboard.press("ArrowLeft");
      await cardFor(list[0].id);
      assert.match(page.url(), new RegExp(`from=${name}&ch=1`));
      assert.equal(await page.locator(`main a[href="#/${name}?ch=1"]`).count(), 1);
    }
    console.log("PASS 收藏与错题回顾按来源列表顺序切换并可刷新");

    await go("#/search?q=操作系统");
    const links = page.locator(".qlist a.qitem");
    const list = await entries(links);
    assert.ok(list.length > 2);
    await links.nth(1).click();
    await cardFor(list[1].id);
    await page.keyboard.press("ArrowLeft");
    await cardFor(list[0].id);
    const jump = bottom.getByRole("spinbutton");
    await jump.fill("3");
    await jump.press("ArrowRight");
    await cardFor(list[0].id);
    await jump.press("Enter");
    await cardFor(list[2].id);
    assert.equal(await page.getByRole("link", { name: "返回搜索结果" }).count(), 1);
    console.log("PASS 搜索按结果顺序切换，跳题输入框保留自己的按键行为");

    await go("#/q/" + draft);
    await cardFor(draft);
    const answer = page.locator("textarea");
    assert.equal(await answer.inputValue(), "已保存的自答");
    await answer.press("ArrowLeft");
    await cardFor(draft);
    assert.deepEqual(await records(), before);
    await go("#/");
    await page.getByRole("link", { name: /继续上次的题/ }).click();
    await cardFor(draft);
    assert.equal(await answer.inputValue(), "已保存的自答");
    await page.getByRole("link", { name: "回到章节题单", exact: true }).click();
    await page.getByRole("heading", { name: "题单", exact: true }).waitFor();
    const chapterUrl = page.url();
    await page.keyboard.press("ArrowRight");
    assert.equal(page.url(), chapterUrl);
    assert.deepEqual(await records(), before);
    assert.deepEqual(errors, []);
    console.log("PASS 旧链接和继续练习可用，切题保留作答、收藏、草稿并清理按键监听");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
