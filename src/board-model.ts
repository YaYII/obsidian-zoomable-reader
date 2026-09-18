/* ============================================================================
 * Zoomable Reader · 白板模型：把一篇 Markdown 编译成「卡片 + 大纲层级」
 * ---------------------------------------------------------------------------
 * 与「把整页笔记塞进一块会缩放的板子」不同：白板模式下，**文档本身**要被编译成
 * 白板 —— 每个标题是一张卡，卡里是这一节的正文块，卡片之间的连线就是文档大纲。
 * 于是手机上一眼看到的是全局结构，捏合放大后读的是细节，而不是在一张长纸上滑。
 *
 * 这里只做「纯文本 → 模型」，不碰 DOM、不依赖 obsidian，因此能在 vitest 里用
 * 真实中文文档直接测。解析的坑几乎都在边界上，而这些边界恰好都能写进测试：
 *   · 代码围栏里的 # 不是标题（否则一段 shell 注释就能把大纲劈碎）；
 *   · frontmatter 不是正文（YAML 里的 --- 会被当成分隔线）；
 *   · 表格第二行是分隔行，不能当正文段落；
 *   · 标题跳级（# 直接到 ###）要挂到最近的更浅标题下，而不是丢掉层级。
 * ========================================================================== */

/** 一个正文块的类型。渲染层按类型决定字号与内边距，模型层只负责判定。 */
export type BlockKind =
  | "paragraph"
  | "list"
  | "quote"
  | "callout"
  | "code"
  | "mermaid"
  | "table"
  | "image"
  | "math"
  | "hr"
  | "html"
  | "section";

export interface BoardBlock {
  kind: BlockKind;
  /** 原文（渲染时原样交给 Obsidian 的 MarkdownRenderer，保证链接、嵌入、公式都能用） */
  markdown: string;
  /** 折叠态 / 无障碍标签用的一行纯文本摘要 */
  preview: string;
  /** 源码行数：估算卡片高度、判断「这张卡有多重」 */
  lines: number;
}

export interface BoardNode {
  /** 稳定 id：root 或 n1、n2…… 按文档顺序生成，同一篇笔记每次解析结果一致 */
  id: string;
  /** 0 = 根（笔记本身）；1..6 = 标题层级 */
  depth: number;
  /** 标题原文；根节点是笔记名 */
  title: string;
  /** 这一节的正文块（不含更深的标题，除非被 foldBoard 折叠进来） */
  blocks: BoardBlock[];
  parentId: string | null;
  children: string[];
  /** 同级序号，用于稳定排序与「第 n 节」这类文案 */
  index: number;
  /** 标题所在源码行（1 起），便于「跳到原文」与问题定位 */
  line: number;
}

export interface BoardDoc {
  rootId: string;
  /** 前序遍历（父在子前），顺序即文档顺序 */
  nodes: BoardNode[];
  byId: Record<string, BoardNode>;
  /** 被跳过的行数（frontmatter），如实告诉用户「这部分不在白板上」 */
  skippedLines: number;
}

export interface ParseOptions {
  /** 根卡片标题（一般传笔记名；缺省取第一个 # 标题，再退回 Note） */
  title?: string;
}

const FENCE_RE = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const RULE_LINE_RE = /^ {0,3}---[ \t]*$/;
const LIST_RE = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]+/;
const QUOTE_RE = /^ {0,3}>/;
const CALLOUT_RE = /^ {0,3}>[ \t]*\[!/;
const IMAGE_RE = /^ {0,3}(?:!\[\[|!\[[^\]]*\]\()/;

/** 一个原始的扫描片段：标题，或一段连续正文。 */
type RawSegment =
  | { type: "heading"; level: number; title: string; line: number }
  | { type: "block"; lines: string[]; line: number };

/** 扫描：把源码切成标题与正文块。围栏与公式块内部的 # 一律不当标题。 */
function scan(markdown: string, skipped: { lines: number }): RawSegment[] {
  const lines = markdown.split(/\r?\n/);
  const out: RawSegment[] = [];
  let i = 0;

  /* frontmatter：开头三横线到下一个三横线。它是元数据（标签、别名），不是正文，
   * 渲染成卡片只会让人以为笔记正文长这样。 */
  if (lines.length > 0 && RULE_LINE_RE.test(lines[0])) {
    let j = 1;
    while (j < lines.length && !RULE_LINE_RE.test(lines[j])) j += 1;
    if (j < lines.length) {
      skipped.lines += j + 1;
      i = j + 1;
    }
  }

  let buffer: string[] = [];
  let bufferLine = 0;
  const flush = (): void => {
    if (buffer.length === 0) return;
    out.push({ type: "block", lines: buffer, line: bufferLine });
    buffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1][0];
      const len = fence[1].length;
      const body: string[] = [line];
      const start = i;
      i += 1;
      while (i < lines.length) {
        const current = lines[i];
        body.push(current);
        i += 1;
        const close = FENCE_RE.exec(current);
        if (close && close[1][0] === marker && close[1].length >= len && close[2].trim() === "") break;
      }
      out.push({ type: "block", lines: body, line: start });
      continue;
    }

    if (line.trim() === "$$") {
      flush();
      const body: string[] = [line];
      const start = i;
      i += 1;
      while (i < lines.length) {
        const current = lines[i];
        body.push(current);
        i += 1;
        if (current.trim() === "$$") break;
      }
      out.push({ type: "block", lines: body, line: start });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      out.push({
        type: "heading",
        level: heading[1].length,
        title: heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim(),
        line: i,
      });
      i += 1;
      continue;
    }

    if (line.trim() === "") {
      flush();
      i += 1;
      continue;
    }

    if (buffer.length === 0) bufferLine = i;
    buffer.push(line);
    i += 1;
  }
  flush();
  return out;
}

/** 表格判定：第二行是「| --- | :--: |」这类分隔行才算表格，避免把竖线文本误判。 */
function isTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const second = lines[1].trim();
  if (!second.includes("-")) return false;
  return /^\|?[ \t:|-]+\|?$/.test(second) && second.includes("|");
}

/** 给一个正文块定类型。顺序有意义：围栏 → 公式 → 引用/标注 → 表格 → 列表 → 图片 → 其它。 */
export function classifyBlock(lines: string[]): BoardBlock {
  const markdown = lines.join("\n");
  const first = (lines[0] || "").trim();
  let kind: BlockKind = "paragraph";

  const fence = FENCE_RE.exec(lines[0] || "");
  if (fence) {
    const info = fence[2].trim().toLowerCase();
    kind = info.startsWith("mermaid") ? "mermaid" : "code";
  } else if (first === "$$") {
    kind = "math";
  } else if (CALLOUT_RE.test(lines[0] || "")) {
    kind = "callout";
  } else if (QUOTE_RE.test(lines[0] || "")) {
    kind = "quote";
  } else if (isTable(lines)) {
    kind = "table";
  } else if (LIST_RE.test(lines[0] || "")) {
    kind = "list";
  } else if (IMAGE_RE.test(lines[0] || "")) {
    kind = "image";
  } else if (first.startsWith("<")) {
    kind = "html";
  } else if (HR_RE.test(first)) {
    kind = "hr";
  }

  return { kind: kind, markdown: markdown, preview: plainText(markdown, 90), lines: lines.length };
}

/**
 * 一行纯文本摘要：去掉 Markdown 标记，保留人能读的内容。
 * 用途是折叠态、无障碍标签、以及白板卡片头部的灰色副标题。
 */
export function plainText(markdown: string, limit: number = 90): string {
  let text = markdown;
  text = text.replace(/^ {0,3}\x60{3,}[^\n]*$/gm, "");
  text = text.replace(/^ {0,3}~{3,}[^\n]*$/gm, "");
  text = text.replace(/^ {0,3}(#{1,6})[ \t]+/gm, "");
  text = text.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias || target);
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias || target);
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^ {0,3}>[ \t]?/gm, "");
  text = text.replace(/^ {0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, "");
  text = text.replace(/[*_\x60~]/g, "");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(1, limit - 1)).trimEnd() + "…";
}

/** 解析：Markdown → 白板模型。 */
export function parseBoard(markdown: string, options: ParseOptions = {}): BoardDoc {
  const skipped = { lines: 0 };
  const segments = scan(markdown, skipped);

  const rootTitle =
    (options.title && options.title.trim()) ||
    (segments.find((s) => s.type === "heading") as { title: string } | undefined)?.title ||
    "Note";

  const root: BoardNode = {
    id: "root",
    depth: 0,
    title: rootTitle,
    blocks: [],
    parentId: null,
    children: [],
    index: 0,
    line: 1,
  };
  const nodes: BoardNode[] = [root];
  const byId: Record<string, BoardNode> = { root: root };
  const stack: BoardNode[] = [root];
  let counter = 0;

  for (const segment of segments) {
    if (segment.type === "heading") {
      /* 标题跳级：一直弹到「比当前标题更浅」的那一层当父节点。
       * # → ### 于是挂到 # 下面，而不是变成孤儿或覆盖层级。 */
      while (stack.length > 1 && stack[stack.length - 1].depth >= segment.level) stack.pop();
      const parent = stack[stack.length - 1];
      counter += 1;
      const node: BoardNode = {
        id: "n" + counter,
        depth: segment.level,
        title: segment.title || plainText(segment.title, 40) || "未命名章节",
        blocks: [],
        parentId: parent.id,
        children: [],
        index: parent.children.length,
        line: segment.line + 1,
      };
      parent.children.push(node.id);
      nodes.push(node);
      byId[node.id] = node;
      stack.push(node);
      continue;
    }
    stack[stack.length - 1].blocks.push(classifyBlock(segment.lines));
  }

  return { rootId: "root", nodes: nodes, byId: byId, skippedLines: skipped.lines };
}

/** 把一串块还原成 Markdown（折叠章节时用）。 */
export function blocksToMarkdown(blocks: BoardBlock[]): string {
  return blocks.map((b) => b.markdown).join("\n\n");
}

/**
 * 折叠：超过 maxDepth 的层级不再单独成卡，而是作为小节拼进最近的祖先卡片里。
 * 为什么要折叠：中文笔记常写到四五级标题，逐级成列会让白板横向拉出几千像素，
 * 手机上「全图」变成一片看不清的线；折叠后每一级都是可读的卡片。
 */
export function foldBoard(doc: BoardDoc, maxDepth: number): BoardDoc {
  const limit = Math.max(1, Math.floor(maxDepth));
  if (doc.nodes.every((n) => n.depth <= limit)) return doc;

  const nodes: BoardNode[] = [];
  const byId: Record<string, BoardNode> = {};
  for (const node of doc.nodes) {
    /* 找最近的、保留成卡的祖先：沿【原始文档】的父链往上走，
     * 跳过同样被折叠掉的中间层（它们此刻还不在 byId 里）。 */
    let ancestor: BoardNode | null = null;
    let cursor = node.parentId;
    while (cursor) {
      const kept = byId[cursor];
      if (kept) {
        ancestor = kept;
        break;
      }
      const original = doc.byId[cursor];
      cursor = original ? original.parentId : null;
    }

    if (node.depth <= limit || !ancestor) {
      const clone: BoardNode = {
        id: node.id,
        depth: node.depth,
        title: node.title,
        blocks: node.blocks.slice(),
        parentId: ancestor ? ancestor.id : null,
        children: [],
        index: ancestor ? ancestor.children.length : 0,
        line: node.line,
      };
      if (ancestor) ancestor.children.push(clone.id);
      nodes.push(clone);
      byId[clone.id] = clone;
      continue;
    }

    const level = Math.min(6, 3 + (node.depth - limit));
    const heading = "#".repeat(level) + " " + node.title;
    const body = blocksToMarkdown(node.blocks);
    const markdown = body ? heading + "\n\n" + body : heading;
    ancestor.blocks.push({
      kind: "section",
      markdown: markdown,
      preview: node.title,
      lines: node.blocks.reduce((sum, b) => sum + b.lines, 0) + 1,
    });
  }

  return { rootId: doc.rootId, nodes: nodes, byId: byId, skippedLines: doc.skippedLines };
}

export interface FoldResult {
  doc: BoardDoc;
  /** 实际用到的层数（可能比请求的更浅，因为要守住卡片数量上限） */
  depth: number;
}

/**
 * 按「卡片数量上限」自动选一个折叠层级：从用户设的深度往下试，第一个不超上限的胜出。
 * 为什么要有它：一篇几百个标题的长文档（书稿、会议记录）逐级成卡会让手机上掉帧，
 * 而「白板打不开」比「白板少显示两级」糟糕得多 —— 这里选后者，并在根卡上如实说明。
 */
export function foldToFit(doc: BoardDoc, maxDepth: number, maxCards: number): FoldResult {
  const cap = Math.max(1, Math.floor(maxCards));
  const start = Math.max(1, Math.floor(maxDepth));
  let fallback: FoldResult = { doc: foldBoard(doc, 1), depth: 1 };
  for (let depth = start; depth >= 1; depth -= 1) {
    const folded = foldBoard(doc, depth);
    const result: FoldResult = { doc: folded, depth: depth };
    if (folded.nodes.length <= cap) return result;
    fallback = result;
  }
  return fallback;
}
