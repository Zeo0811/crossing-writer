from __future__ import annotations
import json
import re
import argparse
from pathlib import Path
from typing import Optional
import sqlite3

from .config import Config, load_config
from .db import init_db
from .claude_cli import invoke_claude, ClaudeError

CORE_TOPICS = [
    "agent", "coding", "多模态", "大模型训练", "产品测评",
    "融资", "政策监管", "开源", "具身智能", "芯片算力",
    "应用落地", "访谈", "行业观察", "评论观点", "教程",
]

_JSON_RE = re.compile(r"\{[\s\S]*\}")

def build_prompt(*, title: str, summary: Optional[str], body_excerpt: str) -> str:
    topics_list = ", ".join(CORE_TOPICS)
    return (
        "你是一个内容分类助手。根据文章标题、摘要、正文前 800 字，"
        "输出核心分类和细粒度标签。\n"
        f"核心分类必须从以下 {len(CORE_TOPICS)} 个中选 1-3 个：{topics_list}\n"
        "细粒度标签自由生成 2-5 个。\n"
        "只输出 JSON，不要其他文字：{\"topics_core\":[...], \"topics_fine\":[...]}\n\n"
        f"标题：{title}\n"
        f"摘要：{summary or ''}\n"
        f"正文：{body_excerpt}\n"
    )

def parse_claude_output(out: str) -> dict:
    # strip fenced code
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", out)
    if m:
        payload = m.group(1)
    else:
        m2 = _JSON_RE.search(out)
        if not m2:
            raise ValueError(f"no JSON in output: {out[:200]}")
        payload = m2.group(0)
    data = json.loads(payload)
    core = [t for t in data.get("topics_core", []) if t in CORE_TOPICS]
    fine = [str(t).strip() for t in data.get("topics_fine", []) if str(t).strip()]
    return {"topics_core": core, "topics_fine": fine}

def _update_md_frontmatter(md_path: Path, core: list, fine: list) -> None:
    text = md_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return
    end = text.find("\n---", 3)
    if end < 0:
        return
    fm = text[3:end]
    core_line = f"topics_core: {json.dumps(core, ensure_ascii=False)}"
    fine_line = f"topics_fine: {json.dumps(fine, ensure_ascii=False)}"
    status_line = "ingest_status: topics_tagged"
    def sub_or_append(fm_text: str, key: str, new_line: str) -> str:
        pat = re.compile(rf"^{key}:.*$", re.MULTILINE)
        if pat.search(fm_text):
            return pat.sub(new_line, fm_text)
        return fm_text.rstrip() + "\n" + new_line
    new_fm = sub_or_append(fm, "topics_core", core_line)
    new_fm = sub_or_append(new_fm, "topics_fine", fine_line)
    new_fm = sub_or_append(new_fm, "ingest_status", status_line)
    md_path.write_text(f"---{new_fm}\n---\n" + text[end+4:].lstrip("\n"), encoding="utf-8")

def run_tag(cfg: Config, *, account: Optional[str], batch: int,
            since: Optional[str], only_status: str = "raw") -> dict:
    init_db(cfg.sqlite_path)
    con = sqlite3.connect(str(cfg.sqlite_path))
    q = ("SELECT id, title, summary, body_plain, md_path, url "
         "FROM ref_articles WHERE ingest_status = ? ")
    params = [only_status]
    if account:
        q += " AND account = ?"; params.append(account)
    if since:
        q += " AND published_at >= ?"; params.append(since)
    q += " ORDER BY published_at DESC LIMIT ?"
    params.append(batch)
    rows = list(con.execute(q, params))
    con.close()

    stats = {"ok": 0, "failed": 0}
    for row in rows:
        art_id, title, summary, body_plain, md_rel, url = row
        excerpt = (body_plain or "")[:800]
        prompt = build_prompt(title=title, summary=summary, body_excerpt=excerpt)
        try:
            out = invoke_claude(prompt, cli=cfg.default_cli)
            parsed = parse_claude_output(out)
        except (ClaudeError, ValueError) as e:
            stats["failed"] += 1
            con = sqlite3.connect(str(cfg.sqlite_path))
            con.execute("UPDATE ref_articles SET ingest_status='tag_failed' WHERE id=?", (art_id,))
            con.commit(); con.close()
            continue
        con = sqlite3.connect(str(cfg.sqlite_path))
        con.execute(
            "UPDATE ref_articles SET topics_core_json=?, topics_fine_json=?, "
            "ingest_status='topics_tagged', updated_at=datetime('now') WHERE id=?",
            (json.dumps(parsed["topics_core"], ensure_ascii=False),
             json.dumps(parsed["topics_fine"], ensure_ascii=False), art_id),
        )
        con.commit(); con.close()
        md_abs = cfg.vault_path / md_rel
        if md_abs.exists():
            _update_md_frontmatter(md_abs, parsed["topics_core"], parsed["topics_fine"])
        stats["ok"] += 1
    return stats

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--account", default=None)
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--since", default=None)
    ap.add_argument("--only-status", default="raw")
    args = ap.parse_args()
    cfg = load_config(Path(args.config))
    stats = run_tag(cfg, account=args.account, batch=args.batch,
                    since=args.since, only_status=args.only_status)
    print(stats)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
