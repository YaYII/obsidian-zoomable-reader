/* ============================================================================
 * Zoomable Reader · 白板排版：把「卡片 + 层级」摆到平面坐标上
 * ---------------------------------------------------------------------------
 * 布局是纯函数：给定模型与卡片宽度，算出每张卡片的位置、每根连线的端点。
 * 这样白板的排版能在 vitest 里断言（不重叠、父卡与子卡垂直居中对齐、边界正确），
 * 而不是靠「看着差不多」—— 排版错了在手机上是灾难，卡片会叠在一起看不清。
 *
 * 布局算法：经典整齐树（左→右）
 *   ① 自底向上算每棵子树的高度：subtree = max(自己卡片高, 所有子树高之和 + 间距)；
 *   ② 自顶向下摆：卡片在自己那条子树带里垂直居中，子卡依次排在下一列。
 * 于是「父卡正好对着它那一片子卡」—— 这是大纲读起来顺眼的关键。
 *
 * 高度是两遍的：先用估算排出雏形（首屏立刻可见），Markdown 渲染完再用真实高度
 * 重排一次（长表格、图片、公式的真实高度只有 DOM 知道）。两遍用的是同一个函数。
 * ========================================================================== */

import type { BoardBlock, BoardDoc, BoardNode } from "./board-model";

export interface BoardLayoutOptions {
  /** 卡片宽度（px）。手机上 300 左右一屏刚好一张卡 */
  cardWidth: number;
  /** 列间距：父卡与子卡之间留出的走线宽度 */
  gapX: number;
  /** 兄弟卡片之间的垂直间距 */
  gapY: number;
  /** 白板四周留白 */
  padding: number;
  /** 实测高度（渲染后量出来的）；缺省用估算值 */
  heights?: Record<string, number>;
}

export interface BoardCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 = 根卡 */
  depth: number;
}

export interface BoardLink {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BoardLayout {
  cards: BoardCard[];
  links: BoardLink[];
  byId: Record<string, BoardCard>;
  width: number;
  height: number;
}

export const DEFAULT_BOARD_LAYOUT: Omit<BoardLayoutOptions, "heights"> = {
  cardWidth: 320,
  gapX: 88,
  gapY: 32,
  padding: 40,
};

/** 纵向流里每深一级缩进多少（px）。缩进到第 3 级就不再往里缩了。
 *  按栏宽取比例（默认 1280 时约 38px）—— 固定 18px 在宽栏里根本看不出层级。 */
export const FLOW_INDENT_STEP = 18;
export const FLOW_MAX_INDENT_DEPTH = 3;

/** 实际缩进值：至少 18px，宽栏时约取栏宽的 3%。 */
export function flowIndentStep(cardWidth: number): number {
  return Math.max(FLOW_INDENT_STEP, Math.round(cardWidth * 0.03));
}

/** 白板的两种排版：单栏纵向流（读文档）/ 分支树（看全局）。 */
export type BoardLayoutMode = "flow" | "tree";

/** 估高参数：只求「八九不离十」，真实高度由渲染后的第二遍量出来。 */
const METRICS = {
  /** 卡片头部（标题 + 上下内边距） */
  header: 44,
  /** 根卡多一行「N 个章节」的元信息 */
  meta: 24,
  /** 正文行高 */
  line: 26,
  /** 代码行高 */
  codeLine: 21,
  /** 块与块之间的间距（含块自身的上下内边距） */
  blockGap: 14,
  /** 表格行高 */
  tableRow: 30,
  /** 图片/嵌入的默认高度 */
  media: 190,
  /** 按字号估的中文每行字数：15px 的中文字宽约等于字号 */
  charWidth: 15,
  /** 卡片左右内边距之和 */
  paddingX: 32,
} as const;

function charsPerLine(cardWidth: number): number {
  return Math.max(6, Math.floor((cardWidth - METRICS.paddingX) / METRICS.charWidth));
}

/** 单个块的估算高度。 */
export function estimateBlockHeight(block: BoardBlock, cardWidth: number): number {
  const perLine = charsPerLine(cardWidth);
  const textLines = (text: string): number => Math.max(1, Math.ceil(text.length / perLine));
  const lineCount = (text: string): number => Math.max(1, text.split("\n").length);

  switch (block.kind) {
    case "code":
    case "math":
      return lineCount(block.markdown) * METRICS.codeLine + METRICS.blockGap + 16;
    case "mermaid":
      return Math.max(160, lineCount(block.markdown) * METRICS.codeLine + 60);
    case "table":
      return lineCount(block.markdown) * METRICS.tableRow + METRICS.blockGap;
    case "list":
      return lineCount(block.markdown) * METRICS.line + METRICS.blockGap;
    case "image":
      return METRICS.media + METRICS.blockGap;
    case "hr":
      return 18;
    case "section":
      /* 折叠进来的小节自带一个标题行 */
      return METRICS.line + textLines(block.preview) * METRICS.line + METRICS.blockGap;
    default:
      return textLines(block.preview || block.markdown) * METRICS.line + METRICS.blockGap;
  }
}

/** 整张卡片的估算高度：头部 + 所有块。 */
export function estimateCardHeight(node: BoardNode, cardWidth: number): number {
  const body = node.blocks.reduce((sum, block) => sum + estimateBlockHeight(block, cardWidth), 0);
  const head = METRICS.header + (node.depth === 0 ? METRICS.meta : 0);
  return Math.max(72, Math.round(head + body + METRICS.blockGap));
}

/** 后序遍历（子在前、父在后），用于自底向上算子树高度。 */
function postorder(doc: BoardDoc, rootId: string, visit: (node: BoardNode) => void): void {
  const node = doc.byId[rootId];
  if (!node) return;
  for (const childId of node.children) postorder(doc, childId, visit);
  visit(node);
}

/** 排版：模型 + 尺寸 → 每张卡片的坐标与每根连线的端点。 */
export function layoutBoard(doc: BoardDoc, options: Partial<BoardLayoutOptions> = {}): BoardLayout {
  const opts: BoardLayoutOptions = Object.assign({}, DEFAULT_BOARD_LAYOUT, options);
  const cardWidth = Math.max(160, opts.cardWidth);

  const heights: Record<string, number> = {};
  const subtree: Record<string, number> = {};

  postorder(doc, doc.rootId, (node) => {
    const measured = opts.heights ? opts.heights[node.id] : undefined;
    const height = typeof measured === "number" && measured > 0 ? measured : estimateCardHeight(node, cardWidth);
    heights[node.id] = height;
    let childrenHeight = 0;
    node.children.forEach((childId, i) => {
      childrenHeight += (subtree[childId] || 0) + (i > 0 ? opts.gapY : 0);
    });
    subtree[node.id] = Math.max(height, childrenHeight);
  });

  const cards: BoardCard[] = [];
  const byId: Record<string, BoardCard> = {};
  const stepX = cardWidth + opts.gapX;

  /* 摆放以「顶部」为基准：卡片的顶 = 它那条子树带的顶，子卡从同一个顶往下排。
   *
   * 为什么不用「父子垂直居中」（经典 mindmap 的做法）：白板是拿来【读文档】的。
   * 居中的话，一张短卡面对一列很高的子卡时会被推到中间，屏幕上出现一大片空白 ——
   * 实测就是这样：打开白板，可见区域的上半屏全是空的，看着「尺寸很小」。
   * 顶部对齐之后，左上角就是内容，往下读就是下一张卡，和读纸一样。 */
  const place = (id: string, top: number): void => {
    const node = doc.byId[id];
    if (!node) return;
    const height = heights[id];
    const card: BoardCard = {
      id: id,
      x: opts.padding + node.depth * stepX,
      y: Math.round(top),
      width: cardWidth,
      height: height,
      depth: node.depth,
    };
    cards.push(card);
    byId[id] = card;

    let cursor = top;
    for (const childId of node.children) {
      place(childId, cursor);
      cursor += (subtree[childId] || 0) + opts.gapY;
    }
  };
  place(doc.rootId, opts.padding);

  const links: BoardLink[] = [];
  for (const card of cards) {
    const node = doc.byId[card.id];
    for (const childId of node.children) {
      const child = byId[childId];
      if (!child) continue;
      links.push({
        from: card.id,
        to: childId,
        x1: card.x + card.width,
        y1: card.y + card.height / 2,
        x2: child.x,
        y2: child.y + child.height / 2,
      });
    }
  }

  let width = opts.padding;
  let height = opts.padding;
  for (const card of cards) {
    width = Math.max(width, card.x + card.width);
    height = Math.max(height, card.y + card.height);
  }

  return {
    cards: cards,
    links: links,
    byId: byId,
    width: width + opts.padding,
    height: height + opts.padding,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 单栏纵向流：一张 A5 宽的纸，按【文档顺序】自上而下叠成一列。
 *
 * 这是给「读」用的排版：往下滑就是往下读，不需要横向找内容（手机尤其需要）。
 * 层级用缩进 + 卡片左侧色条表达，所以这里不画连线 —— 一行一列里画线只会互相压住。
 * 原文档顺序就是 doc.nodes 的顺序（前序遍历），所以 y 一定随文档单调递增。
 */
export function layoutBoardFlow(doc: BoardDoc, options: Partial<BoardLayoutOptions> = {}): BoardLayout {
  const opts: BoardLayoutOptions = Object.assign({}, DEFAULT_BOARD_LAYOUT, options);
  const cardWidth = Math.max(160, opts.cardWidth);

  const cards: BoardCard[] = [];
  const byId: Record<string, BoardCard> = {};
  let y = opts.padding;
  let indentMax = 0;

  for (const node of doc.nodes) {
    const measured = opts.heights ? opts.heights[node.id] : undefined;
    const height = typeof measured === "number" && measured > 0 ? measured : estimateCardHeight(node, cardWidth);
    const level = Math.min(node.depth, FLOW_MAX_INDENT_DEPTH);
    const indent = level * flowIndentStep(cardWidth);
    indentMax = Math.max(indentMax, indent);
    const card: BoardCard = {
      id: node.id,
      x: opts.padding + indent,
      y: Math.round(y),
      width: cardWidth,
      height: height,
      depth: node.depth,
    };
    cards.push(card);
    byId[node.id] = card;
    y += height + opts.gapY;
  }

  return {
    cards: cards,
    links: [],
    byId: byId,
    width: opts.padding * 2 + indentMax + cardWidth,
    height: Math.max(opts.padding * 2, y - opts.gapY + opts.padding),
  };
}

/** 按排版模式分发（视图与验证台共用同一份判断）。 */
export function layoutBoardByMode(
  doc: BoardDoc,
  mode: BoardLayoutMode,
  options: Partial<BoardLayoutOptions> = {}
): BoardLayout {
  return mode === "flow" ? layoutBoardFlow(doc, options) : layoutBoard(doc, options);
}

/** 连线的 SVG 路径：两端各留一半水平距离做控制点，读起来像「分支」而不是直线斜插。 */
export function linkPath(link: BoardLink): string {
  const bend = Math.max(24, (link.x2 - link.x1) / 2);
  return (
    "M " + round1(link.x1) + " " + round1(link.y1) +
    " C " + round1(link.x1 + bend) + " " + round1(link.y1) +
    ", " + round1(link.x2 - bend) + " " + round1(link.y2) +
    ", " + round1(link.x2) + " " + round1(link.y2)
  );
}

/** 卡片外扩一圈的命中判定：用于「点哪张卡就聚焦哪张」。 */
export function cardAt(layout: BoardLayout, x: number, y: number): BoardCard | null {
  for (const card of layout.cards) {
    if (x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height) return card;
  }
  return null;
}
