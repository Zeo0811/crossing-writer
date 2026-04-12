import sqlite3
from bulk_import.db import init_db, upsert_article, get_by_url, log_issue, Article

def test_init_db_creates_tables(tmp_sqlite):
    init_db(tmp_sqlite)
    con = sqlite3.connect(tmp_sqlite)
    tables = {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','index')"
    )}
    assert "ref_articles" in tables
    assert "ref_articles_fts" in tables
    assert "ingest_issues" in tables
    assert "idx_refs_account" in tables

def test_upsert_and_fetch(tmp_sqlite):
    init_db(tmp_sqlite)
    art = Article(
        id="abc123", account="智东西", title="标题",
        author="江宇", published_at="2025-05-30",
        is_original=True, position=1,
        url="http://x.com/a", cover=None, summary="摘要",
        word_count=100, md_path="智东西/2025/x.md", html_path="智东西/2025/x.html",
        body_plain="正文正文", body_segmented="正文 正文",
        topics_core=None, topics_fine=None, ingest_status="raw",
        content_hash="h1",
    )
    upsert_article(tmp_sqlite, art)
    got = get_by_url(tmp_sqlite, "http://x.com/a")
    assert got is not None
    assert got.title == "标题"
    assert got.account == "智东西"

def test_upsert_is_idempotent(tmp_sqlite):
    init_db(tmp_sqlite)
    art = Article(
        id="abc", account="a", title="t", author=None, published_at="2025-01-01",
        is_original=False, position=None, url="http://y.com/a", cover=None,
        summary=None, word_count=None, md_path="p.md", html_path="p.html",
        body_plain="b", body_segmented="b", topics_core=None, topics_fine=None,
        ingest_status="raw", content_hash="h",
    )
    upsert_article(tmp_sqlite, art)
    upsert_article(tmp_sqlite, art)
    con = sqlite3.connect(tmp_sqlite)
    cnt = con.execute("SELECT COUNT(*) FROM ref_articles").fetchone()[0]
    assert cnt == 1

def test_log_issue(tmp_sqlite):
    init_db(tmp_sqlite)
    log_issue(tmp_sqlite, account="a", xlsx_row=5, html_path=None,
              error_kind="MISSING_HTML", message="no file")
    con = sqlite3.connect(tmp_sqlite)
    rows = list(con.execute("SELECT account, error_kind FROM ingest_issues"))
    assert rows == [("a", "MISSING_HTML")]

def test_fts_query(tmp_sqlite):
    init_db(tmp_sqlite)
    art = Article(
        id="i1", account="量子位", title="Claude Code 实测",
        author=None, published_at="2025-06-01", is_original=True,
        position=1, url="http://q.com/1", cover=None, summary="摘要",
        word_count=100, md_path="x", html_path="x",
        body_plain="claude code 非常强", body_segmented="claude code 非常 强",
        topics_core=None, topics_fine=None, ingest_status="raw", content_hash="h",
    )
    upsert_article(tmp_sqlite, art)
    con = sqlite3.connect(tmp_sqlite)
    hits = list(con.execute(
        "SELECT a.title FROM ref_articles_fts f "
        "JOIN ref_articles a ON a.rowid = f.rowid "
        "WHERE ref_articles_fts MATCH 'claude'"
    ))
    assert len(hits) == 1
