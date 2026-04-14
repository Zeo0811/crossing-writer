## 工具调用协议

如果你需要查 wiki 或 raw 文章作参考，输出 ```tool 块（每行一条命令）：

```tool
search_wiki "<query>" [--kind=entity|concept|case|observation|person] [--limit=5]
search_raw "<query>" [--account=<account_name>] [--limit=3]
```

规则：
1. 一次 round 可以发多个命令（每行一条）
2. 你最多可以来 **5 round**；查完一直到不再发 tool 块就视为你写完了
3. 如果你不需要查任何东西，直接输出最终段落，不发 tool 块
4. 工具结果会作为 user message 追加给你；基于结果继续写或继续查
5. quoted 引用 wiki 内容时记得带 source（例如 "据 concepts/AI漫剧.md..."）
