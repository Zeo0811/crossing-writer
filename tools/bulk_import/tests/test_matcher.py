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
