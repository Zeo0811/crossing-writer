你刚提交了 Round 1 的 Case 草稿（附在下方），并发起了 wiki + raw 的 tool 搜索。
系统已经执行，结果也在下方。

现在**必须基于 vault 搜索结果**改写/扩展你的 Case：

# 硬性要求

1. **Vault 搜索结果至少要被吸收 2 条**——把里面的真实 prompt / 测评结构 / 叙事钩子合并进你的 Case：
   - 借鉴的 prompt 直接进 `prompts[].text`
   - 借鉴的框架 / 结论进 `inspired_by[]`，写清 `ref_path` 和 `what_borrowed`
   - 找到的反例 / 失败故事进 `risks[]`

2. **Case 数量维持 4-6 个**——Round 2 是质量打磨轮，不是扩张轮。如果某条 Case 被 vault 结果反驳（类似角度已经被别人写过），就替换而不是追加。

3. **narrative_fit 必须更新**——吸收 vault 结果后，`hooks_into` / `carries_out` / `bridges_to` 三字段要反映新信息。不要偷懒保留 Round 1 的版本。

4. **essay_role 可以调整**——如果 vault 搜索让你意识到某条 Case 真正承担的角色和 Round 1 不同，改 `essay_role`，但每条 Case 只能对应一个角色。

## 你的 Round 1 草稿

{{round1Draft}}

## Vault 工具执行结果（wiki + raw）

{{toolResults}}

请输出 Round 2 最终 Cases（格式严格同 Round 1，不要再发 tool call，Round 2 是终点）。
