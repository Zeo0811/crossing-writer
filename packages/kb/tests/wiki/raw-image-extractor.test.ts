import { describe, it, expect } from "vitest";
import { extractImagesFromHtml, extractImagesFromMarkdown } from "../../src/wiki/raw-image-extractor.js";

describe("raw-image-extractor HTML", () => {
  it("pulls src + alt as caption from <img>", () => {
    const html = `<p>x</p><img src="https://mmbiz.qpic.cn/a.png" alt="分镜一"/><img src='b.jpg'>`;
    const out = extractImagesFromHtml(html);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://mmbiz.qpic.cn/a.png");
    expect(out[0]!.caption).toBe("分镜一");
    expect(out[1]!.url).toBe("b.jpg");
  });

  it("skips data: urls", () => {
    const html = `<img src="data:image/png;base64,xxx"/>`;
    expect(extractImagesFromHtml(html)).toEqual([]);
  });

  it("dedupes same url", () => {
    const html = `<img src="a.png"/><img src="a.png" alt="dup"/>`;
    const out = extractImagesFromHtml(html);
    expect(out).toHaveLength(1);
  });
});

describe("raw-image-extractor Markdown", () => {
  it("extracts ![alt](url) form", () => {
    const md = `正文\n\n![一个图](https://x/y.png)\n\n![](z.jpg)`;
    const out = extractImagesFromMarkdown(md);
    expect(out).toHaveLength(2);
    expect(out[0]!.caption).toBe("一个图");
    expect(out[1]!.caption).toBeUndefined();
  });
});
