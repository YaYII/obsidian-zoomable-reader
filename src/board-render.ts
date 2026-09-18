/* ============================================================================
 * Zoomable Reader · 白板渲染（纯 DOM，不依赖 obsidian）
 * ---------------------------------------------------------------------------
 * 把「白板模型 + 排版结果」变成真实 DOM：连线一层，卡片一层。
 *
 * 为什么独立成文件、且不 import obsidian：
 *   ① 白板的排版只有放到真实浏览器里量过才算数 —— 估算高度、中文折行、图片尺寸，
 *      这三件事在 Node 里都测不出来。这里只依赖标准 DOM，于是 tests/browser/board.html
 *      能在真实 Chromium 里用真事件验证（点卡片、捏合、拖动都能测）。
 *   ② 正文怎么渲染是宿主的事：插件里交给 Obsidian 的 MarkdownRenderer（链接、嵌入、
 *      公式、mermaid 全部照常），验证台里换成纯文本。渲染回调因此是参数。
 *
 * 高度是两遍的（与 board-layout.ts 的约定一致）：
 *   先用估算排一次雏形 → 渲染完正文 → 量每张卡的 offsetHeight → 用真实高度重排。
 * 所以调用方必须先把 container 挂进文档（否则量到 0）。
 * ========================================================================== */

import type { BoardDoc, BoardNode } from "./board-model";
import { layoutBoardByMode, linkPath, type BoardLayout, type BoardLayoutMode, type BoardLayoutOptions } from "./board-layout";

export const BOARD_CLASS = "zr-board";
export const BOARD_LINKS_CLASS = "zr-board-links";
export const CARD_CLASS = "zr-card";
export const CARD_HEAD_CLASS = "zr-card-head";
export const CARD_TITLE_CLASS = "zr-card-title";
export const CARD_META_CLASS = "zr-card-meta";
export const CARD_FOCUS_CLASS = "zr-card-focus";
export const CARD_BODY_CLASS = "zr-card-body";
/** 卡片 id 存在这个属性上：命中判定与测试都读它 */
export const CARD_ATTR = "data-zr-card";
/** 根节点上的模式类：CSS 靠它决定显示「版面」还是「白板」那一层 */
export const MODE_PAGE_CLASS = "zr-mode-page";
export const MODE_BOARD_CLASS = "zr-mode-board";

/**
 * 把当前模式写到根节点的类上。
 *
 * **必须在每次渲染之前调用**：这一行曾经漏掉，导致真机上「白板打开一片空白」——
 *   Obsidian 的视图生命周期是 onOpen() → setState()。onOpen 时模式取自设置（默认版面），
 *   类被设成 zr-mode-page；随后 setState 把模式改成白板，却没有人再改类 ——
 *   于是白板被渲染进 display:none 的那一层，用户看到的是**空的版面层**。
 * 结论：可见性不是「建界面时设一次」，而是「每次要往里填内容时都要对齐」。
 */
export function applyModeClasses(root: HTMLElement, mode: "page" | "board"): void {
  root.classList.toggle(MODE_PAGE_CLASS, mode === "page");
  root.classList.toggle(MODE_BOARD_CLASS, mode === "board");
}

export interface BoardRenderOptions extends Partial<Omit<BoardLayoutOptions, "heights">> {
  /** 排版：单栏纵向流（默认，读文档）或分支树（看全局） */
  layout?: BoardLayoutMode;
  /** 是否画父子连线（只对分支树有意义；纵向流靠缩进表达层级） */
  connectors: boolean;
  /** 根卡片标题下的一行元信息（双语由调用方决定） */
  meta?: string;
  /** 正文渲染回调：插件传 MarkdownRenderer，验证台传纯文本 */
  renderBody?: (bodyEl: HTMLElement, node: BoardNode) => void | Promise<void>;
  /** 聚焦按钮的无障碍文案 */
  focusLabel?: string;
}

export interface BoardRenderResult {
  root: HTMLElement;
  layout: BoardLayout;
  cards: Map<string, HTMLElement>;
}

/**
 * 「这次点击落在哪张卡上」——只有卡片头与聚焦按钮算聚焦入口，
 * 正文里的链接保持链接语义（点链接不该把卡片放大到眼前）。
 * 抽成纯函数是为了让插件与浏览器验证台跑同一份判定：验证过的就是发出去的那份。
 */
export function cardIdFromClick(target: Element | null): string | null {
  if (!target) return null;
  const card = target.closest("[" + CARD_ATTR + "]");
  if (!card) return null;
  if (!target.closest("." + CARD_FOCUS_CLASS) && !target.closest("." + CARD_HEAD_CLASS)) return null;
  return card.getAttribute(CARD_ATTR);
}

/** 卡片的聚焦按钮图标：两条向外的对角箭头（与 Obsidian 的 maximize 图标同义）。 */
function buildFocusIcon(doc: Document): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const paths = ["M9 2h5v5", "M7 14H2V9", "M14 2l-5 5", "M2 14l5-5"];
  for (const d of paths) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
  }
  return svg;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * 渲染白板。container 会被清空（幂等），调用前请先把它挂进文档。
 * 返回最终排版（已用真实高度重排过）与卡片元素表，调用方据此做聚焦、命中与持久化。
 */
export async function renderBoardInto(
  doc: BoardDoc,
  container: HTMLElement,
  options: BoardRenderOptions
): Promise<BoardRenderResult> {
  clear(container);
  const ownerDocument = container.ownerDocument;
  const layoutOptions: Partial<BoardLayoutOptions> = {
    cardWidth: options.cardWidth,
    gapX: options.gapX,
    gapY: options.gapY,
    padding: options.padding,
  };

  const root = ownerDocument.createElement("div");
  root.className = BOARD_CLASS;
  container.appendChild(root);

  const links = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  links.setAttribute("class", BOARD_LINKS_CLASS);
  links.setAttribute("aria-hidden", "true");
  root.appendChild(links);

  /* ---- 卡片：先只定宽，位置等量完高度再定 ---- */
  const cards = new Map<string, HTMLElement>();
  const bodies: Array<Promise<void>> = [];
  for (const node of doc.nodes) {
    const card = ownerDocument.createElement("article");
    card.className = CARD_CLASS + " " + CARD_CLASS + "-depth-" + node.depth;
    card.setAttribute(CARD_ATTR, node.id);
    card.setAttribute("data-depth", String(node.depth));
    card.style.width = (layoutOptions.cardWidth || 320) + "px";

    const head = ownerDocument.createElement("header");
    head.className = CARD_HEAD_CLASS;
    const title = ownerDocument.createElement("span");
    title.className = CARD_TITLE_CLASS;
    title.textContent = node.title;
    head.appendChild(title);

    const focus = ownerDocument.createElement("button");
    focus.type = "button";
    focus.className = CARD_FOCUS_CLASS;
    focus.setAttribute("aria-label", options.focusLabel || "Focus this card");
    focus.title = options.focusLabel || "Focus this card";
    focus.appendChild(buildFocusIcon(ownerDocument));
    head.appendChild(focus);
    card.appendChild(head);

    if (node.depth === 0 && options.meta) {
      const meta = ownerDocument.createElement("div");
      meta.className = CARD_META_CLASS;
      meta.textContent = options.meta;
      card.appendChild(meta);
    }

    const body = ownerDocument.createElement("div");
    body.className = CARD_BODY_CLASS + " markdown-rendered";
    card.appendChild(body);
    if (options.renderBody) bodies.push(Promise.resolve(options.renderBody(body, node)));

    root.appendChild(card);
    cards.set(node.id, card);
  }

  await Promise.all(bodies);

  /* ---- 第二遍：量真实高度后重排（中文折行、图片、表格的真实高度只有 DOM 知道） */
  const heights: Record<string, number> = {};
  for (const [id, card] of cards) {
    const height = card.offsetHeight;
    if (height > 0) heights[id] = height;
  }
  const layout = layoutBoardByMode(doc, options.layout || "flow", Object.assign({}, layoutOptions, { heights: heights }));

  for (const [id, card] of cards) {
    const rect = layout.byId[id];
    if (!rect) continue;
    card.style.left = rect.x + "px";
    card.style.top = rect.y + "px";
  }

  root.style.width = layout.width + "px";
  root.style.height = layout.height + "px";
  links.setAttribute("width", String(layout.width));
  links.setAttribute("height", String(layout.height));

  if (options.connectors) {
    for (const link of layout.links) {
      const path = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", linkPath(link));
      path.setAttribute("class", "zr-link");
      path.setAttribute("data-from", link.from);
      path.setAttribute("data-to", link.to);
      links.appendChild(path);
    }
  }

  return { root: root, layout: layout, cards: cards };
}
