# Danbooru 大型词库来源说明

## 本项目开发与验证数据库（不随公开包发布）

第十七版开发与验证时使用的 `danbooru_tags.sqlite3`，由开发用户自行下载的 ffdkj
`tag.sqlite` 在本机转换生成。转换只改变查询结构，不修改标签文字；来源数据库以
只读方式打开。公开分享包中没有这个数据库，其他用户安装后需要自行下载和转换。

- 直接来源：`ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table`
- 来源页面：https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table
- 原始文件：`tag.sqlite`
- 当前来源库记录：327,676 条（2026-09-12 下载版）
- 收录范围：来源说明称收录 `post_count >= 10` 的 Danbooru 标签

来源仓库在本扩展整理时未附带明确开源许可证。因此，公开分享包不包含原始
`tag.sqlite`，也不包含本地转换后的 `danbooru_tags.sqlite3`。用户应自行确认来源、
许可和使用范围，自行下载并仅在本地转换。

## 旧测试数据库的来源说明

第七版至第十六版开发测试时使用的 175,335 项数据库，并不是直接复制 ffdkj 的
`tag.sqlite`。它由本机 Kohya-LoRA-Tool 附带的 `danbooru_zh.tsv` 转换生成。该 TSV
自己的 `meta.json` 声明：

- 以 ffdkj 中 `post_count >= 30` 的高频词为主要来源；
- 使用 `byzod/a1111-sd-webui-tagcomplete-CN` 补充常用翻译和缺失词条。

因此，旧说明中列出的 ffdkj 与 byzod 属于旧 TSV 的上游来源，而旧 TSV 才是当时
构建工具的直接输入文件。第十七版开始优先推荐直接使用 ffdkj `tag.sqlite`。

## 本地转换方式

转换工具支持 ffdkj SQLite 和旧版四列 TSV：

```powershell
python tools/build_large_dictionary.py "来源文件完整路径"
```

生成文件为 `data/danbooru_tags.sqlite3`。替换前会将旧数据库备份为
`data/danbooru_tags.sqlite3.previous`。详细步骤见发布包外的
《大型词库手动安装说明.txt》。
