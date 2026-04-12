# Vault & Bulk Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 60 家公众号历史文章（xlsx + html）结构化导入 `~/CrossingVault/`，建立 SQLite + FTS5 索引，产出 Node.js `searchRefs` 接口，供后续 Agent 消费。

**Architecture:** Python 一次性导入器（bulk_import 包）负责 xlsx 解析、html→md 抽取、SQLite 写入；Node.js `packages/kb` 薄封装提供检索 API 与 CLI 镜像；Phase 2 打标命令以独立子命令形式存在，通过子进程调用 `claude -p` 订阅模型。

**Tech Stack:** Python 3.11+（openpyxl, beautifulsoup4, markdownify, jieba, tqdm, rich, pytest），Node.js 20+（TypeScript, better-sqlite3, commander, vitest），SQLite FTS5。

Spec: `docs/superpowers/specs/2026-04-12-vault-and-importer-design.md`

---

## 目录结构（实施前先建）

```
crossing-writer/
  config.json                          # Task 1
  tools/bulk_import/                   # Python 包
    pyproject.toml                     # Task 2
    src/bulk_import/
      __init__.py
      __main__.py
      config.py                        # Task 2
      db.py                            # Task 3
      sanitize.py                      # Task 4
      extractor.py                     # Task 5
      matcher.py                       # Task 6
      segmenter.py                     # Task 7
      importer.py                      # Task 8
      tag.py                           # Task 15
      claude_cli.py                    # Task 15
    tests/
      conftest.py                      # Task 3
      fixtures/
        sample.html                    # Task 5
        sample.xlsx                    # Task 6
      test_db.py                       # Task 3
      test_sanitize.py                 # Task 4
      test_extractor.py                # Task 5
      test_matcher.py                  # Task 6
      test_segmenter.py                # Task 7
      test_importer.py                 # Task 8
      test_tag.py                      # Task 15
  packages/kb/                         # Node.js 包
    package.json                       # Task 12
    tsconfig.json                      # Task 12
    src/
      index.ts                         # Task 13
      search.ts                        # Task 13
      db.ts                            # Task 12
      types.ts                         # Task 12
      cli.ts                           # Task 14
    tests/
      search.test.ts                   # Task 13
      cli.test.ts                      # Task 14
    bin/
      crossing-kb                      # Task 14
```

---

### Task 1: Bootstrap config + vault skeleton

**Files:**
- Create: `config.json`
- Create: `~/CrossingVault/10_refs/.gitkeep`
- Create: `~/CrossingVault/.index/.gitkeep`
- Create: `~/CrossingVault/01_brands/.gitkeep` (+ 02_products, 05_research, 06_cases, 07_projects, 09_assets)
- Modify: `.gitignore`

- [ ] **Step 1: Write config.json**

```json
{
  "vaultPath": "~/CrossingVault",
  "sqlitePath": "~/CrossingVault/.index/refs.sqlite",
  "importSources": {
    "xlsxDir": "/Users/zeoooo/Downloads/60-表格",
    "htmlDir": "/Users/zeoooo/Downloads/60-html"
  },
  "modelAdapter": {
    "defaultCli": "claude",
    "fallbackCli": "codex"
  }
}
```

- [ ] **Step 2: Create vault skeleton**

```bash
VAULT="$HOME/CrossingVault"
mkdir -p "$VAULT/10_refs" "$VAULT/.index" \
  "$VAULT/01_brands" "$VAULT/02_products" \
  "$VAULT/05_research" "$VAULT/06_cases" \
  "$VAULT/07_projects" "$VAULT/09_assets"
touch "$VAULT/10_refs/.gitkeep" "$VAULT/.index/.gitkeep"
```

- [ ] **Step 3: Update .gitignore**

Append to `.gitignore`:

```
# vault 不进 git
CrossingVault/
~/CrossingVault
# python 产物
tools/bulk_import/.venv/
tools/bulk_import/**/__pycache__/
tools/bulk_import/**/*.egg-info/
tools/bulk_import/.pytest_cache/
# node 产物
packages/*/node_modules/
packages/*/dist/
```

- [ ] **Step 4: Verify**

```bash
ls -la ~/CrossingVault/
cat config.json | python3 -c "import json,sys; print(json.load(sys.stdin))"
```

Expected: 目录全部存在；config.json 能被解析。

- [ ] **Step 5: Commit**

```bash
git add config.json .gitignore
git -c commit.gpgsign=false commit -m "feat: add config.json and vault scaffold for SP-01"
```

---

### Task 2: Python package skeleton + config loader

**Files:**
- Create: `tools/bulk_import/pyproject.toml`
- Create: `tools/bulk_import/src/bulk_import/__init__.py`
- Create: `tools/bulk_import/src/bulk_import/__main__.py`
- Create: `tools/bulk_import/src/bulk_import/config.py`
- Create: `tools/bulk_import/tests/__init__.py`
- Create: `tools/bulk_import/tests/test_config.py`

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "bulk_import"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "openpyxl>=3.1",
  "beautifulsoup4>=4.12",
  "markdownify>=0.11",
  "jieba>=0.42",
  "tqdm>=4.66",
  "rich>=13.7",
  "lxml>=5.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=5.0"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: Create venv and install**

```bash
cd tools/bulk_import
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

Expected: 安装成功，无 error。

- [ ] **Step 3: Write failing test for config loader**

`tools/bulk_import/tests/test_config.py`:

```python
from pathlib import Path
import json
from bulk_import.config import load_config

def test_load_config_expands_tilde(tmp_path):
    cfg_file = tmp_path / "config.json"
    cfg_file.write_text(json.dumps({
        "vaultPath": "~/CrossingVault",
        "sqlitePath": "~/CrossingVault/.index/refs.sqlite",
        "importSources": {"xlsxDir": "/tmp/x", "htmlDir": "/tmp/h"},
        "modelAdapter": {"defaultCli": "claude", "fallbackCli": "codex"}
    }))
    cfg = load_config(cfg_file)
    assert cfg.vault_path == Path.home() / "CrossingVault"
    assert cfg.sqlite_path == Path.home() / "CrossingVault/.index/refs.sqlite"
    assert cfg.xlsx_dir == Path("/tmp/x")
    assert cfg.html_dir == Path("/tmp/h")
    assert cfg.default_cli == "claude"
```

- [ ] **Step 4: Run test, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_config.py -v
```

Expected: ImportError for `bulk_import.config`.

- [ ] **Step 5: Implement config.py**

`tools/bulk_import/src/bulk_import/config.py`:

```python
from dataclasses import dataclass
from pathlib import Path
import json

@dataclass(frozen=True)
class Config:
    vault_path: Path
    sqlite_path: Path
    xlsx_dir: Path
    html_dir: Path
    default_cli: str
    fallback_cli: str

def _expand(p: str) -> Path:
    return Path(p).expanduser()

def load_config(path: Path) -> Config:
    data = json.loads(Path(path).read_text())
    return Config(
        vault_path=_expand(data["vaultPath"]),
        sqlite_path=_expand(data["sqlitePath"]),
        xlsx_dir=_expand(data["importSources"]["xlsxDir"]),
        html_dir=_expand(data["importSources"]["htmlDir"]),
        default_cli=data["modelAdapter"]["defaultCli"],
        fallback_cli=data["modelAdapter"]["fallbackCli"],
    )
```

`tools/bulk_import/src/bulk_import/__init__.py`:

```python
from .config import Config, load_config

__all__ = ["Config", "load_config"]
```

`tools/bulk_import/src/bulk_import/__main__.py`:

```python
import sys

def main() -> int:
    print("bulk_import: use `python -m bulk_import.importer` or `python -m bulk_import.tag`")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

`tools/bulk_import/tests/__init__.py`: empty file.

- [ ] **Step 6: Run test, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_config.py -v
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add tools/bulk_import/
git -c commit.gpgsign=false commit -m "feat(import): python package skeleton + config loader"
```

---

### Task 3: SQLite schema + init/upsert

**Files:**
- Create: `tools/bulk_import/src/bulk_import/db.py`
- Create: `tools/bulk_import/tests/test_db.py`
- Create: `tools/bulk_import/tests/conftest.py`

- [ ] **Step 1: Write conftest.py with tmp sqlite fixture**

`tools/bulk_import/tests/conftest.py`:

```python
import pytest
from pathlib import Path

@pytest.fixture
def tmp_sqlite(tmp_path) -> Path:
    return tmp_path / "refs.sqlite"
```

- [ ] **Step 2: Write failing test for schema init**

`tools/bulk_import/tests/test_db.py`:

```python
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
```

- [ ] **Step 3: Run test, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_db.py -v
```

Expected: ImportError for `bulk_import.db`.

- [ ] **Step 4: Implement db.py**

`tools/bulk_import/src/bulk_import/db.py`:

```python
from __future__ import annotations
import sqlite3
from dataclasses import dataclass, asdict
from pathlib import Path
from datetime import datetime, timezone
import json
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS ref_articles (
  id               TEXT PRIMARY KEY,
  account          TEXT NOT NULL,
  title            TEXT NOT NULL,
  author           TEXT,
  published_at     TEXT NOT NULL,
  is_original      INTEGER NOT NULL DEFAULT 0,
  position         INTEGER,
  url              TEXT NOT NULL UNIQUE,
  cover            TEXT,
  summary          TEXT,
  word_count       INTEGER,
  md_path          TEXT NOT NULL,
  html_path        TEXT NOT NULL,
  body_plain       TEXT,
  body_segmented   TEXT,
  topics_core_json TEXT,
  topics_fine_json TEXT,
  ingest_status    TEXT NOT NULL DEFAULT 'raw',
  content_hash     TEXT,
  imported_at      TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refs_account       ON ref_articles(account);
CREATE INDEX IF NOT EXISTS idx_refs_published_at  ON ref_articles(published_at);
CREATE INDEX IF NOT EXISTS idx_refs_ingest_status ON ref_articles(ingest_status);

CREATE VIRTUAL TABLE IF NOT EXISTS ref_articles_fts USING fts5(
  title, summary, body_segmented,
  content='ref_articles',
  content_rowid='rowid',
  tokenize='simple'
);

CREATE TRIGGER IF NOT EXISTS ref_articles_ai AFTER INSERT ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(rowid, title, summary, body_segmented)
  VALUES (new.rowid, new.title, new.summary, new.body_segmented);
END;
CREATE TRIGGER IF NOT EXISTS ref_articles_ad AFTER DELETE ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(ref_articles_fts, rowid, title, summary, body_segmented)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body_segmented);
END;
CREATE TRIGGER IF NOT EXISTS ref_articles_au AFTER UPDATE ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(ref_articles_fts, rowid, title, summary, body_segmented)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body_segmented);
  INSERT INTO ref_articles_fts(rowid, title, summary, body_segmented)
  VALUES (new.rowid, new.title, new.summary, new.body_segmented);
END;

CREATE TABLE IF NOT EXISTS ingest_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account    TEXT,
  xlsx_row   INTEGER,
  html_path  TEXT,
  error_kind TEXT NOT NULL,
  message    TEXT,
  created_at TEXT NOT NULL
);
"""

@dataclass
class Article:
    id: str
    account: str
    title: str
    author: Optional[str]
    published_at: str
    is_original: bool
    position: Optional[int]
    url: str
    cover: Optional[str]
    summary: Optional[str]
    word_count: Optional[int]
    md_path: str
    html_path: str
    body_plain: str
    body_segmented: str
    topics_core: Optional[list]
    topics_fine: Optional[list]
    ingest_status: str
    content_hash: str

def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con

def init_db(path: Path) -> None:
    con = _connect(path)
    try:
        con.executescript(SCHEMA)
        con.commit()
    finally:
        con.close()

def upsert_article(path: Path, art: Article) -> None:
    con = _connect(path)
    try:
        now = _now()
        con.execute(
            """
            INSERT INTO ref_articles (
              id, account, title, author, published_at, is_original, position,
              url, cover, summary, word_count, md_path, html_path,
              body_plain, body_segmented, topics_core_json, topics_fine_json,
              ingest_status, content_hash, imported_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
              title=excluded.title, author=excluded.author,
              published_at=excluded.published_at, is_original=excluded.is_original,
              position=excluded.position, cover=excluded.cover, summary=excluded.summary,
              word_count=excluded.word_count, md_path=excluded.md_path,
              html_path=excluded.html_path, body_plain=excluded.body_plain,
              body_segmented=excluded.body_segmented,
              topics_core_json=excluded.topics_core_json,
              topics_fine_json=excluded.topics_fine_json,
              ingest_status=excluded.ingest_status, content_hash=excluded.content_hash,
              updated_at=excluded.updated_at
            """,
            (
                art.id, art.account, art.title, art.author, art.published_at,
                1 if art.is_original else 0, art.position, art.url, art.cover,
                art.summary, art.word_count, art.md_path, art.html_path,
                art.body_plain, art.body_segmented,
                json.dumps(art.topics_core, ensure_ascii=False) if art.topics_core is not None else None,
                json.dumps(art.topics_fine, ensure_ascii=False) if art.topics_fine is not None else None,
                art.ingest_status, art.content_hash, now, now,
            ),
        )
        con.commit()
    finally:
        con.close()

def get_by_url(path: Path, url: str) -> Optional[Article]:
    con = _connect(path)
    try:
        row = con.execute(
            "SELECT id,account,title,author,published_at,is_original,position,"
            "url,cover,summary,word_count,md_path,html_path,body_plain,"
            "body_segmented,topics_core_json,topics_fine_json,ingest_status,"
            "content_hash FROM ref_articles WHERE url=?", (url,)
        ).fetchone()
        if not row:
            return None
        return Article(
            id=row[0], account=row[1], title=row[2], author=row[3],
            published_at=row[4], is_original=bool(row[5]), position=row[6],
            url=row[7], cover=row[8], summary=row[9], word_count=row[10],
            md_path=row[11], html_path=row[12], body_plain=row[13],
            body_segmented=row[14],
            topics_core=json.loads(row[15]) if row[15] else None,
            topics_fine=json.loads(row[16]) if row[16] else None,
            ingest_status=row[17], content_hash=row[18],
        )
    finally:
        con.close()

def log_issue(path: Path, *, account: Optional[str], xlsx_row: Optional[int],
              html_path: Optional[str], error_kind: str, message: str) -> None:
    con = _connect(path)
    try:
        con.execute(
            "INSERT INTO ingest_issues (account, xlsx_row, html_path, error_kind, message, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (account, xlsx_row, html_path, error_kind, message, _now()),
        )
        con.commit()
    finally:
        con.close()
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_db.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add tools/bulk_import/src/bulk_import/db.py \
        tools/bulk_import/tests/conftest.py \
        tools/bulk_import/tests/test_db.py
git -c commit.gpgsign=false commit -m "feat(import): sqlite schema + upsert + fts5 triggers"
```

---

### Task 4: Filename sanitizer

**Files:**
- Create: `tools/bulk_import/src/bulk_import/sanitize.py`
- Create: `tools/bulk_import/tests/test_sanitize.py`

- [ ] **Step 1: Write failing tests**

`tools/bulk_import/tests/test_sanitize.py`:

```python
from bulk_import.sanitize import sanitize_filename, build_stem

def test_replaces_forbidden_chars():
    assert sanitize_filename('A/B\\C:D*E?F"G<H>I|J') == "A-B-C-D-E-F-G-H-I-J"

def test_folds_whitespace():
    assert sanitize_filename("hello   world\t tab") == "hello-world-tab"

def test_strips_trailing_dot():
    assert sanitize_filename("title.") == "title"
    assert sanitize_filename("title..") == "title"

def test_truncates_long_with_url_suffix():
    long = "长" * 200
    url = "http://mp.weixin.qq.com/s?__biz=abc&mid=12345&sn=abcdef0123456789"
    stem = build_stem("2025-05-30", long, url)
    assert len(stem.encode("utf-8")) <= 140
    assert stem.startswith("2025-05-30_")
    assert stem.endswith(url[-8:])

def test_short_stem_no_suffix():
    url = "http://x.com/a" * 3
    stem = build_stem("2025-05-30", "短标题", url)
    assert stem == "2025-05-30_短标题"

def test_preserves_chinese():
    assert sanitize_filename("AI产品黄叔的文章") == "AI产品黄叔的文章"
```

- [ ] **Step 2: Run tests, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_sanitize.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement sanitize.py**

```python
from __future__ import annotations
import re

_FORBIDDEN = re.compile(r'[/\\:*?"<>|]')
_WHITESPACE = re.compile(r"\s+")
MAX_STEM_BYTES = 140   # leave room for .md / .html suffix

def sanitize_filename(s: str) -> str:
    s = _FORBIDDEN.sub("-", s)
    s = _WHITESPACE.sub("-", s).strip("-")
    s = s.rstrip(".")
    return s

def _truncate_bytes(s: str, limit: int) -> str:
    b = s.encode("utf-8")
    if len(b) <= limit:
        return s
    while len(s.encode("utf-8")) > limit:
        s = s[:-1]
    return s

def build_stem(date: str, title: str, url: str) -> str:
    base = f"{date}_{sanitize_filename(title)}"
    if len(base.encode("utf-8")) <= MAX_STEM_BYTES:
        return base
    suffix = "_" + url[-8:]
    room = MAX_STEM_BYTES - len(suffix.encode("utf-8"))
    return _truncate_bytes(base, room) + suffix
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_sanitize.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/bulk_import/src/bulk_import/sanitize.py \
        tools/bulk_import/tests/test_sanitize.py
git -c commit.gpgsign=false commit -m "feat(import): filename sanitizer + stem builder"
```

---

### Task 5: HTML → Markdown extractor

**Files:**
- Create: `tools/bulk_import/src/bulk_import/extractor.py`
- Create: `tools/bulk_import/tests/fixtures/sample.html`
- Create: `tools/bulk_import/tests/test_extractor.py`

- [ ] **Step 1: Copy a real sample as fixture**

```bash
cp "/Users/zeoooo/Downloads/60-html/智东西/html/2025-05-30_600亿AI算力龙头，冲刺港交所！.html" \
   tools/bulk_import/tests/fixtures/sample.html
```

- [ ] **Step 2: Write failing tests**

`tools/bulk_import/tests/test_extractor.py`:

```python
from pathlib import Path
from bulk_import.extractor import extract

FIXTURE = Path(__file__).parent / "fixtures" / "sample.html"

def test_extract_returns_markdown_and_plain():
    res = extract(FIXTURE.read_text(encoding="utf-8"))
    assert res.markdown
    assert res.plain_text
    assert len(res.plain_text) > 200

def test_extract_strips_boilerplate():
    res = extract(FIXTURE.read_text(encoding="utf-8"))
    assert "预览时标签" not in res.markdown
    assert "继续滑动看下一个" not in res.markdown
    assert "阅读原文" not in res.markdown

def test_extract_preserves_image_urls():
    res = extract(FIXTURE.read_text(encoding="utf-8"))
    # 至少一张图片链接被保留
    assert "mmbiz.qpic.cn" in res.markdown or "http" in res.markdown

def test_extract_word_count():
    res = extract(FIXTURE.read_text(encoding="utf-8"))
    assert res.word_count > 100

def test_extract_empty_body_raises():
    import pytest
    from bulk_import.extractor import EmptyBodyError
    with pytest.raises(EmptyBodyError):
        extract("<html><body></body></html>")
```

- [ ] **Step 3: Run tests, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_extractor.py -v
```

Expected: ImportError.

- [ ] **Step 4: Implement extractor.py**

```python
from __future__ import annotations
from dataclasses import dataclass
from bs4 import BeautifulSoup
import markdownify
import re

BOILERPLATE_SELECTORS = [
    "#js_article_meta + *",          # placeholder; actual boilerplate handled by text match
]

BOILERPLATE_TEXT_PATTERNS = [
    "预览时标签不可点", "继续滑动看下一个", "轻触阅读原文",
    "知道了", "向上滑动看下一个", "阅读原文",
    "微信扫一扫", "赞赏作者", "在看", "分享",
]

REMOVE_TAGS = ["script", "style", "noscript", "iframe", "svg"]

class EmptyBodyError(Exception):
    pass

@dataclass
class ExtractResult:
    markdown: str
    plain_text: str
    word_count: int

def _find_content_root(soup: BeautifulSoup):
    for sel in ["#js_content", ".rich_media_content", "#page-content", "article"]:
        node = soup.select_one(sel)
        if node:
            return node
    return soup.body or soup

def _strip(node):
    for t in REMOVE_TAGS:
        for el in node.find_all(t):
            el.decompose()
    for el in list(node.find_all(string=True)):
        txt = (el.string or "").strip()
        for pat in BOILERPLATE_TEXT_PATTERNS:
            if pat and pat in txt:
                parent = el.parent
                if parent is not None:
                    parent.decompose()
                break

def _promote_data_src(node):
    for img in node.find_all("img"):
        src = img.get("data-src") or img.get("src")
        if src:
            img["src"] = src
            # strip lazy attrs
            for attr in list(img.attrs):
                if attr.startswith("data-"):
                    del img[attr]

def extract(html: str) -> ExtractResult:
    soup = BeautifulSoup(html, "lxml")
    root = _find_content_root(soup)
    _strip(root)
    _promote_data_src(root)
    md = markdownify.markdownify(str(root), heading_style="ATX", bullets="-")
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    plain = re.sub(r"\s+", " ", root.get_text(" ", strip=True)).strip()
    if not plain:
        raise EmptyBodyError("content root is empty after boilerplate removal")
    wc = len(plain)  # Chinese char count ≈ word count proxy
    return ExtractResult(markdown=md, plain_text=plain, word_count=wc)
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_extractor.py -v
```

Expected: 5 passed. If any fails due to new boilerplate in the real fixture, add the pattern to `BOILERPLATE_TEXT_PATTERNS` and re-run until green.

- [ ] **Step 6: Commit**

```bash
git add tools/bulk_import/src/bulk_import/extractor.py \
        tools/bulk_import/tests/fixtures/sample.html \
        tools/bulk_import/tests/test_extractor.py
git -c commit.gpgsign=false commit -m "feat(import): html→md extractor with boilerplate stripping"
```

---

### Task 6: xlsx row ↔ html file matcher

**Files:**
- Create: `tools/bulk_import/src/bulk_import/matcher.py`
- Create: `tools/bulk_import/tests/test_matcher.py`

- [ ] **Step 1: Write failing tests**

`tools/bulk_import/tests/test_matcher.py`:

```python
from pathlib import Path
from datetime import datetime
from bulk_import.matcher import iter_xlsx_rows, find_html, XlsxRow

def test_iter_rows_parses_fields(tmp_path):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    ws.append(["公众号","文章标题","发布时间","位置","原创","文章链接","封面图片","作者","文章摘要"])
    ws.append(["智东西","标题一", datetime(2025,5,30,20,53), 1, "是",
               "http://mp.weixin.qq.com/s?abc","http://img","作者A","摘要"])
    p = tmp_path / "a.xlsx"; wb.save(p)
    rows = list(iter_xlsx_rows(p))
    assert len(rows) == 1
    r = rows[0]
    assert r.account == "智东西"
    assert r.title == "标题一"
    assert r.published_at == "2025-05-30"
    assert r.is_original is True
    assert r.position == 1
    assert r.author == "作者A"

def test_find_html_exact(tmp_path):
    d = tmp_path / "html"
    d.mkdir()
    target = d / "2025-05-30_测试标题.html"
    target.write_text("x")
    row = XlsxRow(account="a", title="测试标题", published_at="2025-05-30",
                  is_original=False, position=None, url="u", cover=None,
                  author=None, summary=None, xlsx_row_number=2)
    hit = find_html(d, row)
    assert hit == target

def test_find_html_fuzzy_date_match(tmp_path):
    d = tmp_path / "html"; d.mkdir()
    (d / "2025-05-30_测试标题-略有差异.html").write_text("x")
    row = XlsxRow(account="a", title="测试标题略有差异!", published_at="2025-05-30",
                  is_original=False, position=None, url="u", cover=None,
                  author=None, summary=None, xlsx_row_number=2)
    hit = find_html(d, row)
    assert hit is not None
    assert "2025-05-30" in hit.name

def test_find_html_missing_returns_none(tmp_path):
    d = tmp_path / "html"; d.mkdir()
    row = XlsxRow(account="a", title="不存在", published_at="2025-01-01",
                  is_original=False, position=None, url="u", cover=None,
                  author=None, summary=None, xlsx_row_number=2)
    assert find_html(d, row) is None
```

- [ ] **Step 2: Run tests, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_matcher.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement matcher.py**

```python
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional
from datetime import datetime, date
from openpyxl import load_workbook
from .sanitize import sanitize_filename

@dataclass
class XlsxRow:
    account: str
    title: str
    published_at: str
    is_original: bool
    position: Optional[int]
    url: str
    cover: Optional[str]
    author: Optional[str]
    summary: Optional[str]
    xlsx_row_number: int

def _to_date_str(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    # fallback parse YYYY-MM-DD prefix
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None

def iter_xlsx_rows(xlsx_path: Path) -> Iterator[XlsxRow]:
    wb = load_workbook(str(xlsx_path), read_only=True, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = next(rows, None)
    if not header:
        return
    for idx, row in enumerate(rows, start=2):
        row = list(row) + [None] * (9 - len(row))
        account, title, pub, pos, orig, url, cover, author, summary = row[:9]
        if not title or not url:
            continue
        date_str = _to_date_str(pub)
        if not date_str:
            continue
        yield XlsxRow(
            account=str(account).strip() if account else "",
            title=str(title).strip(),
            published_at=date_str,
            is_original=(str(orig).strip() == "是") if orig else False,
            position=int(pos) if pos is not None and str(pos).strip().isdigit() else None,
            url=str(url).strip(),
            cover=str(cover).strip() if cover else None,
            author=str(author).strip().replace("&nbsp;", " ") if author else None,
            summary=str(summary).strip() if summary else None,
            xlsx_row_number=idx,
        )

def _levenshtein(a: str, b: str) -> int:
    if a == b: return 0
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(
                curr[-1] + 1,
                prev[j] + 1,
                prev[j-1] + (0 if ca == cb else 1)
            ))
        prev = curr
    return prev[-1]

def find_html(html_dir: Path, row: XlsxRow) -> Optional[Path]:
    expected_stem = f"{row.published_at}_{sanitize_filename(row.title)}"
    exact = html_dir / f"{expected_stem}.html"
    if exact.exists():
        return exact
    # fuzzy: scan same-date files
    prefix = f"{row.published_at}_"
    candidates = [p for p in html_dir.glob(f"{prefix}*.html")]
    if not candidates:
        return None
    san_title = sanitize_filename(row.title)
    best = None
    best_d = 10**9
    for c in candidates:
        stem_title = c.stem[len(prefix):]
        d = _levenshtein(san_title, stem_title)
        if d < best_d:
            best_d = d; best = c
    if best is not None and best_d <= 5:
        return best
    return None
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_matcher.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/bulk_import/src/bulk_import/matcher.py \
        tools/bulk_import/tests/test_matcher.py
git -c commit.gpgsign=false commit -m "feat(import): xlsx row iterator + html fuzzy matcher"
```

---

### Task 7: Jieba segmenter wrapper

**Files:**
- Create: `tools/bulk_import/src/bulk_import/segmenter.py`
- Create: `tools/bulk_import/tests/test_segmenter.py`

- [ ] **Step 1: Write failing tests**

```python
from bulk_import.segmenter import segment

def test_segments_chinese():
    s = segment("这是一个人工智能测评")
    tokens = s.split()
    assert len(tokens) >= 3
    assert "人工智能" in tokens or "人工" in tokens

def test_segments_preserves_ascii():
    s = segment("claude code 实测")
    assert "claude" in s.lower()
    assert "code" in s.lower()

def test_segments_empty_returns_empty():
    assert segment("") == ""
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_segmenter.py -v
```

- [ ] **Step 3: Implement segmenter.py**

```python
from __future__ import annotations
import jieba
import re

# warm up
jieba.initialize()

_WS = re.compile(r"\s+")

def segment(text: str) -> str:
    if not text:
        return ""
    tokens = [t for t in jieba.cut(text, cut_all=False) if t.strip()]
    return _WS.sub(" ", " ".join(tokens)).strip()
```

- [ ] **Step 4: Run, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_segmenter.py -v
```

- [ ] **Step 5: Commit**

```bash
git add tools/bulk_import/src/bulk_import/segmenter.py \
        tools/bulk_import/tests/test_segmenter.py
git -c commit.gpgsign=false commit -m "feat(import): jieba segmenter wrapper"
```

---

### Task 8: Importer main loop

**Files:**
- Create: `tools/bulk_import/src/bulk_import/importer.py`
- Create: `tools/bulk_import/tests/test_importer.py`

- [ ] **Step 1: Write failing integration test**

```python
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
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_importer.py -v
```

- [ ] **Step 3: Implement importer.py**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from hashlib import sha1
import shutil
import json
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
        s = str(v).replace('"', '\\"')
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

    # paths
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

        rows = list(iter_xlsx_rows(xlsx))
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

def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    args = ap.parse_args()
    cfg = load_config(Path(args.config))
    run_import(cfg)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_importer.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/bulk_import/src/bulk_import/importer.py \
        tools/bulk_import/tests/test_importer.py
git -c commit.gpgsign=false commit -m "feat(import): importer main loop + idempotent upsert"
```

---

### Task 9: Smoke-test single account (AGI Hunt)

**Files:**
- Modify: none (runtime check only)

- [ ] **Step 1: Dry-run on smallest account**

```bash
cd /Users/zeoooo/crossing-writer
ls "/Users/zeoooo/Downloads/60-html/AGI Hunt/html" | wc -l
ls "/Users/zeoooo/Downloads/60-表格/AGI Hunt.xlsx"
```

- [ ] **Step 2: Temporarily restrict import to one account**

Create `tools/bulk_import/scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
.venv/bin/python -c "
from pathlib import Path
from bulk_import.config import load_config
from bulk_import.importer import run_import
cfg = load_config(Path('../../config.json'))
# override to single account
cfg_single = type(cfg)(
    vault_path=cfg.vault_path, sqlite_path=cfg.vault_path / '.index/refs-smoke.sqlite',
    xlsx_dir=cfg.xlsx_dir, html_dir=cfg.html_dir,
    default_cli=cfg.default_cli, fallback_cli=cfg.fallback_cli,
)
# hack: glob only AGI Hunt
import bulk_import.importer as imp
orig_run = imp.run_import
def patched(c):
    from bulk_import.db import init_db, get_by_url, log_issue
    from bulk_import.importer import _process_row, ImportStats
    from bulk_import.matcher import iter_xlsx_rows, find_html
    from bulk_import.db import upsert_article
    init_db(c.sqlite_path)
    s = ImportStats()
    xlsx = c.xlsx_dir / 'AGI Hunt.xlsx'
    html_dir = c.html_dir / 'AGI Hunt' / 'html'
    for row in iter_xlsx_rows(xlsx):
        if get_by_url(c.sqlite_path, row.url):
            s.skipped += 1; continue
        h = find_html(html_dir, row)
        if not h: s.missing_html += 1; continue
        try:
            art = _process_row(row, h, c); upsert_article(c.sqlite_path, art); s.succeeded += 1
        except Exception as e:
            s.parse_error += 1
    print(s)
patched(cfg_single)
"
```

```bash
chmod +x tools/bulk_import/scripts/smoke.sh
bash tools/bulk_import/scripts/smoke.sh
```

Expected: 打印 ImportStats，`succeeded > 0`，`missing_html` 低。

- [ ] **Step 3: Manually inspect output**

```bash
ls ~/CrossingVault/10_refs/"AGI Hunt"/ | head
head -30 ~/CrossingVault/10_refs/"AGI Hunt"/2025/*.md | head -50
sqlite3 ~/CrossingVault/.index/refs-smoke.sqlite \
  "SELECT account, COUNT(*) FROM ref_articles GROUP BY account"
sqlite3 ~/CrossingVault/.index/refs-smoke.sqlite \
  "SELECT error_kind, COUNT(*) FROM ingest_issues GROUP BY error_kind"
```

Expected: md 文件存在，frontmatter 正确，body 是中文正文；issues 数量 < 5%。

- [ ] **Step 4: Open vault in Obsidian manually**

User 手动验证：Obsidian 打开 `~/CrossingVault`，`AGI Hunt/2025/*.md` 能正常渲染。

- [ ] **Step 5: Commit the smoke script**

```bash
git add tools/bulk_import/scripts/smoke.sh
git -c commit.gpgsign=false commit -m "test(import): single-account smoke script"
```

---

### Task 10: Full import of 60 accounts

**Files:** none (runtime operation).

- [ ] **Step 1: Clean smoke-test data (optional)**

```bash
rm -rf ~/CrossingVault/.index/refs-smoke.sqlite
rm -rf ~/CrossingVault/10_refs/*
```

- [ ] **Step 2: Run full import**

```bash
cd /Users/zeoooo/crossing-writer/tools/bulk_import
.venv/bin/python -m bulk_import.importer --config ../../config.json 2>&1 | tee ~/CrossingVault/.index/import.log
```

Expected: 30–50 分钟完成，最后打印统计。

- [ ] **Step 3: Verify counts**

```bash
sqlite3 ~/CrossingVault/.index/refs.sqlite <<'SQL'
SELECT COUNT(*) as total FROM ref_articles;
SELECT account, COUNT(*) FROM ref_articles GROUP BY account ORDER BY 2 DESC LIMIT 10;
SELECT error_kind, COUNT(*) FROM ingest_issues GROUP BY error_kind;
SQL
```

Expected: 总行数 ≥ 95% × xlsx 总数。

- [ ] **Step 4: Spot-check FTS5**

```bash
sqlite3 ~/CrossingVault/.index/refs.sqlite <<'SQL'
SELECT a.account, a.title FROM ref_articles_fts f
  JOIN ref_articles a ON a.rowid = f.rowid
  WHERE ref_articles_fts MATCH 'claude' LIMIT 5;
SQL
```

Expected: 命中若干条。

- [ ] **Step 5: Commit import log (metadata only)**

```bash
# import.log 本身在 vault 下，不进 repo
# 只记录统计到 docs/
sqlite3 ~/CrossingVault/.index/refs.sqlite \
  "SELECT COUNT(*) FROM ref_articles; SELECT error_kind, COUNT(*) FROM ingest_issues GROUP BY error_kind" \
  > docs/superpowers/notes/2026-04-12-import-stats.txt
mkdir -p docs/superpowers/notes
git add docs/superpowers/notes/2026-04-12-import-stats.txt
git -c commit.gpgsign=false commit -m "chore: record full import statistics"
```

---

### Task 11: Rebuild-from-vault fallback

**Files:**
- Modify: `tools/bulk_import/src/bulk_import/importer.py`
- Modify: `tools/bulk_import/tests/test_importer.py`

- [ ] **Step 1: Write failing test**

Append to `test_importer.py`:

```python
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
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_importer.py::test_rebuild_from_vault -v
```

- [ ] **Step 3: Implement rebuild_from_vault**

Append to `importer.py`:

```python
import re
import yaml  # add to deps

def _parse_frontmatter(md_text: str) -> tuple[dict, str]:
    if not md_text.startswith("---"):
        return {}, md_text
    end = md_text.find("\n---", 3)
    if end < 0:
        return {}, md_text
    fm = md_text[3:end].strip()
    body = md_text[end+4:].lstrip("\n")
    # lightweight line-based parse to avoid yaml dep
    data = {}
    for line in fm.splitlines():
        if ":" not in line: continue
        k, _, v = line.partition(":")
        v = v.strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        elif v == "null":
            v = None
        elif v in ("true","false"):
            v = v == "true"
        elif v.startswith("[") and v.endswith("]"):
            try:
                import json as _j; v = _j.loads(v)
            except Exception:
                pass
        data[k.strip()] = v
    return data, body

def rebuild_from_vault(cfg: Config) -> ImportStats:
    init_db(cfg.sqlite_path)
    stats = ImportStats()
    refs_dir = cfg.vault_path / "10_refs"
    for md_file in refs_dir.rglob("*.md"):
        try:
            text = md_file.read_text(encoding="utf-8")
            fm, body = _parse_frontmatter(text)
            if fm.get("type") != "ref_article":
                continue
            plain = re.sub(r"[#*>`\[\]()!]", "", body)
            plain = re.sub(r"\s+", " ", plain).strip()
            art = Article(
                id=_hash_url(fm["url"]), account=fm["account"], title=fm["title"],
                author=fm.get("author"), published_at=fm["published_at"],
                is_original=bool(fm.get("is_original")),
                position=int(fm["position"]) if fm.get("position") not in (None, "null") else None,
                url=fm["url"], cover=fm.get("cover"), summary=fm.get("summary"),
                word_count=int(fm["word_count"]) if fm.get("word_count") not in (None, "null") else None,
                md_path=str(md_file.relative_to(cfg.vault_path)),
                html_path=str(md_file.with_suffix(".html").relative_to(cfg.vault_path)),
                body_plain=plain, body_segmented=segment(plain),
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
```

Also add `--rebuild-from-vault` flag to `main()`:

Replace `main()` in `importer.py`:

```python
def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--rebuild-from-vault", action="store_true")
    args = ap.parse_args()
    cfg = load_config(Path(args.config))
    if args.rebuild_from_vault:
        rebuild_from_vault(cfg)
    else:
        run_import(cfg)
    return 0
```

- [ ] **Step 4: Run test, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_importer.py::test_rebuild_from_vault -v
```

- [ ] **Step 5: Commit**

```bash
git add tools/bulk_import/src/bulk_import/importer.py \
        tools/bulk_import/tests/test_importer.py
git -c commit.gpgsign=false commit -m "feat(import): --rebuild-from-vault fallback"
```

---

### Task 12: Node.js kb package skeleton + db helper

**Files:**
- Create: `packages/kb/package.json`
- Create: `packages/kb/tsconfig.json`
- Create: `packages/kb/src/types.ts`
- Create: `packages/kb/src/db.ts`
- Create: `packages/kb/vitest.config.ts`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@crossing/kb",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "crossing-kb": "bin/crossing-kb" },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "dev": "tsc -w -p ."
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

- [ ] **Step 4: Install deps**

```bash
cd packages/kb && npm install
```

Expected: 装包成功。

- [ ] **Step 5: Write types.ts**

```ts
export interface SearchOptions {
  query?: string;
  account?: string | string[];
  author?: string;
  dateFrom?: string;
  dateTo?: string;
  topicsCore?: string[];
  topicsFine?: string[];
  isOriginal?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  mdPath: string;
  title: string;
  account: string;
  author: string | null;
  publishedAt: string;
  url: string;
  summary: string | null;
  snippet: string;
  topicsCore: string[];
  topicsFine: string[];
  wordCount: number | null;
  score: number;
}
```

- [ ] **Step 6: Write db.ts**

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface KbConfig {
  vaultPath: string;
  sqlitePath: string;
}

export function loadConfig(configPath: string): KbConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const expand = (p: string) => p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
  return {
    vaultPath: expand(raw.vaultPath),
    sqlitePath: expand(raw.sqlitePath),
  };
}

export function openDb(sqlitePath: string): Database.Database {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");
  return db;
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/kb/package.json packages/kb/tsconfig.json \
        packages/kb/vitest.config.ts packages/kb/src/types.ts \
        packages/kb/src/db.ts
git -c commit.gpgsign=false commit -m "feat(kb): node package skeleton + db helper"
```

---

### Task 13: searchRefs implementation

**Files:**
- Create: `packages/kb/src/search.ts`
- Create: `packages/kb/src/index.ts`
- Create: `packages/kb/tests/search.test.ts`

- [ ] **Step 1: Write failing test**

`packages/kb/tests/search.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRefs } from "../src/search.js";

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-test-"));
  dbPath = join(dir, "refs.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT,
      published_at TEXT, is_original INTEGER, position INTEGER, url TEXT UNIQUE,
      cover TEXT, summary TEXT, word_count INTEGER, md_path TEXT, html_path TEXT,
      body_plain TEXT, body_segmented TEXT, topics_core_json TEXT,
      topics_fine_json TEXT, ingest_status TEXT, content_hash TEXT,
      imported_at TEXT, updated_at TEXT
    );
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
      title, summary, body_segmented,
      content='ref_articles', content_rowid='rowid', tokenize='simple'
    );
    INSERT INTO ref_articles VALUES
      ('1','量子位','Claude Code 实测','A','2025-06-01',1,1,'u1','c','s1',
       100,'量子位/2025/a.md','量子位/2025/a.html','claude code 很强',
       'claude code 很 强','[]','[]','raw','h','2026-01-01','2026-01-01'),
      ('2','智东西','Agent 产品评测','B','2025-07-10',0,2,'u2','c','s2',
       200,'智东西/2025/b.md','智东西/2025/b.html','agent 测评',
       'agent 测评','[]','[]','raw','h','2026-01-01','2026-01-01');
    INSERT INTO ref_articles_fts(rowid,title,summary,body_segmented)
      SELECT rowid,title,summary,body_segmented FROM ref_articles;
  `);
  db.close();
});

it("searches by query", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { query: "claude" });
  expect(results.length).toBe(1);
  expect(results[0].title).toBe("Claude Code 实测");
  expect(results[0].mdPath).toBe("/vault/量子位/2025/a.md");
});

it("filters by account", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { account: "智东西" });
  expect(results.length).toBe(1);
  expect(results[0].account).toBe("智东西");
});

it("filters by date range", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" },
    { dateFrom: "2025-07-01" });
  expect(results.length).toBe(1);
  expect(results[0].account).toBe("智东西");
});

it("returns empty for no match", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { query: "notexist" });
  expect(results).toEqual([]);
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd packages/kb && npm test
```

Expected: import error.

- [ ] **Step 3: Implement search.ts**

```ts
import Database from "better-sqlite3";
import { resolve } from "node:path";
import type { SearchOptions, SearchResult } from "./types.js";

export interface SearchCtx {
  sqlitePath: string;
  vaultPath: string;
}

export function searchRefs(ctx: SearchCtx, opts: SearchOptions): SearchResult[] {
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    let fromClause = "ref_articles a";
    let scoreExpr = "0 AS score";
    let snippetExpr = "'' AS snippet";
    let orderBy = "a.published_at DESC";

    if (opts.query && opts.query.trim()) {
      fromClause = "ref_articles_fts f JOIN ref_articles a ON a.rowid = f.rowid";
      where.push("ref_articles_fts MATCH @q");
      params.q = opts.query;
      scoreExpr = "bm25(ref_articles_fts) AS score";
      snippetExpr = "snippet(ref_articles_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet";
      orderBy = "score";
    }
    if (opts.account) {
      const accounts = Array.isArray(opts.account) ? opts.account : [opts.account];
      const keys = accounts.map((_, i) => `@acc${i}`);
      accounts.forEach((v, i) => { params[`acc${i}`] = v; });
      where.push(`a.account IN (${keys.join(",")})`);
    }
    if (opts.author) {
      where.push("a.author = @author"); params.author = opts.author;
    }
    if (opts.dateFrom) {
      where.push("a.published_at >= @dateFrom"); params.dateFrom = opts.dateFrom;
    }
    if (opts.dateTo) {
      where.push("a.published_at <= @dateTo"); params.dateTo = opts.dateTo;
    }
    if (typeof opts.isOriginal === "boolean") {
      where.push("a.is_original = @orig"); params.orig = opts.isOriginal ? 1 : 0;
    }
    if (opts.topicsCore && opts.topicsCore.length) {
      const inList = opts.topicsCore.map((_, i) => `@tc${i}`);
      opts.topicsCore.forEach((v, i) => { params[`tc${i}`] = v; });
      where.push(`EXISTS (SELECT 1 FROM json_each(a.topics_core_json) WHERE value IN (${inList.join(",")}))`);
    }
    if (opts.topicsFine && opts.topicsFine.length) {
      const inList = opts.topicsFine.map((_, i) => `@tf${i}`);
      opts.topicsFine.forEach((v, i) => { params[`tf${i}`] = v; });
      where.push(`EXISTS (SELECT 1 FROM json_each(a.topics_fine_json) WHERE value IN (${inList.join(",")}))`);
    }

    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sql = `
      SELECT a.id, a.account, a.title, a.author, a.published_at, a.url,
             a.summary, a.md_path, a.topics_core_json, a.topics_fine_json,
             a.word_count, ${scoreExpr}, ${snippetExpr}
      FROM ${fromClause}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `;
    params.limit = limit;
    params.offset = offset;

    const rows = db.prepare(sql).all(params) as any[];
    return rows.map((r) => ({
      id: r.id,
      account: r.account,
      title: r.title,
      author: r.author ?? null,
      publishedAt: r.published_at,
      url: r.url,
      summary: r.summary ?? null,
      mdPath: resolve(ctx.vaultPath, r.md_path),
      snippet: r.snippet ?? "",
      topicsCore: r.topics_core_json ? JSON.parse(r.topics_core_json) : [],
      topicsFine: r.topics_fine_json ? JSON.parse(r.topics_fine_json) : [],
      wordCount: r.word_count ?? null,
      score: r.score ?? 0,
    }));
  } finally {
    db.close();
  }
}

export function getRefByUrl(ctx: SearchCtx, url: string): SearchResult | null {
  const [r] = searchRefs(ctx, { limit: 1 }) ;
  // delegate via direct SQL for exact lookup
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT * FROM ref_articles WHERE url=?").get(url) as any;
    if (!row) return null;
    return {
      id: row.id, account: row.account, title: row.title,
      author: row.author ?? null, publishedAt: row.published_at,
      url: row.url, summary: row.summary ?? null,
      mdPath: resolve(ctx.vaultPath, row.md_path),
      snippet: "",
      topicsCore: row.topics_core_json ? JSON.parse(row.topics_core_json) : [],
      topicsFine: row.topics_fine_json ? JSON.parse(row.topics_fine_json) : [],
      wordCount: row.word_count ?? null, score: 0,
    };
  } finally { db.close(); }
}
```

- [ ] **Step 4: Write index.ts**

`packages/kb/src/index.ts`:

```ts
export { searchRefs, getRefByUrl } from "./search.js";
export { loadConfig, openDb } from "./db.js";
export type { SearchOptions, SearchResult } from "./types.js";
export type { KbConfig } from "./db.js";
export type { SearchCtx } from "./search.js";
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
cd packages/kb && npm test
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/search.ts packages/kb/src/index.ts \
        packages/kb/tests/search.test.ts
git -c commit.gpgsign=false commit -m "feat(kb): searchRefs with FTS5 + filters + snippet"
```

---

### Task 14: `crossing kb search` CLI

**Files:**
- Create: `packages/kb/src/cli.ts`
- Create: `packages/kb/bin/crossing-kb`
- Create: `packages/kb/tests/cli.test.ts`

- [ ] **Step 1: Write failing test**

`packages/kb/tests/cli.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kb-cli-"));
  const sqlitePath = join(dir, "refs.sqlite");
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({
    vaultPath: dir, sqlitePath,
    importSources: { xlsxDir: "", htmlDir: "" },
    modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
  }));
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT,
      published_at TEXT, is_original INTEGER, position INTEGER, url TEXT UNIQUE,
      cover TEXT, summary TEXT, word_count INTEGER, md_path TEXT, html_path TEXT,
      body_plain TEXT, body_segmented TEXT, topics_core_json TEXT,
      topics_fine_json TEXT, ingest_status TEXT, content_hash TEXT,
      imported_at TEXT, updated_at TEXT
    );
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
      title, summary, body_segmented,
      content='ref_articles', content_rowid='rowid', tokenize='simple'
    );
    INSERT INTO ref_articles VALUES
      ('1','量子位','Claude Code 实测',NULL,'2025-06-01',1,1,'u1',NULL,NULL,
       100,'a.md','a.html','claude code','claude code','[]','[]','raw','h',
       '2026-01-01','2026-01-01');
    INSERT INTO ref_articles_fts(rowid,title,summary,body_segmented)
      SELECT rowid,title,summary,body_segmented FROM ref_articles;
  `);
  db.close();
  return { dir, configPath };
}

it("CLI returns JSON when --json", () => {
  const { configPath } = setup();
  const out = execSync(
    `node ${join(process.cwd(), "bin/crossing-kb")} search claude --config ${configPath} --json`,
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(out);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].title).toBe("Claude Code 实测");
});
```

- [ ] **Step 2: Implement cli.ts**

```ts
import { Command } from "commander";
import { loadConfig } from "./db.js";
import { searchRefs } from "./search.js";

export function buildCli(): Command {
  const program = new Command();
  program
    .name("crossing-kb")
    .description("Crossing knowledge base CLI")
    .version("0.1.0");

  program.command("search <query>")
    .description("full-text search the reference articles vault")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("-a, --account <name...>", "filter by account(s)")
    .option("--author <name>", "filter by author")
    .option("--since <date>", "published_at >= YYYY-MM-DD")
    .option("--until <date>", "published_at <= YYYY-MM-DD")
    .option("--topic-core <name...>", "filter by core topic(s)")
    .option("--original", "only is_original")
    .option("-n, --limit <n>", "max results", "20")
    .option("--json", "output JSON array")
    .action((query: string, opts) => {
      const cfg = loadConfig(opts.config);
      const results = searchRefs(
        { sqlitePath: cfg.sqlitePath, vaultPath: cfg.vaultPath },
        {
          query: query === "_" ? undefined : query,
          account: opts.account,
          author: opts.author,
          dateFrom: opts.since,
          dateTo: opts.until,
          topicsCore: opts.topicCore,
          isOriginal: opts.original,
          limit: parseInt(opts.limit, 10),
        }
      );
      if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2));
        return;
      }
      for (const r of results) {
        process.stdout.write(
          `${r.publishedAt}  [${r.account}]  ${r.title}\n  ${r.mdPath}\n\n`
        );
      }
    });

  return program;
}
```

- [ ] **Step 3: Create bin entry**

`packages/kb/bin/crossing-kb`:

```js
#!/usr/bin/env node
import { buildCli } from "../dist/cli.js";
buildCli().parseAsync(process.argv);
```

```bash
chmod +x packages/kb/bin/crossing-kb
```

- [ ] **Step 4: Build and run test**

```bash
cd packages/kb && npm run build && npm test
```

Expected: all tests passed.

- [ ] **Step 5: Manual end-to-end check**

```bash
cd /Users/zeoooo/crossing-writer
node packages/kb/bin/crossing-kb search "claude code" --config config.json --limit 5
```

Expected: 列出真实 vault 里的命中文章。

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/cli.ts packages/kb/bin/crossing-kb \
        packages/kb/tests/cli.test.ts
git -c commit.gpgsign=false commit -m "feat(kb): crossing-kb search CLI"
```

---

### Task 15: Phase 2 topic tagger — Claude CLI adapter

**Files:**
- Create: `tools/bulk_import/src/bulk_import/claude_cli.py`
- Create: `tools/bulk_import/src/bulk_import/tag.py`
- Create: `tools/bulk_import/tests/test_tag.py`

- [ ] **Step 1: Write failing tests**

`tools/bulk_import/tests/test_tag.py`:

```python
from pathlib import Path
from unittest.mock import patch
from bulk_import.tag import parse_claude_output, build_prompt, CORE_TOPICS

def test_parse_fenced_json():
    out = '```json\n{"topics_core": ["agent"], "topics_fine": ["auto-agent"]}\n```'
    r = parse_claude_output(out)
    assert r == {"topics_core": ["agent"], "topics_fine": ["auto-agent"]}

def test_parse_plain_json():
    out = '{"topics_core":["coding"],"topics_fine":["cli tools"]}'
    assert parse_claude_output(out)["topics_core"] == ["coding"]

def test_parse_with_preamble():
    out = '好的，分类结果如下：\n{"topics_core":["应用落地"],"topics_fine":["企业 AI"]}'
    assert parse_claude_output(out)["topics_core"] == ["应用落地"]

def test_parse_filters_unknown_core():
    out = '{"topics_core":["agent","不存在的分类"],"topics_fine":["x"]}'
    r = parse_claude_output(out)
    assert "agent" in r["topics_core"]
    assert "不存在的分类" not in r["topics_core"]

def test_build_prompt_includes_fields():
    p = build_prompt(title="T", summary="S", body_excerpt="B")
    assert "T" in p and "S" in p and "B" in p
    for t in CORE_TOPICS:
        assert t in p
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_tag.py -v
```

- [ ] **Step 3: Implement tag.py**

```python
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
    def replace_line(key: str, value_json: str) -> str:
        pat = re.compile(rf"^{key}:.*$", re.MULTILINE)
        line = f"{key}: {value_json}"
        if pat.search(fm_new[0]):
            fm_new[0] = pat.sub(line, fm_new[0])
        else:
            fm_new[0] = fm_new[0].rstrip() + "\n" + line
    fm_new = [fm]
    replace_line("topics_core", json.dumps(core, ensure_ascii=False))
    replace_line("topics_fine", json.dumps(fine, ensure_ascii=False))
    replace_line("ingest_status", "topics_tagged")
    md_path.write_text(f"---{fm_new[0]}\n---\n" + text[end+4:].lstrip("\n"), encoding="utf-8")

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
```

- [ ] **Step 4: Implement claude_cli.py**

```python
from __future__ import annotations
import subprocess
from typing import Optional

class ClaudeError(Exception):
    pass

def invoke_claude(prompt: str, *, cli: str = "claude", timeout: int = 120) -> str:
    """Call `claude -p <prompt>` subprocess and return stdout text."""
    try:
        proc = subprocess.run(
            [cli, "-p", prompt],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError as e:
        raise ClaudeError(f"{cli} CLI not found: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise ClaudeError(f"{cli} timed out after {timeout}s") from e
    if proc.returncode != 0:
        raise ClaudeError(f"{cli} exit={proc.returncode}: {proc.stderr[:500]}")
    return proc.stdout
```

- [ ] **Step 5: Run tag.py tests, verify PASS**

```bash
cd tools/bulk_import && .venv/bin/pytest tests/test_tag.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Manual smoke against real Claude CLI (small batch)**

```bash
cd tools/bulk_import
.venv/bin/python -m bulk_import.tag --config ../../config.json \
  --account "AGI Hunt" --batch 3
```

Expected: 打印 `{'ok': 3, 'failed': 0}`；对应 3 篇 md frontmatter 的 `topics_core` / `topics_fine` / `ingest_status` 被更新。

- [ ] **Step 7: Verify**

```bash
sqlite3 ~/CrossingVault/.index/refs.sqlite \
  "SELECT title, topics_core_json FROM ref_articles WHERE ingest_status='topics_tagged' LIMIT 3"
```

- [ ] **Step 8: Commit**

```bash
git add tools/bulk_import/src/bulk_import/tag.py \
        tools/bulk_import/src/bulk_import/claude_cli.py \
        tools/bulk_import/tests/test_tag.py
git -c commit.gpgsign=false commit -m "feat(import): phase-2 topic tagger via claude CLI"
```

---

### Task 16: End-to-end acceptance checklist

**Files:** none (verification only).

- [ ] **Step 1: Functional verification**

```bash
# 1. 总行数 vs xlsx
sqlite3 ~/CrossingVault/.index/refs.sqlite "SELECT COUNT(*) FROM ref_articles"
# 记录下来，对比 xlsx 估算总数

# 2. issues 比例 < 1%
sqlite3 ~/CrossingVault/.index/refs.sqlite \
  "SELECT error_kind, COUNT(*) FROM ingest_issues GROUP BY error_kind"

# 3. Obsidian 打开 ~/CrossingVault，人工浏览 3 个不同作者
open -a Obsidian ~/CrossingVault   # 或你惯用方式

# 4. 搜索性能 < 2s
time node packages/kb/bin/crossing-kb search "agent 测评" --config config.json --limit 20
```

- [ ] **Step 2: Rerun idempotence**

```bash
time .venv/bin/python -m bulk_import.importer --config ../../config.json
```

Expected: < 5 分钟完成，全部 skipped。

- [ ] **Step 3: Rebuild-from-vault**

```bash
mv ~/CrossingVault/.index/refs.sqlite ~/CrossingVault/.index/refs.sqlite.bak
.venv/bin/python -m bulk_import.importer --config ../../config.json --rebuild-from-vault
diff <(sqlite3 ~/CrossingVault/.index/refs.sqlite.bak "SELECT COUNT(*) FROM ref_articles") \
     <(sqlite3 ~/CrossingVault/.index/refs.sqlite     "SELECT COUNT(*) FROM ref_articles")
```

Expected: 行数相同。

- [ ] **Step 4: Commit final acceptance notes**

```bash
cat > docs/superpowers/notes/2026-04-12-sp01-acceptance.md <<EOF
# SP-01 Acceptance

Full import: <N> articles
Issues: <breakdown>
Rerun time: <t>
Search latency (agent 测评, limit 20): <t>
Rebuild equivalence: yes
Obsidian manual browse: pass
EOF
git add docs/superpowers/notes/2026-04-12-sp01-acceptance.md
git -c commit.gpgsign=false commit -m "docs: SP-01 acceptance notes"
```

---

## Self-Review

**Spec coverage:**
- §4 Vault 布局 → Task 1
- §5 frontmatter → Task 8 `_frontmatter_yaml`
- §5.2 HTML→MD → Task 5
- §6.1 schema → Task 3
- §6.2 FTS5 → Task 3
- §6.3 issues → Task 3 + Task 8
- §7 Phase 1 流程 → Tasks 2-8
- §7.3 幂等 → Task 8 test + Task 16
- §7.5 fuzzy match → Task 6
- §8 Phase 2 tagging → Task 15
- §9 Agent 检索 → Tasks 12-14
- §10 验收 → Tasks 9, 10, 16
- §11 风险 → 在各 Task 体现（issues 分类、--rebuild、--batch 分片）
- §12 扩展点 → 未实施但 schema 预留已在 Task 3

**Placeholder scan:** 无 TBD/TODO；所有代码步骤都给出完整代码。

**Type consistency:** `Article` dataclass 在 Task 3 定义，Tasks 8、11、15 复用一致。`SearchResult` 在 Task 12 定义，Task 13/14 使用一致。`Config` 在 Task 2 定义，后续全部通过 `load_config` 取。

---

## Handoff

Plan 已完整。实施方式二选一：
1. **Subagent-Driven（推荐）**：每 task 派一个 fresh subagent，task 间 review，快速迭代
2. **Inline Execution**：本会话内串行执行，checkpoint 处停下给你审
