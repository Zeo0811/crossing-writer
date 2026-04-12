from bulk_import.sanitize import sanitize_filename, build_stem

def test_replaces_forbidden_chars():
    assert sanitize_filename('A/B\\C:D*E?F"G<H>I|J') == "A-B-C-D-E-F-G-H-I-J"

def test_folds_whitespace():
    assert sanitize_filename("hello   world\t tab") == "hello-world-tab"

def test_strips_trailing_dot():
    assert sanitize_filename("title.") == "title"
    assert sanitize_filename("title..") == "title"

def test_build_stem_always_includes_url_disambiguator():
    url = "http://mp.weixin.qq.com/s?__biz=abc&mid=12345&sn=abcdef0123456789"
    stem = build_stem("2025-05-30", "短标题", url)
    assert stem.startswith("2025-05-30_短标题_")
    assert len(stem.split("_")[-1]) == 8   # 8-hex sha1 suffix

def test_build_stem_different_urls_different_stems():
    a = build_stem("2025-05-30", "重复标题", "http://x.com/a")
    b = build_stem("2025-05-30", "重复标题", "http://x.com/b")
    assert a != b

def test_build_stem_truncates_long_title_with_disambiguator():
    long = "长" * 200
    url = "http://mp.weixin.qq.com/s?__biz=abc&mid=12345&sn=abcdef0123456789"
    stem = build_stem("2025-05-30", long, url)
    assert len(stem.encode("utf-8")) <= 140
    assert stem.startswith("2025-05-30_")
    # suffix still present
    assert stem.split("_")[-1].isalnum() and len(stem.split("_")[-1]) == 8

def test_preserves_chinese():
    assert sanitize_filename("AI产品黄叔的文章") == "AI产品黄叔的文章"
