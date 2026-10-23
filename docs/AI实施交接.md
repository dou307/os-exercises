# OS 练习室实施交接（给接手的 AI）

> 2026-10-23 独立审查补充：[网站审查与改进](网站审查与改进.md)。已有实现经过内容完整性核验，并修复重做历史、损坏导入、存储告警、争议题漏列、分层不一致和路由竞争。请优先阅读新报告；下文保留原交接的历史事实，旧“搜索无筛选”等实现描述不再代表现状。

最近更新：2026-10-22 22:45。**P0～P5 全部完成，站点已上线 GitHub Pages。**
本文件是给下一个接手者（人或 AI）的完整交接：已经做了什么、为什么这么做、还剩什么、怎么继续。
先核对 Git 状态再动手：`git status --short --branch`、`git rev-parse HEAD`，以实时状态为准，不要相信本文里的旧时间戳。

## 最新增量：2026-10-23 第三章逐题复核

- 来源第三章166/166完成：90 verified、65 qualified、11 disputed（不计分），76条勘误/前提。详见 [第三章逐题复核](第三章逐题复核.md)。
- 正式输入 `data/reviews/ch3.json`；通用 `load_review(..., chapter)` 校验来源章/覆盖/哈希/笔记定位，`build_mappings.py --write-doc`叠加并生成报告。前两章364条映射逐字段未变。
- 56组复算在 `scripts/review_ch3_checks.py`；OPT另与小输入穷举动态规划比较，不能把本地LRU/FIFO数组计算当所有算法必然结论。
- 课程归属：第2章2题、第9章97题、第10章67题。分段在9章209行补充callout，无独立标题；段页组合另标前置缺口，不造知识点ID。
- 全库累计530题已逐题复核；第四至五章230题仍为systematic。旧数字保留为历史记录。
- 旧争议自动记录可导入为历史事实，当前统计排除；原题、原答案、vendor及个人资料不改，用户仍只确认学完第一章。
- 审核结论/完整归属理由/详细勘误随解析展开，作答前不泄露答案；题卡仍提前标争议与缺口。
- 下一批为来源第四章110道，不自动扩大本轮范围；真题年份、所谓最新考纲、真实笔记跳转、真机/Safari仍未确认。

## 最新增量：2026-10-23 第二章逐题复核

- 来源第二章 276 道全部逐题复核：179 verified、74 qualified、23 disputed（不计分），97 条勘误/前提。详见 [第二章逐题复核](第二章逐题复核.md)。
- 正式可维护输入是 `data/reviews/ch2.json`，含来源内容哈希、单题结论、真实笔记定位与前置缺口。`build_mappings.py --write-doc` 叠加并生成报告；禁止手改生成层。
- 全库累计 364 道已逐题复核；来源第三至五章 396 道仍为系统映射。下文 672/只审第一章等数字是历史状态。
- 31 组独立复算/有限反例检查在 `scripts/review_ch2_checks.py`；Python 11 项回归通过。新浏览器验收为 `tests/browser/ch2-review.cjs`，涵盖勘误、HRRN 缺口、旧计分记录迁移及争议题排除。
- 原始题目、原答案、vendor 与笔记未改；16 个实际笔记 sha256 与目录快照一致。用户仍只确认学完课程第一章。
- 本次新增争议题的旧自动分数保留在原导出中；`getAnswer` 给当前页面和统计提供不计分投影。不要删除旧历史或把它误判为当前答错。
- 后续先复核来源第三章的 166 道主存/虚拟存储题，再推进第四、五章；不自动扩大本轮范围。

## 0. 三十秒概览

- 项目：把王道 408 操作系统题库按本地《Operating System Concepts》笔记的章节框架重组，做分章练习。
- 本地根目录：`D:\desk\1learn\OS\exercises\os-exercises`。上级 `exercises/` 留给用户日常使用，别把文件散上去。
- 线上：<https://dou307.github.io/os-exercises/>（push 到 `main` 自动构建发布）。
- 本地：`.\scripts\start.ps1` → <http://127.0.0.1:8765/>；`-Lan` 可让同 Wi-Fi 手机访问。
- 上游：`jlshdsdk/kaoyan-408-os`，锁定提交 `e360b96fbd6522656d633ad9e26b7dd91f7bd1b4`。
- 学习进度：**只有第一章 Introduction 由用户确认学完**，其余章 unknown，不读笔记 `[x]` 推断。

## 1. 用户已明确确认过的决定（不要擅自推翻）

| 事项 | 决定 | 时间/依据 |
|---|---|---|
| 仓库可见性 | 从 PRIVATE 改为 **PUBLIC** | 2026-10-22，用户经提问后明确选择“转 public，开 Pages”。关站命令见 `docs/来源说明.md` |
| GitHub Pages | 启用，workflow 方式发布 | 同上。免费账号无法给私有仓库开 Pages（422），所以必须公开 |
| 学习进度 | 仅第一章确认完成 | 交接文档与 `data/study-defaults.json` |
| 个人资料 | `personal/` 禁止自动覆盖/清空 | 长期约束 |
| 原资料 | `vendor/`、Obsidian 笔记、实验目录只读 | 长期约束 |
| 真题年份 | 只显示“原站标注”，不声称已核实 | `examYearVerified` 全为 `false` |

## 2. 数据事实基线（改动前先对齐这些数字）

| 指标 | 数值 |
|---|---:|
| 题块总数 | 760 |
| 分章 | ch1 88 / ch2 276 / ch3 166 / ch4 110 / ch5 120 |
| 题型 | 单选 645、多空/复合 5、综合 110 |
| 无 `.q` 容器的综合题 | 47（ch1 有 2 道、ch2 有 45 道） |
| 带 `.q` 容器 | 713 |
| 上游文件 | 176 个，6,368,535 字节，sha256 逐一核对一致 |
| 上游图片引用 | 135 处，全部本地非空、无外链 |
| 课程章节 / 知识点 | 16 / 369 |
| 勘误条目 | 5（其中 3 条不计分） |
| 数据集版本 | `2026-10-21.1` |

## 3. 各阶段做了什么（按 P0～P5 + 上线）

### P0 基线与计划（已完成，早于本轮）
- 独立 Git 仓库、上游 176 文件逐字节快照、`_work/upstream.git` 完整历史镜像、笔记标题调查、`docs/audit/` 盘点、实施计划。
- 产物：`vendor/**`、`scripts/audit_sources.py`、`docs/audit/*.json`、`docs/实施计划.md`、`docs/调查记录.md`。

### P1 无损结构化提取（已完成）
- `scripts/import_questions.py`：扫描 `article` 顶层子节点，识别三类题目起点——`div.q`（713）、`<p><strong>第 N 题</strong>`（2）、`<h3>第 N 题</h3>`（45）。**只选 `.q` 会漏 47 道综合题。**
- `Ⅰ./Ⅱ./Ⅲ.` 陈述列表与选项同样使用 `<p class="mono">`，靠“标记是否从 A 开始且连续”区分，否则会把陈述列表误切成选项。
- 题号标签从题干剥离并写入 `source.originalLabel`；`details.qa` 拆成 `originalAnswer` 与 `originalExplanationHtml`。
- 清洗白名单：保留 `p/br/strong/em/sup/sub/span/div/ul/ol/li/table/caption/thead/tbody/tr/th/td/pre/code/blockquote/hr/img/a` 与 `mono/callout/callout-title/tip/notice`；去脚本、事件属性、`javascript:`、外链、`data-*`、`id`、`style`。
- 稳定 ID：`c{章}-s{h2序号}-{h3序号或0}-q{题号}`，写入 `data/source-registry.json` 后冻结；上游重排时用内容哈希认领旧 ID 并记录 `relocations`。
- `scripts/validate_dataset.py`：十二类校验（数量/特殊题/ID/字段/清洗/来源可定位/vendor 字节/图片引用/样本回归/映射覆盖/答案一致性/重复提示）。
- 产物：`data/questions.json`、`data/source-registry.json`、`tests/fixtures/samples/*`、`docs/导入验收.md`。

### P2 第一章逐题映射（已完成）
- `scripts/build_mappings.py` 里的 `CH1_REVIEW` 是 88 道题的逐题审核表：分层、状态、主归属章、知识点、前置知识、理由。
- 结论：core 42（含 2 道争议只读）、bridge 1、supplement 13、later 32（归第 2/3 章）；可自动判分 39 + 综合题自评 1。
- 与旧草案 45 道的差异逐条写在 `docs/映射审核记录.md` 第 4 节：1.1 的系统调用题、1.3 的系统调用过程题、1.4 的结构与引导题都属第 2 章。
- 勘误 5 条（`data/overrides/errata.json`）：3 条不计分（`c1-s2-0-q009`、`c1-s3-0-q009`、`c1-s3-0-q011`），2 条前提/措辞备注。
- `PREREQ_OVERRIDES` + 守卫：第一章 core 的前置知识点必须落在 `t1-*`，越界直接让构建失败。
- 产物：`data/chapters.json`、`topics.json`、`mappings.json`、`study-defaults.json`、`overrides/errata.json`、`docs/映射审核记录.md`。

### P3 第一章练习闭环（已完成）
- `app/` 原生 HTML/CSS/ES Modules，无构建步骤：首页、章节题单、逐题练习、单题、错题回顾、搜索、原题库入口。
- `scripts/build.py` 组装 `dist/`（按主归属章切分题目文件）；`scripts/start.ps1` 起本地服务。
- 判分：单选自动判分；多空题与综合题只给答案与自评；争议题标注不计分。
- 记录写 `os-exercises:v1`，保存实际选项、首次结果、最近结果；存储失败显式告警。
- 公式用本地 KaTeX 0.16.11（含 20 个 woff2 字体 + auto-render，MIT，`app/vendor/katex/LICENSE`）。

### P4 全章适配与离线（已完成）
- `SECTION_MAP`：每个上游小节 → 主归属章 + 2～4 个知识点 + 理由；`KEYWORD_RULES` 把 2.1 的 18 道线程题拆到第 4 章。
- 672 道状态 `systematic`，界面徽标“系统映射”，**不代表答案已逐题人工复核**。
- 答案一致性扫描：348 道题解析里能提取“故选 X / 答案 X”，全部与答案字段一致，0 矛盾。
- 本机“标记本章已学完”（`ui.completedChapters`）：标记后该章题目进入核心练习，但仍保留“系统映射”徽标；已确认的第 1 章不可取消。
- 记录导出/导入：校验 `schemaVersion`，按题目 ID 与 `lastAt` 合并，未知 ID 跳过计数，不清空旧记录。
- 笔记跳转配置驱动：`config.local.json`（示例 `config.example.json`）填 `obsidianVault` 才生成 `obsidian://open` 链接；未配置不硬编码库名。
- 离线：构建时把上游 18 个页面的 KaTeX CDN 引用改写成按目录深度计算的相对路径，`dist/` 内已无 `cdn.jsdelivr`；`vendor/` 原字节不变。
- 子路径：`/dist/` 前缀访问正常，无 4xx。

### P5 交付文档（已完成）
- `docs/使用说明.md`、`docs/维护与更新.md`、`docs/验收报告.md`；README、执行清单同步为实际状态。

### GitHub Pages 上线（已完成，2026-10-22）
- `.github/workflows/deploy-pages.yml`：push 到 `main` → setup-python → `pip install -r requirements.txt` → `build.py` → **`validate_dataset.py` 作为闸门** → `upload-pages-artifact` → `deploy-pages`。
- 仓库转 public：`gh repo edit dou307/os-exercises --visibility public --accept-visibility-change-consequences`。
- 启用 Pages：`gh api -X POST repos/dou307/os-exercises/pages -f build_type=workflow`。
- `THIRD_PARTY_NOTICE.md`：记录上游无 LICENSE、教材插图版权、笔记来源 CC BY-NC-SA、KaTeX MIT，以及“部署到公网 = 公开再分发”的后果。
- Actions 两次运行均 success（`71cd28b`、`02bf2ee`）；线上资源与本地构建逐字节一致（除 `generatedAt`）。

## 4. 已经跑过的验证（改了代码/数据才需要重跑）

| 检查 | 结果 |
|---|---|
| `python scripts/validate_dataset.py` | 十二类全绿（含 176 文件 sha256、135 处图片引用、760 道映射覆盖、348 道答案一致性） |
| `python scripts/build.py` | 760 道、14 个章节文件、9.6 MB、18 个上游页面公式本地化 |
| 浏览器验收 35 项 × 3 引擎 | Chrome 35/35、Edge 35/35、Firefox（Gecko）35/35，均 0 控制台错误 |
| 线上验收 | `BASE_URL=https://dou307.github.io/os-exercises/` 跑 34/34（子路径检查自动跳过） |
| 线上资源 | 首页、`/data/meta.json`、`/js/app.js`、`/vendor/katex/katex.min.js`、原题库 quiz.html 均 200；字体 200 且 MIME 正确 |
| 断网 | 阻断非本站请求后，原题库页与练习页公式仍渲染，外部依赖请求 0 |
| 数据保护 | `personal/` 未修改；`vendor/` 字节未变 |

复现命令见 `docs/维护与更新.md` 第 6 节。**未执行的检查不要写成通过。**

## 5. 还剩什么（按优先级）

1. **第 2～5 章 672 道题的答案正确性人工复核**（唯一的大工程）。现在是“小节级系统映射 + 自动一致性扫描”，
   知识点与主归属可信度中等，答案没有逐题人工确认。建议以 `SECTION_MAP` 的小节为单位逐节读题核对，
   结论写回 `scripts/build_mappings.py`（像 `CH1_REVIEW` 那样）或新增 `data/review/chN.json`，
   状态从 `systematic` 升到 `verified`/`disputed`，并补 `ERRATA`。
2. 搜索暂不支持按章节/题型筛选，只做关键词匹配与排序（`app/js/search.js`）。
3. 真题年份权威核对：176 条全是原站标注。
4. 跨 `schemaVersion` 的记录迁移：只有 v1，没有旧版本可测；导入会拒绝版本不符的文件。
5. Safari、真实手机未验证（Windows 上无法覆盖）。
6. 135 张插图只验证了“引用可解析 + 非空”，没逐张肉眼检查内容。

## 6. 接手后第一步

```text
cd D:\desk\1learn\OS\exercises\os-exercises
git status --short --branch
git rev-parse HEAD
python -X utf8 scripts/validate_dataset.py     # 必须全绿再动手
```

若 `python` 报 `No module named 'bs4'`，说明用错了解释器：本机可用的是系统 Python
`"E:\Program Files\python\python.exe"`（已装 bs4 4.13.3 + lxml），或先 `pip install -r requirements.txt`
建虚拟环境。校验通过时最后一行是“全部校验通过。”，前面 12 行以 ✓ 开头。

读文档顺序：`README.md` → `docs/实施计划.md` → `docs/执行清单.md` → `docs/导入验收.md` →
`docs/映射审核记录.md` → `docs/使用说明.md` → `docs/维护与更新.md` → `docs/验收报告.md` → 本文件。
`docs/章节映射草案.md` 是**早期草案**，部分结论已被 `映射审核记录.md` 修正，不要当现状。

## 7. 踩过的坑（会重复踩，先看这里）

1. Windows 下 Python `write_text` 会把 `\n` 转 CRLF；`.gitattributes` 对 `*.json`/`*.md`/`*.py` 设了 `eol=lf`，
   提交后仓库内是 LF，无需处理，但别用字节数比对工作区文件。
2. bs4 不要用 `str(node)` 往返解析，lxml 会包上 `<html><body>`，导致题干多一层 div；用 `copy.copy(node)` 原地改。
3. `index.html` 必须引 `vendor/katex/katex.min.js`，否则公式静默不渲染（只引 CSS 不够）。
4. 答案一致性扫描必须对整段 stem 判断否定词（“错误的是/不属于”常在题干后半段），只看前 60 字会把
   “选错误项”的题全判成矛盾。
5. “唯一被标正确的选项”这种推断不可靠（“B、D 正确”会误判），只用“故选 X / 答案 X”这类直接陈述。
6. 文档里不要写死当前 HEAD——写进去就产生新提交，立刻失效；改成描述核对方法。
7. Playwright 官方源下 Firefox 会卡住，换 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`。
8. `build_mappings.py` 里循环变量别命名成 `topics`，会覆盖后面的 topics 字典导致 TypeError。
9. GitHub Pages 站点永远公开，私有仓库开 Pages 需要付费方案（422）；这是把仓库转 public 的根本原因。
10. 学习记录按 origin 隔离：本地 8765 与线上 `dou307.github.io` 是两套记录，要搬运用首页导出/导入。
11. `main.focus()` 会画出整块焦点框，CSS 里已用 `main:focus{outline:none}` 处理。
12. `printf` 写含反斜杠的 JSON 会转义失败，用 Python `json.dumps` 生成配置文件。
13. 机器上有多个 Python：托管解释器（`.workbuddy-ai/binaries/python`）没装 bs4，跑 `validate_dataset.py`
    会 `ModuleNotFoundError`。用系统 Python 或先建虚拟环境装 `requirements.txt`，别误判成代码坏了。

## 8. 保护边界（长期有效）

- `vendor/kaoyan-408-os/` 只读，禁止直接改写；修正走 `data/overrides/`，展示时合成。
  `dist/` 里对它的 CDN 改写是构建行为，不是数据修正。
- `personal/` 永远不是清理目标；不通过删除 `personal/`、清空 localStorage 来“修复”问题。
- 原 Obsidian 笔记（`D:\desk\Obsidian\1大三秋冬\OS`）、OS 实验目录、已有实验学习站只读。
- 上游无 LICENSE 且含教材插图；不要声称获得重新授权，不要给整个仓库套 MIT。
- 仓库虽已公开，若用户改变主意，关站与转回私有的命令见 `docs/来源说明.md` 与 `docs/维护与更新.md` 6.1 节；
  这类对外动作必须先确认用户意图。
- 一切新增文件放项目根目录内，临时产物放 `_work/`（已 gitignore），不要散到上级 `exercises/`。
- 始终用简体中文与用户沟通；遇到无法从资料确定、会改变用户意图的事，先问，不把猜测当事实。

## 9. 文件所有权速查

| 路径 | 生成方式 | 能手改吗 |
|---|---|---|
| `vendor/kaoyan-408-os/` | 上游快照 | **不能** |
| `data/questions.json`、`source-registry.json` | `import_questions.py` | 不建议，重跑被覆盖 |
| `data/mappings.json`、`chapters.json`、`topics.json`、`study-defaults.json`、`overrides/errata.json` | `build_mappings.py` | 改脚本里的 `CH1_REVIEW`/`SECTION_MAP`/`ERRATA` |
| `tests/fixtures/samples/` | `import_questions.py --write-fixtures` | 只在确认变化合理后重写 |
| `app/` | 手写 | 可以 |
| `dist/` | `build.py` | 不要手改，会被删重建 |
| `_work/`、`dist/` | 本地 | 不提交 |
| `config.local.json` | 手写（本机） | 已 gitignore |

## 10. Git 与远端

- `origin` = `https://github.com/dou307/os-exercises.git`，默认分支 `main`。
- 提交习惯：按可审核的单位提交，信息写实际完成的行为与验证结果，不写未执行的结果；推送用明确文件范围，不用 `git add .`。
- 每次推送后核对本地与远端 HEAD 是否一致（`git rev-parse HEAD` 对比 `git ls-remote origin refs/heads/main`）。
- 最近一次提交：上线 Pages 与文档（Actions 已部署成功）；具体 SHA 以 `git log` 为准。

## 11. 给用户交代时要说的（上次已经交代过，可作模板）

- 本次实际完成的阶段：P1～P5 全部完成，另加 GitHub Pages 上线。
- 首章可做题的精确数量与筛选依据：第一章 56 道中 core 42（含 2 道争议只读）、bridge 1、supplement 13；
  实际可自动判分 39 道 + 综合题自评 1 道；其余 32 道按知识点归到第 2/3 章。
- 保留但暂不计分的题：3 道争议题（`c1-s2-0-q009`、`c1-s3-0-q009`、`c1-s3-0-q011`）与 5 道多空题。
- 运行入口：线上 `https://dou307.github.io/os-exercises/`；本地 `.\scripts\start.ps1`。
- 真实验证结果：十二类数据校验全绿；浏览器 35 项 × 3 引擎全过；线上 34/34。
- 本地提交与 GitHub：HEAD 见 `git log`，推送后本地与远端一致，仓库 public。
- 未完成项与失败证据：见第 5 节，不称为“已同步”或“已闭环”的部分绝不夸大。

## 12. 附：目录结构

```text
os-exercises/
├─ README.md / AGENTS.md / THIRD_PARTY_NOTICE.md / requirements.txt / config.example.json
├─ .github/workflows/deploy-pages.yml    上线 Pages
├─ .gitignore / .gitattributes           vendor/** 为 -text，保持上游字节
├─ docs/                                 计划、调查、审核、验收、交接、使用与维护
├─ vendor/kaoyan-408-os/                 上游 176 文件快照，只读
├─ personal/                             用户资料区，禁止自动覆盖
├─ scripts/                              audit / import / validate / build_mappings / build / start
├─ data/                                 questions / source-registry / chapters / topics /
│                                        mappings / study-defaults / overrides/errata
├─ app/                                  前端源码 + 本地 KaTeX
├─ tests/                                fixtures 与浏览器验收脚本
├─ dist/                                 构建产物，不提交
└─ _work/                                临时材料与截图，不提交
```
