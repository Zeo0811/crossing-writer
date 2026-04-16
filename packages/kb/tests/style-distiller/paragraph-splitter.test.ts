import { describe, it, expect } from 'vitest';
import { splitParagraphs } from '../../src/style-distiller/paragraph-splitter.js';

describe('splitParagraphs', () => {
  it('splits by blank lines', () => {
    const out = splitParagraphs('第一段\n\n第二段\n\n第三段');
    expect(out).toEqual(['第一段', '第二段', '第三段']);
  });

  it('treats ## heading as own paragraph', () => {
    const out = splitParagraphs('开篇\n\n## 小标题\n\n正文');
    expect(out).toEqual(['开篇', '## 小标题', '正文']);
  });

  it('treats h3 h4 headings as own paragraph', () => {
    const out = splitParagraphs('### 三级\n\n正文\n\n#### 四级');
    expect(out).toEqual(['### 三级', '正文', '#### 四级']);
  });

  it('compresses standalone image lines to [图]', () => {
    const out = splitParagraphs('文字\n\n![图片](https://x.com/a.png)\n\n更多文字');
    expect(out).toEqual(['文字', '[图]', '更多文字']);
  });

  it('keeps inline images inside text paragraphs', () => {
    const out = splitParagraphs('带图 ![](x.png) 的一段话');
    expect(out).toEqual(['带图 ![](x.png) 的一段话']);
  });

  it('merges consecutive non-blank lines into one paragraph', () => {
    const out = splitParagraphs('第一行\n第二行\n\n第三段');
    expect(out).toEqual(['第一行\n第二行', '第三段']);
  });

  it('handles CRLF', () => {
    const out = splitParagraphs('一\r\n\r\n二');
    expect(out).toEqual(['一', '二']);
  });

  it('drops empty string results', () => {
    const out = splitParagraphs('\n\n\n\n正文\n\n\n\n');
    expect(out).toEqual(['正文']);
  });
});
