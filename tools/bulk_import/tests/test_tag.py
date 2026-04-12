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
