/* ============================================================================
 * Zoomable Reader · 长标签自动折行（纯函数，不依赖 obsidian）
 * ---------------------------------------------------------------------------
 * 用户反馈：「图形里面的文字内容太多了，你应该可以换行呀，而不是一行顶一个宽度呀」。」
 *
 * 先说清 Mermaid 的真实脾气（10.9 实测，别按印象写）：
 *   · 普通标签 A[很长的文本] —— 【从不折行】。把 flowchart.wrappingWidth 从 460 改成 120，
 *     渲染结果一模一样（同一个 478x42 的框、同一行字）。所以插件里那个「标签最大宽度」
 *     滑块对普通标签其实是个空旋钮 —— 这正是用户抱怨的根源。
 *   · markdown 字符串标签 A["`很长的文本`"] —— 会按 wrappingWidth 折行（实测 260 →
 *     框 278x98、三行；200 → 框 218x122）。前提是 flowchart.markdownAutoWrap 打开。
 *
 * 于是做法是：**把长标签改写成 markdown 字符串**，折行交给 Mermaid 自己的布局。
 * 只改长标签、只改结构能确定的写法；短标签、已经折行的、含引号/反引号/<br> 的一律原样留着 ——
 * 宁可少折一行，也不要改坏用户的图。
 * ========================================================================== */

/** 反引号（markdown 字符串的分隔符）。用码点写，省得这一行本身成为转义难题。 */
const BT = String.fromCharCode(96);

/** 围栏行：```mermaid / ~~~mermaid（反引号用 \u0060 写，避免源码里出现裸反引号） */
const FENCE_MERMAID = /^\s*(\u0060{3,}|~{3,})\s*mermaid\s*$/i;
const FENCE_ANY = /^\s*(\u0060{3,}|~{3,})\s*$/;

/** 全角（汉字、假名、全角标点）按一个字宽算。 */
function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) || 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** 估算一段标签渲染出来有多宽（px）：CJK 按 1em，其余按 0.55em。够用来判断「要不要折」。 */
export function estimateLabelWidth(text: string, fontSize: number = 16): number {
  let widest = 0;
  let current = 0;
  for (const ch of text.replace(/<br\s*\/?>/gi, "\n")) {
    if (ch === "\n") {
      widest = Math.max(widest, current);
      current = 0;
      continue;
    }
    current += isWide(ch) ? fontSize : fontSize * 0.55;
  }
  return Math.max(widest, current);
}

/** 已经是 markdown 字符串 / 带换行或引号 / 含反引号：不动它（动了就可能改坏）。 */
function skipLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  if (trimmed.includes(BT) || trimmed.includes('"')) return true;
  return /<br\s*\/?>/i.test(trimmed);
}

/** 节点形状：id 后面紧跟开括号。闭括号成对找；`>text]` 这类不对称的形状不碰。 */
const NODE_OPEN = /([A-Za-z_][A-Za-z0-9_-]*)\s*(\[\[|\(\[|\(\(|\{\{|\[|\(|\{)/g;
const CLOSER: Record<string, string> = {
  "[": "]",
  "(": ")",
  "{": "}",
  "[[": "]]",
  "([": "])",
  "((": "))",
  "{{": "}}",
};

/**
 * 把长标签改写成 markdown 字符串（Mermaid 才会按 wrappingWidth 折行）。
 * 处理两类：`id[标签]` 这类节点标签，以及 `-->|标签|` 这类边标签。
 */
export function wrapLongMermaidLabels(
  source: string,
  options: { maxWidth?: number; fontSize?: number } = {}
): string {
  const maxWidth = options.maxWidth === undefined ? 260 : options.maxWidth;
  const fontSize = options.fontSize === undefined ? 16 : options.fontSize;
  if (!source) return source;

  const quote = (text: string) => '"' + BT + text.trim() + BT + '"';

  /* ① 节点标签：A[长文本] → A["`长文本`"] */
  let out = "";
  let cursor = 0;
  NODE_OPEN.lastIndex = 0;
  let match = NODE_OPEN.exec(source);
  while (match) {
    const closer = CLOSER[match[2]];
    const contentStart = match.index + match[0].length;
    const contentEnd = source.indexOf(closer, contentStart);
    if (contentEnd < 0) break;
    const label = source.slice(contentStart, contentEnd);
    /* 标签里再出现开括号，说明结构没那么简单（嵌套/多行），不碰 */
    const nested = /[([{]/.test(label);
    if (!nested && !skipLabel(label) && estimateLabelWidth(label, fontSize) > maxWidth) {
      out += source.slice(cursor, contentStart) + quote(label) + closer;
    } else {
      out += source.slice(cursor, contentEnd + closer.length);
    }
    cursor = contentEnd + closer.length;
    NODE_OPEN.lastIndex = cursor;
    match = NODE_OPEN.exec(source);
  }
  out += source.slice(cursor);

  /* ② 边标签：A -->|长文本| B → A -->|"`长文本`"| B */
  return out.replace(/\|([^|\n]+)\|/g, (whole, label: string) => {
    if (skipLabel(label) || estimateLabelWidth(label, fontSize) <= maxWidth) return whole;
    return "|" + quote(label) + "|";
  });
}

/** 只改写 Markdown 里 mermaid 围栏内的内容（插件自己的视图：渲染前先过一遍）。 */
export function wrapMermaidFences(
  markdown: string,
  options: { maxWidth?: number; fontSize?: number } = {}
): string {
  if (!markdown || markdown.indexOf("\u0060\u0060\u0060") < 0) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inside = false;
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) out.push(wrapLongMermaidLabels(buffer.join("\n"), options));
    buffer = [];
  };
  for (const line of lines) {
    if (!inside && FENCE_MERMAID.test(line)) {
      inside = true;
      out.push(line);
      continue;
    }
    if (inside && FENCE_ANY.test(line)) {
      inside = false;
      flush();
      out.push(line);
      continue;
    }
    if (inside) buffer.push(line);
    else out.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * 从「注入给 Markdown 后处理器的整节原文」里取出这个 mermaid 代码块的内容。
 * 阅读视图里的图表是【宿主】渲染的：拿不到源码就改不了标签，于是靠
 * context.getSectionInfo() 拿回这一节的行范围，再把围栏里的内容抠出来自己重渲染。
 */
export function extractMermaidFence(text: string, lineStart: number, lineEnd: number): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const from = Math.max(0, lineStart);
  const to = Math.min(lines.length - 1, lineEnd);
  let open = -1;
  for (let i = from; i <= to; i += 1) {
    if (FENCE_MERMAID.test(lines[i])) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  const body: string[] = [];
  for (let i = open + 1; i < lines.length; i += 1) {
    if (FENCE_ANY.test(lines[i])) break;
    body.push(lines[i]);
  }
  const source = body.join("\n").trim();
  return source || null;
}
