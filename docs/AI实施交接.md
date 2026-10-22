# OS 练习室实施交接（给接手的 AI）

更新时间：2026-10-21。此文件是执行交接，不代表 P1～P3 已完成。请先核对 Git 工作树和现有文件，再按实际状态继续。

## 接手任务

用户已授权：**先完成题目的无损结构化提取和第一章 Introduction 的适配练习闭环，完成验证后同步到 GitHub**。不要停在方案或界面草图。P4 全章适配与完整离线化、P5 全面交付暂非本次必须完成的范围；实施中发现首章功能的必要依赖可以一并处理，并如实记录。

本地根目录：`D:\desk\1learn\OS\exercises\os-exercises`。GitHub 目标：私有仓库 `https://github.com/dou307/os-exercises`，`main` 分支。项目的一切新增文件、临时脚本、截图和报告都放在这个根目录内，临时产物放 `_work/`；不要把文件散落到上级 `exercises/`。用户也会使用该文件夹，尤其要保护 `personal/`。

请先阅读根目录 `AGENTS.md`、`README.md`、`docs/实施计划.md`、`docs/执行清单.md`、`docs/调查记录.md`、`docs/来源说明.md`。它们包含完整的阶段定义和依据。本文件只列最容易遗漏的执行约束。始终用简体中文与用户沟通；遇到无法从资料确定、会改变用户意图的事项，先询问，不把猜测当事实。

## 已完成的基线；尚未实施的部分

- P0 已完成：建立独立仓库，迁入上游 176 个文件的逐字节快照，保存来源清单、题块目录、笔记标题目录和完整计划。上游锁定提交 `e360b96fbd6522656d633ad9e26b7dd91f7bd1b4`，来源 `jlshdsdk/kaoyan-408-os`。
- 开始本交接时，本地 `main` 与 `origin/main` 一致，HEAD 为 `41107a29ebac58a024f8bc2336ec39be97cda4f6`，工作树干净。接手时重新运行 `git status --short --branch` 和 `git rev-parse HEAD`，以实时状态为准。
- P1 正式提取、P2 正式映射和 P3 练习界面**均未开始**。`docs/audit/question-catalog.json` 只有题目预览和临时 ID，不能当完整题干或可运行题库。现有 45 道首章候选只是待复核草案。
- `vendor/kaoyan-408-os/` 为锁定快照，禁止直接改写。`_work/upstream.git/` 是未提交的上游完整 Git 镜像；它不在新机器的 Git 克隆中。若不存在，按实施计划重建或直接用快照做内容提取，但必须核对锁定版本。

## 内容事实与保护边界

- `article details.qa` 总计 **760** 个，只有 **713** 个带 `.q` 容器；另外 47 个独立综合题不能漏提。五章总数分别为 ch1=88、ch2=276、ch3=166、ch4=110、ch5=120。
- 选择分区共有 650 个题块，其中 645 个是简单单字母答案，另有 5 个多空/复合题；综合题共 110 个。不要把五个特殊题强制当单选，也不要给综合题编造自动分数。
- 第一章来源 `vendor/kaoyan-408-os/ch1/quiz.html` 有 86 道选择分区题和 2 道独立综合题。其他章节存在 H3 标题引入的独立综合题，以及带 `.q` 容器的复杂综合题。提取必须保留完整题干、子问、答案与解析、表格、图片、代码和公式。
- 本地笔记只读目录：`D:\desk\Obsidian\1大三秋冬\OS`。15 个主章节和 `2.1-Rebuilding the Linux Kernel.md` 补充章的真实文件名、标题、哈希见 `docs/audit/notes-outline.json`。**只有 Introduction 已被用户确认学完**；不能从 `index.md` 的勾选推断其他章进度。
- 原 Obsidian 笔记、OS 实验目录、已有实验学习站只读。`personal/` 用户资料不得自动覆盖或清空。原题答案有争议时保留原文，在独立勘误层标注并附证据；待审争议题不自动计分。
- 上游无 LICENSE，且含教材插图。保留来源说明，仓库保持 PRIVATE；不要启用公开 Pages、改可见性或声称已获得重新授权。
- Windows Git 可能启用 `core.autocrlf=true`。处理 vendor 时必须保持字节，不能让 LF/CRLF 自动转换；已有 `.gitattributes` 对 vendor 设置 `-text`。构建或导入脚本不得重新写入 vendor。

## 执行顺序和实际产物

1. **P1：无损提取。**先检查真实复杂样本：普通单选、ch1 独立综合题、ch2 H3 综合题、ch3 含图表/公式的题、五道特殊题。实现 `scripts/import_questions.py`、`scripts/validate_dataset.py`，产出 `data/questions.json`、`data/source-registry.json`、`tests/fixtures/`、`docs/导入验收.md`。使用稳定 ID 登记来源路径、小节、原题号及内容哈希；ID 初次分配后冻结，不能以后因排序变化重算。浏览器展示的 HTML 要移除脚本和事件属性，但保留可核对的原始内容与来源证据。
2. **P2：首章映射。**根据真实笔记小节生成 `data/chapters.json`、`data/topics.json`、`data/mappings.json`、`data/study-defaults.json`、`data/overrides/errata.json` 和 `docs/映射审核记录.md`。可把其余章标为待审，但首章每道纳入练习的题须逐题核对前置知识、类型和答案疑点。核心/桥接/后续/争议要有明确理由；45 道候选不能机械全选。第 1 章 1.3 的第 9、11 题及调查记录中的其他疑点先审查，不确定时隔离自动计分。
3. **P3：首章闭环。**实现可本地启动的静态练习界面（计划文件见 `docs/实施计划.md`）：课程目录、首章可做题、来源和笔记知识点、单选提交与解析、刷新恢复实际选项、错题回顾与重做、原站阅读入口。进度按稳定题目 ID 保存，使用独立存储名 `os-exercises:v1`，不能覆盖原站 `os408-*`。若本地存储失败，界面须明确提示。综合题只允许查看解析/自评，除非有可靠判分规则。
4. **验证与同步。**核验 760 条提取数量及分章/题型数、47 道无容器题、五道特殊题、完整解析和本地资源引用；用真实浏览器走完“第一章→选题→作答→解析→刷新恢复→错题回顾→重做”，并检查约 390px 宽度、键盘使用、控制台与资源请求。检查 vendor 字节不变、`personal/` 与笔记未被修改，更新 `README.md`、`docs/执行清单.md` 和实际验收记录。按明确文件范围提交，推送私有 `origin/main`，最后验证远端 HEAD 与本地一致及 Git 工作树状态。不要把未执行的检查写成通过。

## 推荐开始命令（PowerShell）

```powershell
Set-Location 'D:\desk\1learn\OS\exercises\os-exercises'
git status --short --branch
git rev-parse HEAD
Get-Content -LiteralPath 'AGENTS.md'
Get-Content -LiteralPath 'docs\实施计划.md'
Get-Content -LiteralPath 'docs\执行清单.md'
python -X utf8 scripts/audit_sources.py --notes-root 'D:\desk\Obsidian\1大三秋冬\OS'
```

最后一条审计命令需要 `_work/upstream.git` 和 Python Beautiful Soup；如环境不同，先检查依赖与镜像，不能把运行失败解释成题目缺失。`docs/audit/` 是现有盘点基线，可与正式提取结果交叉核对。

## 完成时向用户交代

说明本次实际完成的 P1/P2/P3 范围、首章可做题的精确数量与筛选依据、保留但暂不计分的题、运行入口、真实验证结果、本地提交和 GitHub 链接。若未完成某一步，明确写出失败证据、剩余工作和当前仓库状态，不称为“已同步”或“已闭环”。
