# AI实施交接（当前版）

更新：2026-11-17。下一位AI先读README、[执行清单](执行清单.md)、[验收报告](验收报告.md)。早期从零计划完整保存在 [历史交接](history/2026-10-23-AI实施交接.md)，不把其中“230未审”“仓库私有”等旧状态当成当前事实。

## 已完成及正式输入

760道全部提取并逐题复核。第一章审核在 `scripts/build_mappings.py`；来源第二至五章在 `data/reviews/ch2.json` 至 `ch5.json`。由 `build_mappings.py --write-doc` 校验来源哈希/笔记定位、叠加审核、生成映射/勘误与报告。不要改生成JSON后又被脚本覆盖。

旧37争议复审在 `data/reviews/dispute-followup.json`；年份证据176条在 `data/reviews/exam-years.json`；135图记录在 `docs/audit/image-review.json`。全库343条备注、52道争议排除自动计分。来源题、答案、ID不变。

`app/js/settings.js`保存本机笔记设置和当前标签页令牌，`sync.js`负责私有仓库下载校验合并/带SHA上传；`storage.js`保持v1兼容，新增可选draftChanges/chapterChanges记录取消。数据仓库 `dou307/os-exercises-progress` 私有，正式文件 `progress-v1.json`；公开题库 `dou307/os-exercises`。

本机注册Obsidian库为Obsidian，库内目录 `1大三秋冬/OS`；页面设置按设备独立保存。原笔记只读，不能把I/O笔记HTML注释中的空标题当成已有正文。

## 继续工作的优先级

1. 在用户安卓设备按真机验收页检查系统键盘、文件导入导出、真实笔记跳转；自动化结果不能冒充真机。
2. 进一步取得可靠完整题卷，对108条片段证据补完整题面/选项/附图的校勘；现有1年份反证和1数值差异均保留原文并显示提示。examYearVerified仍false。
3. 有完整来源后补充被裁切的图或缺失题图/机器码，另建补充层并说明来源；不直接改vendor、不凭空重绘参数。
4. 如需更改同步方案，先保留现有v1记录兼容与撤销标记；无需多用户账号系统，不擅自改为公开数据仓库。

## 验证与发布

```powershell
python -X utf8 scripts/build_mappings.py --write-doc
python -X utf8 scripts/validate_dataset.py
python -X utf8 scripts/audit_assets.py --write-doc
python -X utf8 -m unittest discover -s tests -p 'test_*.py' -v
python -X utf8 scripts/build.py
```

启动HTTP后运行 `tests/browser/acceptance.js`、`review-regressions.cjs`、`ch2-review.cjs`、`ch3-review.cjs`、`favorites-numbering.cjs`、`sync-settings.cjs`。浏览器依赖和截图集中 `_work/`；模拟同步为默认，不需要令牌。真实云端验收只用独立acceptance-v1.json，不触碰正式progress-v1.json，结束清理测试文件。

发布用已有main与GitHub Pages工作流，推送后等对应提交Actions的build/deploy终态成功并线上实际测试。不能用旧成功run替代本提交结果。不得泄露gh现有凭据、浏览器token、学习记录；不要向用户索要聊天令牌。

保护vendor/personal/原笔记/实验；全部新增文件和缓存落在本项目，不覆盖其他AI或用户改动。
