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

    /* ⚠ 尺寸必须在【搬移之前】量：节点一旦脱离文档，getBBox() 与
     * getBoundingClientRect() 在 Chromium 里都返回 0 —— 实测踩到过：
     * 钉尺寸那段代码永远拿不到宽高，于是「其它 svg 放大失效」照旧。
     * 现在先量、先钉，再搬。 */
    /* 判据用「鸭子类型」而不是 instanceof：这个文件刻意不依赖 obsidian 模块（要能在真实
     * Chromium 里用真事件验证），而弹窗（popout window）里的元素属于【另一个 realm】——
     * 主窗口的 SVGGraphicsElement 构造器认不出它，instanceof 会静默为 false，
     * 于是弹窗里的图表拿不到像素钉尺寸（表现就是「只有主窗口的图能放大」）。
     * getBBox 有没有，是与 realm 无关的判据。 */
    const graphics = node as Partial<SVGGraphicsElement>;
    if (typeof graphics.getBBox === "function" && typeof graphics.getBoundingClientRect === "function") {
      /* 两份尺寸，用途不同，别混：
       *   ① getBoundingClientRect()：它在【笔记里的实际渲染尺寸】—— 钉这个值，
       *      svg 的缩放比例就与笔记里完全一致，foreignObject 里的 HTML 标签不会重排；
       *   ② getBBox()：图自身的用户单位尺寸 —— 只用来显示「原始尺寸」读数。
       * 早期版本钉的是 ②（getBBox），当主题把图压到版心内（scale<1）时，
       * 钉完等于把图放大回 100% —— 标签按新尺寸重排、撑破外框，就是用户截图里
       * 「放大后编成鬼样子」的根因。 */
      const rendered = graphics.getBoundingClientRect();
      let natural = { width: 0, height: 0 };
      try {
        const box = graphics.getBBox();
        natural = { width: box.width, height: box.height };
      } catch {
        /* 某些渲染器下 getBBox 会抛，退回渲染尺寸 */
      }
      this.naturalWidth = Math.round(natural.width || rendered.width);
      this.naturalHeight = Math.round(natural.height || rendered.height);
      /* 钉住【渲染尺寸】：别的插件画出来的 svg 常常只有 viewBox 或 width="100%"，
       * 放进 width: max-content 的画布后自身尺寸成循环依赖（适配顶到上限、再放大没反应）。 */
      if (rendered.width > 0 && rendered.height > 0) {
        const style = (node as unknown as { style?: CSSStyleDeclaration }).style;
        if (style) {
          style.width = Math.round(rendered.width) + "px";
          style.height = Math.round(rendered.height) + "px";
          style.maxWidth = "none";
        }
      }
    } else {
      const rect = node.getBoundingClientRect();
      this.naturalWidth = Math.round(rect.width);
      this.naturalHeight = Math.round(rect.height);
    }

    this.moved = { node: node, parent: node.parentNode, nextSibling: node.nextSibling };
    const holder = this.doc.createElement("div");
    holder.className = "zr-lightbox-node";
    /* 关键：把图表的「祖先语义」一起带进来。
     * 主题（以及 Obsidian 自己的 app.css）里，图表的文字样式全部挂在 .mermaid 这个类下面：
     * .mermaid svg text / .nodeLabel / .label / .labelText 的字号、颜色、行高。
     * 只搬 <svg> 而不带这个类，图内 HTML 标签（foreignObject 里的 <span>）就会掉回
     * Mermaid 的内联字号 —— 实测表现为标签撑破自己的外框、文字互相覆盖，
     * 也就是用户截图里那张「鬼样子」。这里的 .mermaid 只是语义标记，外观仍由主题决定。 */
    if (node.namespaceURI === SVG_NS) holder.classList.add("mermaid");
    holder.appendChild(node);
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

/* ============================================================================
 * 悬停放大按钮：图片 / 图表右上角的小按钮
 * ---------------------------------------------------------------------------
 * 为什么不「点击图片就放大」：阅读时点击图片本身有别的含义（Obsidian 自己的
 * 图片查看器、选中、拖拽），把放大绑在悬停按钮上更克制 —— 需要时才出现，
 * 也不打扰只想读文字的读者。
 *
 * 实现要点：
 *   ① 单例按钮 + position: fixed，不改变笔记的 DOM 结构（不包一层容器），
 *      因此不会影响 Obsidian 的图片嵌入、链接、拖拽；
 *   ② 只有指针支持悬停（(hover: hover)）时才启用；触屏设备仍然轻点打开；
 *   ③ 滚动 / 改变窗口大小 / 指针离开 → 立即隐藏，按钮永远不会「飘」在错误的位置。
 * ========================================================================== */

export interface ZoomAffordanceOptions {
  images: boolean;
  diagrams: boolean;
  onTarget: (target: LightboxTarget) => void;
  /** 按钮常驻显示（默认 true）。false = 只有指针悬停在图上才出现 */
  persistent?: boolean;
  /** 桌面是否也用「点击图片」作为入口（默认 false：桌面只认悬停按钮） */
  clickToOpen?: boolean;
  /** 是否强制启用悬停按钮（验证台用；真实环境由 matchMedia 判定） */
  forceHover?: boolean;
  /** 按钮文案（无障碍标签） */
  label?: string;
}

interface AffordanceHit {
  target: LightboxTarget;
  /** 用来定位按钮的盒子：图片就是图片本身，图表就是它的容器 */
  box: Element;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** 太小的 svg 多半是图标（callout 图标、按钮图标、行内符号），不该接管。 */
const MIN_DIAGRAM_WIDTH = 96;
const MIN_DIAGRAM_HEIGHT = 48;

/** 判定一个 svg 是不是「值得放大的图」：够大、不是图标、不在链接/按钮里。 */
function isZoomableSvg(svg: Element): boolean {
  if (svg.closest("a, button, .clickable-icon, .callout-icon, .svg-icon, .zr-lightbox, .zr-zoom-affordance")) return false;
  const rect = svg.getBoundingClientRect();
  return rect.width >= MIN_DIAGRAM_WIDTH && rect.height >= MIN_DIAGRAM_HEIGHT;
}

function findAffordanceHit(el: Element, opts: { images: boolean; diagrams: boolean }): AffordanceHit | null {
  if (el.closest("a")) return null;
  if (opts.diagrams) {
    /* 不只 Mermaid：Excalidraw 的内嵌 svg、dataview/charts 画出来的 svg、
     * 笔记里直接写的 <svg> 都算「图」，只要够大就接管。
     * 定位用的盒子优先取图表的容器（按钮落在容器右上角更整齐）。 */
    const svg = el.closest("svg");
    if (svg && isZoomableSvg(svg)) {
      /* 按钮必须挂在【HTML 元素】上：挂在 <svg> 里会被当成 SVG 内容而不渲染
       * （实测：按钮尺寸 0x0，点了没反应）。优先用图表容器，退回父元素，
       * 若父元素仍在 SVG 命名空间里就继续往上爬。 */
      let box: Element = svg.closest(".mermaid, figure, .block-language-chart, .excalidraw-svg") ||
        svg.parentElement ||
        svg;
      while (box.namespaceURI === SVG_NS && box.parentElement) box = box.parentElement;
      return { target: { kind: "diagram", element: svg }, box: box };
    }
  }
  if (opts.images) {
    const img = el.closest("img");
    if (img && img.closest(".markdown-rendered, .markdown-preview-view")) {
      return { target: { kind: "image", element: img }, box: img };
    }
  }
  return null;
}

/** 一个克制的「放大」图标：两条对角箭头，用 createElementNS 画，不引入任何依赖。 */
function buildZoomIcon(doc: Document): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const paths = ["M6 2H2v4", "M10 2h4v4", "M6 14H2v-4", "M10 14h4v-4"];
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

export function installZoomAffordance(doc: Document, opts: ZoomAffordanceOptions): () => void {
  /* 常驻模式是默认：按钮跟着内容走，不用悬停去找 */
  if (opts.persistent !== false) return bindPersistent(doc, opts);

  const win = doc.defaultView;
  const hoverCapable = opts.forceHover === true
    ? true
    : !!(win && typeof win.matchMedia === "function" && win.matchMedia("(hover: hover)").matches);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zr-zoom-affordance";
  button.setAttribute("aria-label", opts.label || "Zoom in");
  button.title = opts.label || "Zoom in";
  button.hidden = true;
  button.appendChild(buildZoomIcon(doc));

  const state = { hit: null as AffordanceHit | null, visible: false };

  const hide = () => {
    if (!state.visible) return;
    state.visible = false;
    button.hidden = true;
  };

  const place = (hit: AffordanceHit) => {
    const rect = hit.box.getBoundingClientRect();
    const size = 26;
    const gap = 6;
    const viewW = win ? win.innerWidth : rect.right + gap;
    const viewH = win ? win.innerHeight : rect.bottom + gap;
    /* 目标滚出视野就干脆不显示，避免按钮留在旧位置「飘」着 */
    if (rect.bottom < 0 || rect.top > viewH || rect.right < 0 || rect.left > viewW) {
      hide();
      return;
    }
    /* 右上角内侧（距边 6px）后，再夹进可视区域：比视口更宽的图
     * （1600px 的图放在 900px 窗口里）右上角在屏幕外，不夹就点不到按钮。 */
    const left = Math.max(gap, Math.min(rect.right - size - gap, viewW - size - gap));
    const top = Math.max(gap, Math.min(rect.top + gap, viewH - size - gap));
    button.style.left = left + "px";
    button.style.top = top + "px";
    button.hidden = false;
    state.visible = true;
  };


  const onOver = (event: Event) => {
    if (!hoverCapable) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === button) return;
    const hit = findAffordanceHit(target, opts);
    if (!hit) return;
    state.hit = hit;
    place(hit);
  };

  const onOut = (event: Event) => {
    if (!hoverCapable) return;
    const related = (event as MouseEvent).relatedTarget;
    if (related instanceof Element && (related === button || button.contains(related))) return;
    const target = event.target;
    if (target instanceof Element && findAffordanceHit(target, opts)) hide();
  };

  const onButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const hit = state.hit;
    hide();
    if (hit) opts.onTarget(hit.target);
  };

  const onClick = (event: MouseEvent) => {
    if (!hoverCapable || opts.clickToOpen === true) {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element) || target === button) return;
      const hit = findAffordanceHit(target, opts);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      opts.onTarget(hit.target);
    }
  };

  doc.addEventListener("mouseover", onOver, { capture: true });
  doc.addEventListener("mouseout", onOut, { capture: true });
  doc.addEventListener("click", onClick, { capture: true });
  doc.addEventListener("scroll", hide, { capture: true, passive: true });
  button.addEventListener("click", onButtonClick);
  doc.body.appendChild(button);
  if (win) win.addEventListener("resize", hide);
  const teardown = () => {
    doc.removeEventListener("mouseover", onOver, { capture: true });
    doc.removeEventListener("mouseout", onOut, { capture: true });
    doc.removeEventListener("click", onClick, { capture: true });
    doc.removeEventListener("scroll", hide, { capture: true });
    button.removeEventListener("click", onButtonClick);
    if (win) win.removeEventListener("resize", hide);
    if (button.parentNode) button.parentNode.removeChild(button);
  };
  return teardown;
}
/* ============================================================================
 * 常驻模式：每张图片 / 每个图表自己带一个右上角按钮
 * ---------------------------------------------------------------------------
 * 为什么改成常驻：悬停模式要求鼠标停在图上按钮才出现，指针一离开就消失 ——
 * 想点的时候正好没有。常驻按钮跟着内容走，滚动、缩放、重排都不会错位。
 *
 * 实现方式：把目标包一层 .zr-zoom-host（position: relative），按钮绝对定位在
 * 它的右上角。这样不需要任何滚动/尺寸监听，天然跟随内容。
 * 代价是会改动笔记的 DOM，所以做了三件事保证可逆与幂等：
 *   ① 每个目标只包一次（data-zr-zoom-bound 标记）；
 *   ② 插件卸载时逐个还原（把目标放回原来的父节点，删掉包装与按钮）；
 *   ③ 用一个 150ms 防抖的 MutationObserver 增量补齐（阅读视图重渲染后自动重挂）。
 * ========================================================================== */

const HOST_CLASS = "zr-zoom-host";
const BOUND_ATTR = "data-zr-zoom-bound";

interface BoundTarget {
  host: HTMLElement;
  target: Element;
  button: HTMLButtonElement;
  /** 是否为目标包了一层（图片会，svg 不会） */
  wrapped: boolean;
}

function bindPersistent(doc: Document, opts: ZoomAffordanceOptions): () => void {
  const bound: BoundTarget[] = [];
  let timer: number | null = null;
  const win = doc.defaultView;

  const addButton = (target: Element, hit: AffordanceHit) => {
    const isSvg = target.tagName.toLowerCase() === "svg";
    let host: HTMLElement;
    let wrapped = false;
    if (isSvg) {
      /* svg 不包装：把它套进 inline-block 的包装后，width:auto / width:100% 的 svg
       * 会塌成 0 宽（尺寸依赖包装、包装依赖内容，循环）—— 实测踩到过。
       * 直接用它的容器（.mermaid / figure / block-language-* / 父元素）当定位上下文，
       * 只加一个 position: relative，不改变任何布局。 */
      host = hit.box as HTMLElement;
      host.classList.add(HOST_CLASS);
    } else {
      const parent = target.parentNode;
      if (!parent) return;
      const span = doc.createElement("span");
      /* 两个类：HOST_CLASS 只做定位上下文，-wrap 才 inline-block。
       * 图表容器只加前者，否则容器变 inline-block 后，width:100% 的 svg 会塌成 0 宽。 */
      span.className = HOST_CLASS + " " + HOST_CLASS + "-wrap";
      parent.insertBefore(span, target);
      span.appendChild(target);
      host = span;
      wrapped = true;
    }

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zr-zoom-affordance zr-zoom-affordance-inline";
    button.setAttribute("aria-label", opts.label || "Zoom in");
    button.title = opts.label || "Zoom in";
    button.appendChild(buildZoomIcon(doc));
    button.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      opts.onTarget({ kind: isSvg ? "diagram" : "image", element: target });
    });
    host.appendChild(button);
    target.setAttribute(BOUND_ATTR, "1");
    bound.push({ host: host, target: target, button: button, wrapped: wrapped });
  };

  const scan = () => {
    const body = doc.body;
    if (!body) return;
    const candidates = body.querySelectorAll("svg, img");
    for (const el of Array.from(candidates)) {
      if (el.getAttribute(BOUND_ATTR) === "1") continue;
      if (el.closest(".zr-lightbox, .zr-zoom-affordance")) continue;
      const hit = findAffordanceHit(el, opts);
      if (hit) addButton(el, hit);
    }
  };

  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      scan();
    }, 150);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  scan();

  const teardown = () => {
    observer.disconnect();
    if (timer !== null) window.clearTimeout(timer);
    for (const item of bound) {
      /* 还原现场：包装过的放回原位并删掉包装；没包装的（svg）只摘掉类 */
      if (item.wrapped) {
        const parent = item.host.parentNode;
        if (parent) {
          parent.insertBefore(item.target, item.host);
          parent.removeChild(item.host);
        }
      } else {
        item.host.classList.remove(HOST_CLASS);
      }
      item.target.removeAttribute(BOUND_ATTR);
      item.button.remove();
    }
    bound.length = 0;
    void win;
  };
  return teardown;
}
