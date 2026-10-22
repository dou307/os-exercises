# OS 练习室

把王道 408 操作系统题库按本地《Operating System Concepts》笔记的章节框架重新组织，服务分章复习与逐题练习。

**当前阶段：P1 无损提取、P2 第一章映射审核、P3 第一章练习闭环已完成并验证。P4 全章适配与离线化、P5 综合交付尚未完成。**

- GitHub：<https://github.com/dou307/os-exercises>，私有仓库，未启用公开站点。
- 本地项目：`D:\desk\1learn\OS\exercises\os-exercises`。
- 已确认的学习进度：仅第一章 Introduction 学完；其余章节状态 unknown。
- 全库 760 道题已结构化；**只有第一章 88 道逐题审核过**，其余 672 道仅按上游分区初筛。

## 快速开始

需要 Python 3（含 `beautifulsoup4`、`lxml`）。

```powershell
Set-Location 'D:\desk\1learn\OS\exercises\os-exercises'
.\scripts\start.ps1            # 构建 dist/ 并在 http://127.0.0.1:8765/ 启动
```

也可以分步执行：

```powershell
python -X utf8 scripts/import_questions.py   # 从 vendor 提取题目
python -X utf8 scripts/build_mappings.py     # 生成章节、知识点、映射、勘误
python -X utf8 scripts/validate_dataset.py   # 校验提取结果
python -X utf8 scripts/build.py              # 组装 dist/
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

必须通过 HTTP 访问：直接双击 `index.html` 会因浏览器对 `fetch` 的限制而加载不到数据。

## 现在能做什么

- **第一章闭环**：课程导航 → 第一章题单 → 逐题作答 → 判分与解析 → 刷新恢复实际选项 → 错题回顾 → 重做。
- **范围控制**：第一章 56 道题里，42 道核心（含 2 道待核对）、1 道桥接、13 道课程外补充；
  其余 32 道按知识点归到第 2/3 章，不在第一章出现。实际可自动判分 39 道，另有 1 道综合题自评。
- **争议隔离**：3 道答案存疑的题保留原文、单独记录勘误、不自动计分；2 道标注前提说明。
- **特殊题型**：5 道多空/复合题保留原始选项块，只提供答案与自评，不伪造自动判分。
- **综合题**：可写自答草稿（存本机），再看参考答案并自评。
- **原题库入口**：完整保留上游 5 章页面，可按原样阅读。

学习记录只写入 `os-exercises:v1` 命名空间，不读写原站的 `os408-*` 键；存储不可用时界面会明确告警。

## 目录

| 目录 | 用途 |
|---|---|
| `data/` | 题目、来源登记表、章节、知识点、映射、勘误、学习默认值 |
| `app/` | 练习界面源码（原生 HTML/CSS/ES Modules，含本地 KaTeX） |
| `scripts/` | 导入、映射、校验、构建、启动脚本 |
| `tests/` | 真实复杂样本（回归比对）与浏览器验收脚本 |
| `vendor/kaoyan-408-os/` | 上游 176 个文件的逐字节快照，只读 |
| `docs/` | 计划、调查、映射审核、导入验收、来源说明 |
| `personal/` | 你的资料区，程序不覆盖 |
| `dist/` | 构建产物，不提交 |
| `_work/` | 临时材料、截图、运行输出，不提交 |

## 数据来源与边界

- 上游：`jlshdsdk/kaoyan-408-os`，锁定提交 `e360b96fbd6522656d633ad9e26b7dd91f7bd1b4`。
- 760 个答案块：ch1 88、ch2 276、ch3 166、ch4 110、ch5 120；其中 47 道综合题没有 `.q` 容器，已单独识别。
- 上游无 LICENSE 且含教材插图，仓库保持私有，不声称获得重新授权。
- 原答案有疑点时保留原文，在 `data/overrides/errata.json` 记录证据，界面标注且不计分。
- 原站标注的真题年份未核实，字段 `examYearVerified` 一律为 `false`。

## 文档

1. [实施计划](docs/实施计划.md)：阶段、文件、验收与风险。
2. [执行清单](docs/执行清单.md)：已完成项的证据与剩余工作。
3. [导入验收](docs/导入验收.md)：760 道题的提取方法与实测结果。
4. [映射审核记录](docs/映射审核记录.md)：第一章 88 道题的逐题结论。
5. [调查记录](docs/调查记录.md)：上游结构、真实题量、已知问题。
6. [章节映射草案](docs/章节映射草案.md)：章节对应关系的早期草案（已被审核记录部分修正）。
7. [来源说明](docs/来源说明.md)：版本、来源与许可边界。

## 维护约定

- `vendor/` 不做补丁式修改；修正放 `data/overrides/`，展示时合成。
- 题目 ID 首次分配后由 `data/source-registry.json` 冻结；重跑导入会复用旧 ID。
- `personal/` 永远不是清理目标；原 Obsidian 笔记、实验目录只读。
- 不根据笔记 `index.md` 的勾选推断学习进度。
