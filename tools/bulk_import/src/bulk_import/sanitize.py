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
