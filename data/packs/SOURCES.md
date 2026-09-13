# 内置词库来源与整理说明

当前内置词库版本：`1.1.0`，整理日期：2026-09-09。

这些词库是人工筛选后的双语词表，不是任何网站或数据集的完整镜像。收集时只保留适合提示词输入、含义明确且具有复用价值的词，并统一为 Anima 推荐的空格分隔形式。

## 主要参考来源

- CircleStone Labs Anima 官方模型卡：<https://huggingface.co/circlestone-labs/Anima>
- Comfy Org Anima 官方教程：<https://docs.comfy.org/tutorials/image/anima/anima>
- Danbooru 标签说明和标签组：<https://safebooru.donmai.us/wiki_pages/howto:tag>
- Adobe 摄影构图资料：<https://www.adobe.com/creativecloud/photography/technique/composition.html>
- Nikon 焦距和景深资料：<https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/understanding-focal-length>
- Civitai 模型、作品及公开提示词案例：<https://civitai.com/>
- Civitai 成人内容分级实现说明：<https://github.com/civitai/civitai/blob/main/docs/features/nsfw-filtering.md>
- HoYoverse《原神》公开角色命名资料：<https://genshin.hoyoverse.com/>

## 可信度边界

- “已收录”表示词义和中文解释经过人工检查，不代表每个词在每个 Anima 版本、LoRA 和种子下都一定产生相同效果。
- Anima 官方确认支持 Danbooru 标签、自然语言和二者混合输入；因此通用标签标记为适用于 `general` 与 `anima`。
- 社区案例只作为候选词来源，不直接复制整段提示词，不收录作者专用 LoRA 触发词。
- 角色名称使用社区常见的作品限定写法，避免同名角色混淆。

## 成人词库边界

成人内容词库保持为独立包，只收录明确成年、合意场景的通用提示词。未收录未成年人、年龄不明、真实人物色情化、非自愿、乱伦、血腥虐待和排泄物等类别。停用成人词库后，其词条不会参与搜索或提示词识别。
