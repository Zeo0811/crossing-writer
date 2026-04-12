from pathlib import Path
from datetime import datetime
from openpyxl import Workbook
from bulk_import.config import Config
from bulk_import.importer import run_import, ImportStats
from bulk_import.db import get_by_url
import sqlite3

SAMPLE_HTML = """<html><body><div id="js_content">
<p>这是一篇测试文章的正文。人工智能与 Claude Code 非常有意思。</p>
<p>继续滑动看下一个</p></div></body></html>"""

def _make_xlsx(p: Path, account: str, rows):
    wb = Workbook(); ws = wb.active
    ws.append(["公众号","文章标题","发布时间","位置","原创","文章链接","封面图片","作者","文章摘要"])
    for r in rows:
        ws.append(r)
    wb.save(p)

def _fake_sources(tmp_path: Path):
    xlsx_dir = tmp_path / "xlsx"; xlsx_dir.mkdir()
    html_dir_root = tmp_path / "html"
    account_html = html_dir_root / "测试号" / "html"; account_html.mkdir(parents=True)
    (account_html / "2025-05-30_标题一.html").write_text(SAMPLE_HTML, encoding="utf-8")
    _make_xlsx(xlsx_dir / "测试号.xlsx", "测试号", [
        ["测试号", "标题一", datetime(2025,5,30), 1, "是",
         "http://mp.weixin.qq.com/s?abc", "http://img", "作者A", "摘要"],
        ["测试号", "不存在的标题", datetime(2025,5,31), 1, "否",
         "http://mp.weixin.qq.com/s?xyz", None, None, None],
    ])
    return xlsx_dir, html_dir_root

def test_run_import_writes_md_and_db(tmp_path):
    xlsx_dir, html_dir = _fake_sources(tmp_path)
    vault = tmp_path / "vault"
    cfg = Config(vault_path=vault, sqlite_path=vault / ".index/refs.sqlite",
                 xlsx_dir=xlsx_dir, html_dir=html_dir,
                 default_cli="claude", fallback_cli="codex")
    stats = run_import(cfg)
    assert stats.succeeded == 1
    assert stats.missing_html == 1
    md_files = list((vault / "10_refs/测试号/2025").glob("*.md"))
    assert len(md_files) == 1
    content = md_files[0].read_text(encoding="utf-8")
    assert "---" in content
    assert "title: 标题一" in content or 'title: "标题一"' in content
    assert "人工智能" in content
    assert "继续滑动" not in content
    art = get_by_url(cfg.sqlite_path, "http://mp.weixin.qq.com/s?abc")
    assert art is not None
    assert art.account == "测试号"

def test_run_import_idempotent(tmp_path):
    xlsx_dir, html_dir = _fake_sources(tmp_path)
    vault = tmp_path / "vault"
    cfg = Config(vault_path=vault, sqlite_path=vault / ".index/refs.sqlite",
                 xlsx_dir=xlsx_dir, html_dir=html_dir,
                 default_cli="claude", fallback_cli="codex")
    run_import(cfg)
    stats2 = run_import(cfg)
    assert stats2.skipped >= 1
    assert stats2.succeeded == 0

def test_rebuild_from_vault(tmp_path):
    xlsx_dir, html_dir = _fake_sources(tmp_path)
    vault = tmp_path / "vault"
    cfg = Config(vault_path=vault, sqlite_path=vault / ".index/refs.sqlite",
                 xlsx_dir=xlsx_dir, html_dir=html_dir,
                 default_cli="claude", fallback_cli="codex")
    run_import(cfg)
    # delete sqlite
    cfg.sqlite_path.unlink()
    from bulk_import.importer import rebuild_from_vault
    stats = rebuild_from_vault(cfg)
    assert stats.succeeded == 1
    from bulk_import.db import get_by_url
    art = get_by_url(cfg.sqlite_path, "http://mp.weixin.qq.com/s?abc")
    assert art is not None
