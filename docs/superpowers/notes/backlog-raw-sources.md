# Backlog：Raw 资料源扩充

SP-01 只完成了「60 家公众号历史存量」的 bulk import。下述增量/新源是后续独立子项目（暂未排期，tag 打标跑完再议）。

## 要做的

### 1. X.com（Twitter）账号内容监控
- 选一批目标账号（AI 创业者 / 研究者 / 公司官方）
- 每日抓取 timeline（nitter / 第三方 API / 浏览器插件均可）
- 落入 `vault/10_refs/` 同一 schema，`source=x_post`

### 2. 科技网站内容监控
- **批量铺设**：历史文章一次性导入（类似 SP-01 的 bulk pattern）
- **日常新增监控**：每天 / 每小时 RSS / scraper poll，增量入库
- 候选站点：36氪、PingWest、机器之心官网、arXiv、Hacker News 等

### 3. 日常增量框架
- 通用入口：`crossing kb ingest <source-type> <url>`
- 后台 daemon 或 cron：每天跑一次增量
- 去重：URL 唯一 + content_hash

## 何时做
- Phase 2 打标跑完后
- SP-02 wiki 试点验证完 schema 后（别先扩源再改 schema）
