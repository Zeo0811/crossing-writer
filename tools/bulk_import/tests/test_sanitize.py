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
