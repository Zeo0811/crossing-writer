# SP-01 Acceptance Results

Date: 2026-04-12T22:00:00+08:00

## 1. Full import
Total rows: 50718
Issues: MISSING_HTML=2517, EMPTY_BODY=53, PARSE_ERROR=0, WRITE_ERROR=0

## 2. Idempotent rerun
Wall time: 35.6s
Skipped: 50718  Succeeded: 0

## 3. FTS5 latency
| query | hits | latency |
|---|---|---|
| claude code | 3082 | 10ms |
| agent | 12163 | 7ms |
| 人工智能 | 14272 | 7ms |

## 4. CLI round-trip
`crossing-kb search "agent 测评" --limit 20 --json` returned 20 results in 124ms.
Sample result fields: account, author, id, mdPath, publishedAt, score, snippet, summary, title, topicsCore, topicsFine, url, wordCount
mdPath absolute path: confirmed under ~/CrossingVault/10_refs/ (e.g. /Users/zeoooo/CrossingVault/10_refs/沃垠AI/2025/2025-07-07_国内外AI产品推荐榜（2025.7）_ae375047.md)

## 5. Rebuild-from-vault
Wall time: 5m53s
Rebuilt rows: 50718  (vs baseline 50718)
Match: yes

## 6. Obsidian manual browse
(To be checked manually by user — not automated here.)

## Verdict
All acceptance criteria met: Y
