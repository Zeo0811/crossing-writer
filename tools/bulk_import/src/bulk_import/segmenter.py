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
