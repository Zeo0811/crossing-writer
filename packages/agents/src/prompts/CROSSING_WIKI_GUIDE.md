# CROSSING_WIKI_GUIDE

十字路口 writer 的只读知识库规约。Ingestor 必须按此文档组织 wiki，writer 只读它。

## 1. 目录与 kind

- `entities/` — 具体可命名的实体（产品/工具/公司/机构/SDK）
- `concepts/` — 抽象概念、技法、模式、行业判断
- `cases/` — 具体实测 case（含 prompt + 结构 + 素材）
- `observations/` — 可独立引用的事实/数据点（带出处）
- `persons/` — 人物（作者、产品人、投资人、KOL）

## 2. 命名

- 文件名直接用中文 title（保留中文），空格替换为 `-`
- 禁用 `/` `:` `\` `?` `*` 等文件系统敏感字符
- Alias 多写在 frontmatter `aliases:`，不拆成多个文件

## 3. 去重优先

- 新文章提到的产品/概念若已有 wiki 页（title 或 alias 命中）→ 走 `append_source` / `upsert` 合并
- 只有确认是新实体/概念时才新建 `upsert`
- 命中判断至少覆盖 title 完全相等、alias 精确匹配、以及题干关键词高相似

## 4. 每条 source 必带

- `account` — 账号名
- `article_id` — raw 文章 id（writer 引用时带出处）
- `quoted` — 从原文摘 1-2 句原话（不可改写、不可总结）

## 5. 冲突处理

- 同一事实两篇说法不一 → 页面正文加 `<!-- conflict -->` 段，双方都写 + 各自 source
- 不要自行判定谁对

## 6. Backlink

- 概念页里提到某 entity → `add_backlink`（宿主自动反向建链）
- case 里涉及 entity 同理
- 不加 backlink 到同一页自己

## 7. 禁止

- 写主观评价 / LLM 自己"总结"的句子（只许事实 + 原文 quote）
- 编造 image URL（`images` 只能从 raw html/markdown 抽）
- 删除或重命名页面（本期只开放 upsert/append_source/append_image/add_backlink/note）

## 8. Frontmatter 字段（基础）

```yaml
type: entity|concept|case|observation|person
title: ...
aliases: [...]
sources:
  - { account, article_id, quoted }
backlinks: [path, ...]
images:
  - { url, caption?, from_article? }
last_ingest: ISO8601
```

按 kind 可扩展：
- entity: `category: product|tool|company|org`
- case: `prompt_text`, `structure`
- observation: `fact`, `data_point: {value, unit, as_of, source}`
- person: `role`, `affiliation`
