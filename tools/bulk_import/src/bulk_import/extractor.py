from __future__ import annotations
from dataclasses import dataclass
from bs4 import BeautifulSoup
import markdownify
import re

BOILERPLATE_TEXT_PATTERNS = [
    "预览时标签不可点", "继续滑动看下一个", "轻触阅读原文",
    "知道了", "向上滑动看下一个", "阅读原文",
    "微信扫一扫", "赞赏作者", "在看", "分享",
]

BOILERPLATE_MATCH_SET = set(BOILERPLATE_TEXT_PATTERNS)

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
        if txt and txt in BOILERPLATE_MATCH_SET:
            parent = el.parent
            if parent is not None:
                parent.decompose()

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
