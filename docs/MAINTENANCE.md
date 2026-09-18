# 维护与发布手册

本文给出后续修改本扩展时的固定流程。目标是避免修复一个界面问题时破坏无损输出、旧工作流、个人数据或发布安全。

## 1. 开始修改前

1. 阅读 `README.md`、`docs/ARCHITECTURE.md`、`docs/DESIGN_DECISIONS.md` 和 `docs/KNOWN_ISSUES.md`。
2. 检查 `git status --short --branch`，现有未提交内容默认属于用户，不得覆盖。
3. 记录当前 Git 提交和 ComfyUI 前端版本。
4. 用最小工作流复现问题，保存输入、操作顺序、预期和实际结果。
5. 判断问题属于解析、UI、词库、助手、安全路由还是 ComfyUI 兼容性，不要在主界面大文件中盲改。

## 2. 文件修改路由

| 需求 | 首选文件 | 必须回归 |
|---|---|---|
| 标签/白话文边界 | `js/parser.js` | parser、mixed boundaries、旧工作流显示 |
| Anima 分类顺序 | `js/anima_sorter.js` | sorter、权重和自然语言保持 |
| 收藏/搜索/导入预览 | `js/dictionary_tools.js` | dictionary tools、跨节点刷新 |
| 多节点状态 | `js/panel_sync.js`、`js/bilingual_prompt.js` | panel sync、多节点手测 |
| 滚轮 | `js/wheel_guard.js` | wheel guard、画布普通区域缩放 |
| 节点界面 | `js/bilingual_prompt.js` | 新旧节点、缩放、折叠、长提示词 |
| 个人/社区词库 | `dictionary_store.py`、`server.py` | dictionary store、备份、导入上限 |
| 助手规则/API | `assistant_store.py`、`server.py` | assistant store、Key 不返回、端点变更清 Key |
| 大型库转换 | `tools/build_large_dictionary.py` | builder、真实小样本、失败不替换旧库 |
| 节点接口 | `nodes.py`、`__init__.py` | 旧工作流兼容；原则上避免修改 |

## 3. 自动测试

在项目根目录执行：

```powershell
npm test
python -m unittest discover -s tests -p "test_*.py"
```

如果环境中只有 `node` 而没有 `npm`，可按 `package.json` 中的顺序直接执行：

```powershell
node tests/test_parser.mjs
node tests/test_mixed_boundaries.mjs
node tests/test_dictionary_tools.mjs
node tests/test_anima_sorter.mjs
node tests/test_panel_sync.mjs
node tests/test_wheel_guard.mjs
node tests/test_author_link.mjs
node tests/test_performance.mjs
```

如果系统 Python 缺少 ComfyUI 依赖，使用当前 ComfyUI 实际运行的 Python。当前 Python 测试以标准库和临时目录为主，不应接触真实个人配置。

额外语法检查：

```powershell
node --check js/bilingual_prompt.js
node --check js/parser.js
python -m py_compile __init__.py nodes.py server.py assistant_store.py dictionary_store.py tools/build_large_dictionary.py
```

发布前还应执行：

```powershell
git diff --check
git status --short
```

## 4. 解析器回归矩阵

修改解析逻辑时至少覆盖：

- 纯标签、纯白话文。
- 标签后白话文、白话文后标签、标签夹白话文。
- 白话文包含多个逗号并以逗号或句号结束。
- 后置只有一至三个短英文从句时不应武断拆分。
- 后置存在多个质量、人数、外观、环境标签时应恢复拆分。
- `(tag:1.3)`、嵌套括号、`@artist`、`<lora:name:1>`、`BREAK`、`AND`。
- 连续逗号、中文标点、空行、重复标签。
- 相同标签出现多次时，只删除或改权重当前出现位置。
- 单标签翻译仍拦截模型扩写；自然语言翻译允许正常增加逗号。

不得通过为某一条示例硬编码完整句子来修复边界，应补充可泛化信号和反例。

## 5. UI 手工检查

至少在一个空节点和一个由旧工作流恢复的非空节点上检查：

1. 空节点默认文本编辑，输入期间不跳视图。
2. 完成编辑后英文标签、中文标签和明细行三处联动。
3. 中文点击/双击不会留下错误浏览器选区。
4. 英文与中文标签双击都能改权重，重复标签只改当前项。
5. Delete、Backspace、Ctrl+Z、Ctrl+Y 正常。
6. 长提示词时各滚动区不拉长节点，鼠标滚轮不缩放画布。
7. 英文编辑框可调高度，绿色草稿随内容增长并在上限后滚动。
8. 多个节点的收藏、最近使用、待确认及词库刷新一致。
9. 翻译/优化结果不会在未确认时覆盖实际输出。
10. 切换主题、缩放节点和刷新页面后布局仍可用。

## 6. 助手与安全回归

- 读取配置的 JSON 中不能出现真实 `api_key` 字段值。
- 保存 Key 后只显示“已配置”，改变 provider 或 base URL 后旧 Key 必须清空。
- 删除安装身份并重启后，旧助手配置必须失效。
- 外部 `http://` 地址应被拒绝；localhost、私网本地服务按当前策略允许。
- API 地址不能携带用户名、密码、查询参数或片段。
- 缺少/错误 `X-BPI-Token` 的受保护路由返回 403。
- 跨站会话请求返回 403。
- 超长输入、超长规则、超大导入和频繁助手请求被限制。
- 外部服务失败时只显示错误，不修改英文输出。

不要把“同源 + 会话令牌”描述成完整身份认证。若将来需要公网或多用户部署，应交给 ComfyUI 外层认证、反向代理或专门权限系统处理。

## 7. 词库与数据库回归

- 内置包启停后，有效词库和数量正确。
- 个人覆盖优先，删除后恢复底层词条。
- 社区包只能在上限内导入，ID 和文件名不能目录穿越。
- 导入和批量修改前创建备份，备份总数不超过 50。
- 大型库关闭或缺失时，普通节点仍能工作。
- 大型库只读打开；精确查询一次最多 200 项，搜索最多 100 项。
- ffdkj SQLite 必须包含 `tags` 表及必要字段；TSV 必须是四列。
- 构建失败不能替换当前数据库；成功替换前应保留 `.previous`。

真实大型库只用于本地人工验证，不能复制进测试夹具、Git 或 Release。

## 8. 兼容性规则

- 保持节点类名、输入名 `text`、输出名和类型。
- 保持工作流中的实际提示词仍存于原生控件。
- 新增前端状态时应提供缺省值，旧工作流没有该字段也能打开。
- 更改个人词库、包清单或助手配置 schema 时必须提供向前迁移，并保留旧数据备份。
- 不用“重装即可”掩盖迁移问题；先区分覆盖升级和完整卸载重装。

## 9. 文档与版本更新

每次发布至少更新：

- `README.md`：当前真实功能和用户操作。
- `DEVELOPMENT_HISTORY.md`：新增代次或重要修复的由来。
- 新增 `CHANGELOG.md`（若后续采用）：按公开语义版本记录用户可见变化。
- `package.json`：公开发布版本。
- Release 标题、标签和压缩包文件名。

若改动影响架构或设计原则，同时更新本目录文档。文档中的版本、路径、数量和安全声明必须与代码一致。

## 10. 干净发布流程

优先使用：

```powershell
powershell -ExecutionPolicy Bypass -File tools/build_community_release.ps1
```

具体参数以脚本帮助和当前 README 为准。生成后检查 ZIP 内容，不要直接压缩正在运行的 `custom_nodes` 目录。

发布 ZIP 不得包含空的 `user_tags.json`、`pack_settings.json` 或 `large_dictionary.json` 作为“默认文件”；这些文件缺失时后端会使用安全默认值，需要写入时再创建。这样普通目录合并覆盖才不会清空旧用户数据。发布脚本必须执行内置覆盖升级哨兵测试并保持浏览器收藏存储键兼容。

禁止进入源码提交或发布包的内容：

- `data/user_tags.json` 及真实个人词条。
- `data/backups/`。
- `data/danbooru_tags.sqlite3`、来源 `tag.sqlite`、`.previous`。
- `data/runtime/installation_id`。
- `assistant_settings.json`、API Key、服务商选择和本机地址。
- `pack_settings.json`、`large_dictionary.json` 中的个人选择。
- `.git/`、`node_modules/`、`__pycache__/`、`.pyc`、日志、临时文件。
- 私人提示词、完整私人工作流、模型路径和截图中的个人信息。

发布检查建议：

```powershell
git ls-files
git grep -n -I -E "(sk-[A-Za-z0-9_-]+|api[_-]?key|Authorization: Bearer)"
```

第二条只能作为辅助，不能替代人工查看暂存差异和 ZIP 清单。

## 11. GitHub 操作边界

- 修改、测试和本地打包属于正常维护步骤。
- 推送 GitHub、创建标签、覆盖 Release 或删除远端资源前，需要项目所有者明确确认。
- 推送前检查远端地址、分支和即将提交的文件。
- 发布后验证仓库源码、Release 资产和 SHA256，并观察自动测试结果。

## 12. 问题报告最小信息

建议要求用户提供：

- ComfyUI 类型和版本。
- 浏览器及是否 `Ctrl+F5`。
- 扩展版本/提交。
- 最小可复现提示词（隐私内容可替换，但需保留标点结构）。
- 自动/标签/自然语言模式。
- 明确操作步骤、截图和浏览器控制台错误。
- 后端错误时提供脱敏终端日志，绝不能提供 API Key 或完整配置。
