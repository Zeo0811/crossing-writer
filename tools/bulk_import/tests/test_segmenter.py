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
