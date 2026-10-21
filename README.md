# OS 练习室

将王道 OS 第三方题库按本地《Operating System Concepts》笔记框架重新组织，服务课程复习和分章练习。

**当前阶段：调查与详细计划。已导入完整上游快照；适配后的练习界面尚未实施。**

- GitHub：<https://github.com/dou307/os-exercises>，私有仓库。
- 本地项目：`D:\desk\1learn\OS\exercises\os-exercises`。
- 已确认的学习进度：第一章 Introduction 已学完。其他章节尚未由用户确认。

## 从这里开始

1. [实施计划](docs/实施计划.md)：阶段、具体文件、执行顺序、验收、风险与回退。
2. [章节映射草案](docs/章节映射草案.md)：15 个主章节与 Linux 补充章如何对应原题库。
3. [调查记录](docs/调查记录.md)：原仓库结构、真实题量、已发现的问题。
4. [执行清单](docs/执行清单.md)：可继续执行的任务和完成证据。
5. [来源说明](docs/来源说明.md)：版本、来源与许可边界。

## 文件怎么放

| 目录 | 用途 | 是否适合你直接放自己的文件 |
|---|---|---|
| `personal/` | 你的笔记、自编题、学习记录备份 | **适合**，程序不得覆盖 |
| `docs/` | 计划、映射、调查和项目交接 | 可阅读；手工学习笔记建议放 `personal/notes/` |
| `vendor/kaoyan-408-os/` | 原仓库 176 个文件的完整、未改写快照 | 保留原样，改动通过适配层完成 |
| `scripts/` | 调查、导入、生成和校验工具 | 工具维护区 |
| `_work/` | 本地上游 Git 历史镜像和临时材料 | 不提交 GitHub，不作为长期个人资料目录 |

后续才会创建 `app/`、`data/`、`tests/` 和构建目录 `dist/`，现在不会用空文件伪装实现进度。

## 当前可用的内容

- `vendor/kaoyan-408-os/index.html`：原站入口；仍按原来的 5 章排列。
- 760 个答案块、135 张图片、38 个 HTML 文件已经逐文件核对到上游 Git 对象。
- `docs/audit/` 保存题目目录、笔记标题结构、文件哈希清单。它们是调查材料，不是完成后的题目映射。

原站搜索使用 `fetch`，公式依赖 CDN；直接双击 HTML 不保证搜索和公式工作。需要预览原站时，在本项目下运行：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory vendor/kaoyan-408-os
```

然后访问 <http://127.0.0.1:8765/>。这是原站预览，尚非适配后的练习室。

## 重做调查

现有 Python 环境已具备 Beautiful Soup，使用以下命令重新核对本地来源：

```powershell
python -X utf8 scripts/audit_sources.py --notes-root "D:\desk\Obsidian\1大三秋冬\OS"
```

此命令需要本地 `_work/upstream.git` 镜像。新机器只有 GitHub 工作副本时，应先按实施计划重建该镜像，再运行调查。

## 使用与维护约定

- 个人资料优先放 `personal/`；浏览器进度、导出文件和本机配置默认不推送。
- 不根据笔记 `index.md` 的勾选推断学习进度。
- 不修改原 Obsidian 笔记、OS 实验代码或已有实验学习站。
- 上游内容保留来源；存在疑点的题目不会默默更改原答案。
- 本仓库没有对第三方内容另行授予开源许可，也未启用公开站点发布。
