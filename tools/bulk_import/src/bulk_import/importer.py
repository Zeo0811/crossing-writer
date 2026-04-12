from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from hashlib import sha1
import shutil
import json
import re
from typing import Optional
from tqdm import tqdm
from rich.console import Console

from .config import Config, load_config
from .db import init_db, upsert_article, get_by_url, log_issue, Article
from .extractor import extract, EmptyBodyError
from .matcher import iter_xlsx_rows, find_html, XlsxRow
from .sanitize import build_stem
from .segmenter import segment

console = Console()

@dataclass
class ImportStats:
    succeeded: int = 0
    skipped: int = 0
    missing_html: int = 0
    parse_error: int = 0
    empty_body: int = 0
    write_error: int = 0
    issues: list = field(default_factory=list)

def _hash_url(url: str) -> str:
    return sha1(url.encode("utf-8")).hexdigest()[:20]

def _hash_body(plain: str) -> str:
    return sha1(plain.encode("utf-8")).hexdigest()

def _frontmatter_yaml(art: Article) -> str:
    def esc(v):
        if v is None: return '""'
        s = str(v).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r')
        return f'"{s}"'
    lines = [
        "---",
        "type: ref_article",
        "source: wechat_mp",
        f"account: {esc(art.account)}",
        f"title: {esc(art.title)}",
        f"author: {esc(art.author) if art.author else 'null'}",
        f"published_at: {art.published_at}",
        f"is_original: {'true' if art.is_original else 'false'}",
        f"position: {art.position if art.position is not None else 'null'}",
        f"url: {esc(art.url)}",
        f"cover: {esc(art.cover) if art.cover else 'null'}",
        f"summary: {esc(art.summary) if art.summary else 'null'}",
        f"word_count: {art.word_count if art.word_count is not None else 'null'}",
        f"topics_core: {json.dumps(art.topics_core or [], ensure_ascii=False)}",
        f"topics_fine: {json.dumps(art.topics_fine or [], ensure_ascii=False)}",
        f"ingest_status: {art.ingest_status}",
        f"html_path: {esc(Path(art.html_path).name)}",
        "---",
        "",
    ]
    return "\n".join(lines)

def _process_row(row: XlsxRow, html_path: Path, cfg: Config) -> Article:
    html_text = html_path.read_text(encoding="utf-8", errors="ignore")
    result = extract(html_text)
    content_hash = _hash_body(result.plain_text)

    year = row.published_at[:4]
    out_dir = cfg.vault_path / "10_refs" / row.account / year
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = build_stem(row.published_at, row.title, row.url)
    md_file = out_dir / f"{stem}.md"
    html_file = out_dir / f"{stem}.html"

    art = Article(
        id=_hash_url(row.url), account=row.account, title=row.title,
        author=row.author, published_at=row.published_at,
        is_original=row.is_original, position=row.position, url=row.url,
        cover=row.cover, summary=row.summary, word_count=result.word_count,
        md_path=str(md_file.relative_to(cfg.vault_path)),
        html_path=str(html_file.relative_to(cfg.vault_path)),
        body_plain=result.plain_text, body_segmented=segment(result.plain_text),
        topics_core=None, topics_fine=None, ingest_status="raw",
        content_hash=content_hash,
    )

    md_file.write_text(_frontmatter_yaml(art) + result.markdown + "\n", encoding="utf-8")
    if not html_file.exists() or html_file.stat().st_size != html_path.stat().st_size:
        shutil.copy2(html_path, html_file)
    return art

def run_import(cfg: Config) -> ImportStats:
    init_db(cfg.sqlite_path)
    stats = ImportStats()
    xlsx_files = sorted(cfg.xlsx_dir.glob("*.xlsx"))
    console.print(f"[bold]Found {len(xlsx_files)} xlsx files[/]")

    for xlsx in xlsx_files:
        account = xlsx.stem
        html_dir = cfg.html_dir / account / "html"
        if not html_dir.exists():
            console.print(f"[yellow]Skip {account}: no html dir[/]")
            continue

        try:
            rows = list(iter_xlsx_rows(xlsx))
        except Exception as e:
            console.print(f"[red]Cannot read {xlsx.name}: {type(e).__name__}: {e}[/]")
            log_issue(cfg.sqlite_path, account=account, xlsx_row=None,
                      html_path=None, error_kind="XLSX_READ_ERROR",
                      message=f"{type(e).__name__}: {e}")
            continue
        for row in tqdm(rows, desc=account[:10], leave=False):
            existing = get_by_url(cfg.sqlite_path, row.url)
            if existing is not None:
                stats.skipped += 1
                continue
            html_path = find_html(html_dir, row)
            if html_path is None:
                log_issue(cfg.sqlite_path, account=row.account,
                          xlsx_row=row.xlsx_row_number, html_path=None,
                          error_kind="MISSING_HTML",
                          message=f"title={row.title!r}")
                stats.missing_html += 1
                continue
            try:
                art = _process_row(row, html_path, cfg)
            except EmptyBodyError as e:
                log_issue(cfg.sqlite_path, account=row.account,
                          xlsx_row=row.xlsx_row_number,
                          html_path=str(html_path), error_kind="EMPTY_BODY",
                          message=str(e))
                stats.empty_body += 1
                continue
            except OSError as e:
                log_issue(cfg.sqlite_path, account=row.account,
                          xlsx_row=row.xlsx_row_number,
                          html_path=str(html_path), error_kind="WRITE_ERROR",
                          message=f"{type(e).__name__}: {e}")
                stats.write_error += 1
                continue
            except Exception as e:
                log_issue(cfg.sqlite_path, account=row.account,
                          xlsx_row=row.xlsx_row_number,
                          html_path=str(html_path), error_kind="PARSE_ERROR",
                          message=f"{type(e).__name__}: {e}")
                stats.parse_error += 1
                continue
            try:
                upsert_article(cfg.sqlite_path, art)
            except Exception as e:
                log_issue(cfg.sqlite_path, account=row.account,
                          xlsx_row=row.xlsx_row_number,
                          html_path=str(html_path), error_kind="WRITE_ERROR",
                          message=f"{type(e).__name__}: {e}")
                stats.write_error += 1
                continue
            stats.succeeded += 1

    console.print(f"[green]succeeded={stats.succeeded}[/] "
                  f"[cyan]skipped={stats.skipped}[/] "
                  f"[yellow]missing_html={stats.missing_html}[/] "
                  f"[red]empty={stats.empty_body} parse={stats.parse_error} "
                  f"write={stats.write_error}[/]")
    return stats

def _parse_frontmatter(md_text: str) -> tuple[dict, str]:
    if not md_text.startswith("---"):
        return {}, md_text
    end = md_text.find("\n---", 3)
    if end < 0:
        return {}, md_text
    fm = md_text[3:end].strip()
    body = md_text[end+4:].lstrip("\n")
    data = {}
    for line in fm.splitlines():
        if ":" not in line: continue
        k, _, v = line.partition(":")
        v = v.strip()
        if v.startswith('"') and v.endswith('"'):
            # unescape our escape sequences: \\, \", \n, \r
            v = v[1:-1].replace('\\n', '\n').replace('\\r', '\r').replace('\\"', '"').replace('\\\\', '\\')
        elif v == "null":
            v = None
        elif v in ("true","false"):
            v = v == "true"
        elif v.startswith("[") and v.endswith("]"):
            try:
                v = json.loads(v)
            except Exception:
                pass
        data[k.strip()] = v
    return data, body

def rebuild_from_vault(cfg: Config) -> ImportStats:
    init_db(cfg.sqlite_path)
    stats = ImportStats()
    refs_dir = cfg.vault_path / "10_refs"
    if not refs_dir.exists():
        return stats
    for md_file in refs_dir.rglob("*.md"):
        try:
            text = md_file.read_text(encoding="utf-8")
            fm, body = _parse_frontmatter(text)
            if fm.get("type") != "ref_article":
                continue
            # strip common markdown markers to approximate plain text
            plain = re.sub(r"[#*>`\[\]()!]", "", body)
            plain = re.sub(r"\s+", " ", plain).strip()
            pos_val = fm.get("position")
            position = int(pos_val) if pos_val not in (None, "null") else None
            wc_val = fm.get("word_count")
            word_count = int(wc_val) if wc_val not in (None, "null") else None
            art = Article(
                id=_hash_url(fm["url"]),
                account=fm["account"],
                title=fm["title"],
                author=fm.get("author"),
                published_at=fm["published_at"],
                is_original=bool(fm.get("is_original")),
                position=position,
                url=fm["url"],
                cover=fm.get("cover"),
                summary=fm.get("summary"),
                word_count=word_count,
                md_path=str(md_file.relative_to(cfg.vault_path)),
                html_path=str(md_file.with_suffix(".html").relative_to(cfg.vault_path)),
                body_plain=plain,
                body_segmented=segment(plain),
                topics_core=fm.get("topics_core") or None,
                topics_fine=fm.get("topics_fine") or None,
                ingest_status=fm.get("ingest_status", "raw"),
                content_hash=_hash_body(plain),
            )
            upsert_article(cfg.sqlite_path, art)
            stats.succeeded += 1
        except Exception as e:
            log_issue(cfg.sqlite_path, account=None, xlsx_row=None,
                      html_path=str(md_file), error_kind="WRITE_ERROR",
                      message=f"{type(e).__name__}: {e}")
            stats.write_error += 1
    return stats

def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--rebuild-from-vault", action="store_true",
                    help="Rebuild SQLite from existing vault md files (skip xlsx/html)")
    args = ap.parse_args()
    cfg = load_config(Path(args.config))
    if args.rebuild_from_vault:
        stats = rebuild_from_vault(cfg)
    else:
        stats = run_import(cfg)
    return 0 if (stats.parse_error == 0 and stats.write_error == 0) else 1

if __name__ == "__main__":
    raise SystemExit(main())
