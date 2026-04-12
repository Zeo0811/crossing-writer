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
    from hashlib import sha1
    disambig = "_" + sha1(url.encode("utf-8")).hexdigest()[:8]
    base = f"{date}_{sanitize_filename(title)}"
    full = base + disambig
    if len(full.encode("utf-8")) <= MAX_STEM_BYTES:
        return full
    room = MAX_STEM_BYTES - len(disambig.encode("utf-8"))
    return _truncate_bytes(base, room) + disambig
