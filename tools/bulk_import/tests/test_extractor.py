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

def test_extract_does_not_drop_paragraphs_mentioning_common_words():
    html = """<html><body><div id="js_content">
    <p>这篇文章很值得一读，在看完之后请分享给同事。</p>
    <p>正文第二段也要保留。</p>
    </div></body></html>"""
    from bulk_import.extractor import extract
    res = extract(html)
    assert "在看完之后请分享" in res.markdown
    assert "正文第二段也要保留" in res.markdown
