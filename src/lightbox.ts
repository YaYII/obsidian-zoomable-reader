/* ============================================================================
 * Zoomable Reader · 图片/图表查看器（灯箱）
 * ---------------------------------------------------------------------------
 * 场景（来自真实用户诉求）：笔记里嵌着 4K 截图，正文里只看得到缩略图大小，
 * 读的时候想「临时放大看清细节，看完立刻回到笔记」。
 *
 * 设计要点：
 *   ① 不依赖 obsidian 模块：只拿一个 ownerDocument 与一个被查看的元素，
 *      于是同一份代码能在真实 Chromium 里用真事件验证（tests/browser/lightbox.html）。
 *   ② 复用 ZoomPanLayer：滚轮/拖动/双指/双击全部与板子同一套手势实现，不写第二份。
 *   ③ 图表（Mermaid 的 <svg>）用【搬移】而不是克隆：主题的样式里有 #id 选择器，
 *      克隆会丢样式；搬移并在关闭时放回原位，样式与语义都保持原样。
 *   ④ 打开即「适配窗口」，同时显示原始尺寸与当前比例 —— 用户知道自己看的是多大。
 * ========================================================================== */

import { Transform, ZoomPanLayer, formatPercent } from "./zoom-pan";

export interface LightboxOptions {
  fitOnOpen?: boolean;
  maxScale?: number;
  /** 打开/关闭时的回调（插件可用来挂设置或埋点，本插件不联网） */
  onOpen?: () => void;
  onClose?: () => void;
}

interface MovedNode {
  node: Element;
  parent: Node;
  nextSibling: Node | null;
}

export class ImageLightbox {
  private doc: Document;
  private opts: LightboxOptions;
  private root: HTMLElement | null = null;
  private layer: ZoomPanLayer | null = null;
  private labelEl: HTMLElement | null = null;
  private sizeEl: HTMLElement | null = null;
  private moved: MovedNode | null = null;
  private naturalWidth = 0;
  private naturalHeight = 0;
  private cleanup: Array<() => void> = [];
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(doc: Document, options: LightboxOptions = {}) {
    this.doc = doc;
    this.opts = options;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** 打开一张 <img>（用它的自然尺寸放大查看）。 */
  openImage(img: HTMLImageElement): void {
    const src = img.currentSrc || img.src;
    if (!src) return;
    const probe = this.doc.createElement("img");
    probe.className = "zr-lightbox-image";
    probe.alt = img.alt || "";
    /* 禁掉浏览器原生的图片拖拽：我们要的是「拖动平移」，
     * 原生 drag 会打断指针序列，手势就断了 */
    probe.draggable = false;
    const onLoad = () => {
      this.naturalWidth = probe.naturalWidth || 0;
      this.naturalHeight = probe.naturalHeight || 0;
      this.afterContentReady();
    };
    probe.addEventListener("load", onLoad, { once: true });
    probe.src = src;
    this.build(probe, img);
    if (probe.complete) onLoad();
  }

  /** 打开一个图表：把原来的节点搬进查看器，关闭时放回原位（保住 #id 作用域样式）。 */
  openNode(node: Element, meta?: { title?: string }): void {
    if (!node.parentNode) return;
    this.moved = { node: node, parent: node.parentNode, nextSibling: node.nextSibling };
    const holder = this.doc.createElement("div");
    holder.className = "zr-lightbox-node";
    holder.appendChild(node);
    if (node instanceof SVGGraphicsElement) {
      try {
        const b = node.getBBox();
        this.naturalWidth = Math.round(b.width);
        this.naturalHeight = Math.round(b.height);
      } catch {
        /* 未挂载时 getBBox 会抛，忽略即可 */
      }
    }
    if (meta && meta.title) holder.setAttribute("data-title", meta.title);
    this.build(holder, node);
  }

  close(): void {
    if (!this.root) return;
    if (this.layer) {
      this.layer.destroy();
      this.layer = null;
    }
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    /* 把搬走的图表放回它原来的位置 */
    if (this.moved) {
      const { node, parent, nextSibling } = this.moved;
      if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(node, nextSibling);
      else parent.appendChild(node);
      this.moved = null;
    }
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.labelEl = null;
    this.sizeEl = null;
    if (this.doc.body) this.doc.body.classList.remove("zr-lightbox-open");
    if (this.opts.onClose) this.opts.onClose();
  }

  /* ------------------------------------------------------------------ 内部 */

  private build(content: Element, focusReturn: Element): void {
    if (this.root) this.close();
    const body = this.doc.body;
    if (!body) return;

    const root = this.doc.createElement("div");
    root.className = "zr-lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    const bar = this.doc.createElement("div");
    bar.className = "zr-lightbox-toolbar";

    const viewport = this.doc.createElement("div");
    viewport.className = "zr-lightbox-viewport";

    const canvas = this.doc.createElement("div");
    canvas.className = "zr-lightbox-canvas";
    canvas.appendChild(content);
    viewport.appendChild(canvas);

    bar.appendChild(this.button("minus", "Zoom out", () => this.layer && this.layer.zoomBy(1 / 1.25)));
    const label = this.doc.createElement("button");
    label.type = "button";
    label.className = "zr-lightbox-label";
    label.title = "Back to 100%";
    label.textContent = "100%";
    label.addEventListener("click", () => this.setActualSize());
    bar.appendChild(label);
    bar.appendChild(this.button("plus", "Zoom in", () => this.layer && this.layer.zoomBy(1.25)));
    bar.appendChild(this.button("move-horizontal", "Fit to window", () => this.fit()));
    bar.appendChild(this.button("scan", "Actual size (100%)", () => this.setActualSize()));

    const size = this.doc.createElement("span");
    size.className = "zr-lightbox-size";
    bar.appendChild(size);

    bar.appendChild(this.button("x", "Close (Esc)", () => this.close()));

    root.appendChild(bar);
    root.appendChild(viewport);
    /* 先把内部状态与手势层建好，最后才挂到 DOM 上：
     * 这样任何一步抛错都不会在页面上留下一个「半成品浮层」——验证台就是这么
     * 抓到过一次：过去用 Obsidian 专有的 body.addClass()，在普通浏览器里直接抛，
     * 浮层已经进了 DOM 但 this.root 还是 null，于是按钮、滚轮、ESC 全部失效。 */
    this.root = root;
    this.labelEl = label;
    this.sizeEl = size;

    this.layer = new ZoomPanLayer(viewport, canvas, {
      maxScale: this.opts.maxScale === undefined ? 8 : this.opts.maxScale,
      onCommit: (t) => this.updateReadout(t),
    });

    body.appendChild(root);
    body.classList.add("zr-lightbox-open");

    /* 背景点击关闭（点在画布内容上不关） */
    const onBackground = (event: MouseEvent) => {
      if (event.target === viewport || event.target === root) this.close();
    };
    viewport.addEventListener("click", onBackground);
    this.cleanup.push(() => viewport.removeEventListener("click", onBackground));

    /* Esc 关闭；+/-/0 缩放（键盘事件挂在 document 上，与板子一致） */
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (!this.layer) return;
      if (event.key === "+" || event.key === "=") this.layer.zoomBy(1.25);
      else if (event.key === "-") this.layer.zoomBy(1 / 1.25);
      else if (event.key === "0") this.setActualSize();
    };
    this.doc.addEventListener("keydown", this.keyHandler);
    this.cleanup.push(() => {
      if (this.keyHandler) this.doc.removeEventListener("keydown", this.keyHandler);
    });

    fs_focus(focusReturn);
    if (this.opts.fitOnOpen === false) this.setActualSize();
    else this.afterContentReady();
    if (this.opts.onOpen) this.opts.onOpen();
  }

  /** 内容尺寸已知后再决定初始比例：适配窗口，并把读数显示出来。 */
  private afterContentReady(): void {
    if (!this.layer) return;
    if (this.opts.fitOnOpen === false) this.setActualSize();
    else this.fit();
  }

  private fit(): void {
    if (!this.layer || !this.root) return;
    this.layer.fitWidth(24);
    this.updateReadout(this.layer.transform);
  }

  private setActualSize(): void {
    if (!this.layer) return;
    this.layer.reset(16);
    this.updateReadout(this.layer.transform);
  }

  private updateReadout(t: Transform): void {
    if (this.labelEl) this.labelEl.textContent = formatPercent(t.scale);
    if (this.sizeEl) {
      const w = this.naturalWidth ? Math.round(this.naturalWidth) : 0;
      const h = this.naturalHeight ? Math.round(this.naturalHeight) : 0;
      const dims = w && h ? w + " x " + h + " px" : "";
      const shown = w && h ? Math.round(w * t.scale) + " x " + Math.round(h * t.scale) + " px" : "";
      this.sizeEl.textContent = dims && shown ? dims + " → " + shown : dims;
    }
  }

  private button(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "zr-lightbox-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.textContent = ICONS[icon] || "?";
    button.addEventListener("click", onClick);
    return button;
  }
}

/* 用字符画图标而不是引入 svg 依赖：查看器只有 6 个按钮，字符在明暗主题下都能看清，
 * 也不必把 Obsidian 的 setIcon 带进这个不依赖 obsidian 的模块。 */
const ICONS: Record<string, string> = {
  minus: "−",
  plus: "+",
  "move-horizontal": "⇔",
  scan: "1:1",
  x: "×",
};

/** 关闭后把焦点还给触发元素（键盘用户不迷路） */
function fs_focus(el: Element): void {
  const focusable = el as unknown as { focus?: () => void };
  if (typeof focusable.focus === "function") {
    try {
      focusable.focus();
    } catch {
      /* 元素可能已不可聚焦，忽略 */
    }
  }
}

/* ============================================================================
 * 点击委派：判定「点子上的东西该不该打开查看器」
 * ---------------------------------------------------------------------------
 * 抽成独立函数而不是写死在插件里，是为了能在真实浏览器里用真点击验证
 * （插件那层只负责把 activeDocument 与设置传进来）。
 * 三条规则都来自踩坑：
 *   ① 链接里的图片不接管 —— 那是导航意图；
 *   ② 只在正文区域（.markdown-rendered / .markdown-preview-view）生效，
 *      不去抢设置页、侧栏、文件列表里的图片；
 *   ③ 图表以 .mermaid svg 为准，且优先于图片（图表里也可能有 <image>）。
 * ========================================================================== */

export interface LightboxTarget {
  kind: "image" | "diagram";
  element: Element;
}

export interface LightboxClickOptions {
  images: boolean;
  diagrams: boolean;
}

export function findLightboxTarget(target: EventTarget | null, opts: LightboxClickOptions): LightboxTarget | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("a")) return null;
  if (opts.diagrams) {
    const svg = target.closest(".mermaid svg");
    if (svg) return { kind: "diagram", element: svg };
  }
  if (opts.images) {
    const img = target.closest("img");
    if (img && img.closest(".markdown-rendered, .markdown-preview-view")) {
      return { kind: "image", element: img };
    }
  }
  return null;
}

/** 挂上点击委派，返回一个解绑函数（插件用 register() 收口，验证台手动调用）。 */
export function registerLightboxClicks(
  doc: Document,
  opts: LightboxClickOptions & { onTarget: (target: LightboxTarget) => void }
): () => void {
  const handler = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const found = findLightboxTarget(event.target, opts);
    if (!found) return;
    /* 捕获阶段就拦住：Obsidian 自己也响应图片点击，不拦会弹出两个查看器 */
    event.preventDefault();
    event.stopPropagation();
    opts.onTarget(found);
  };
  doc.addEventListener("click", handler, { capture: true });
  return () => doc.removeEventListener("click", handler, { capture: true });
}
