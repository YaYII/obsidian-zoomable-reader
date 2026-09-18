import { Component, ItemView, MarkdownView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ZoomableReaderPlugin from "../main";
import { foldToFit, parseBoard, type BoardDoc } from "./board-model";
import { DEFAULT_BOARD_LAYOUT } from "./board-layout";
import { applyModeClasses, cardIdFromClick, renderBoardInto, type BoardRenderResult } from "./board-render";
import type { ReaderMode } from "./settings-spec";
import { BOARD_MIN_SCALE, ZOOM_STEP, ZoomPanLayer, formatPercent, type Transform } from "./zoom-pan";

export const VIEW_TYPE_ZOOMABLE_READER = "zoomable-reader-view";

/** 主题没给出行宽时的兜底宽度（与多数主题的 700~760px 版心一致） */
const FALLBACK_LINE_WIDTH = 760;
const MIN_PAGE_WIDTH = 240;

/**
 * 把一篇笔记渲染进「可平移 + 可缩放」的画布。两种模式：
 *
 *   ① 版面模式（page）—— 整页笔记渲染成一张纸，放在可缩放的板子上。
 *      适合宽表格、宽图、4K 截图：放大看细节，其余与阅读视图一致。
 *   ② 白板模式（board）—— 把 Markdown【编译】成卡片画布：每个标题一张卡，
 *      卡里是这一节的正文，父卡与子卡之间画连线。手机上一眼看到全局结构，
 *      捏合放大后读细节；点卡片标题还能直接把这张卡放到眼前。
 *
 * 为什么不是「给阅读视图加缩放」：Obsidian 的阅读视图是 WebView 页面，整页缩放由
 * 应用的原生配置决定（Capacitor 的 zoomEnabled 默认关闭），CSS 与主题都改不了它。
 * 所以这里换一条路 —— 自己起一个视图，把 Markdown 渲染进一个可变换（transform）
 * 的容器，手势由插件自己处理。这也是本插件存在的原因。
 */
export class ZoomableReaderView extends ItemView {
  plugin: ZoomableReaderPlugin;
  private layer: ZoomPanLayer | null = null;
  private viewportEl: HTMLElement | null = null;
  private canvasEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private boardHostEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private board: BoardRenderResult | null = null;
  private doc: BoardDoc | null = null;
  private file: TFile | null = null;
  private mode: ReaderMode = "page";
  private renderComponent: Component | null = null;
  private observer: ResizeObserver | null = null;
  private animTimer: number | null = null;
  private rerenderTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ZoomableReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ZOOMABLE_READER;
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : "Zoomable Reader";
  }

  getIcon(): string {
    return this.mode === "board" ? "layout-grid" : "zoom-in";
  }

  async onOpen(): Promise<void> {
    this.mode = this.plugin.settings.defaultMode;
    this.buildUi();
    this.registerKeys();
  }

  async onClose(): Promise<void> {
    this.plugin.flushPositions();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.animTimer !== null) window.clearTimeout(this.animTimer);
    if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
    if (this.layer) {
      this.layer.destroy();
      this.layer = null;
    }
  }

  getState(): Record<string, unknown> {
    return { file: this.file ? this.file.path : null, mode: this.mode };
  }

  async setState(state: unknown, result: unknown): Promise<void> {
    const obj = state && typeof state === "object" ? (state as { file?: string; mode?: ReaderMode }) : {};
    if (obj.mode === "page" || obj.mode === "board") this.mode = obj.mode;
    if (obj.file) {
      const file = this.app.vault.getAbstractFileByPath(obj.file);
      if (file instanceof TFile) {
        await this.renderFile(file);
        return;
      }
    }
    const active = this.app.workspace.getActiveFile();
    if (active) await this.renderFile(active);
    void result;
  }

  /* ------------------------------------------------------------------ 界面 */

  private buildUi(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("zr-root");
    applyModeClasses(root, this.mode);

    if (this.plugin.settings.showToolbar) {
      const bar = root.createDiv({ cls: "zr-toolbar" });
      this.makeButton(bar, "minus", "缩小 / Zoom out", () => this.zoom(-1));
      this.labelEl = bar.createEl("button", { cls: "zr-label", attr: { type: "button", title: "复位到 100% / reset to 100%" } });
      this.labelEl.setText("100%");
      this.registerDomEvent(this.labelEl, "click", () => this.resetView());
      this.makeButton(bar, "plus", "放大 / Zoom in", () => this.zoom(1));
      if (this.mode === "board") {
        this.makeButton(bar, "scan", "回到全图 / Fit the whole board", () => this.fitBoard());
        this.makeButton(bar, "focus", "回到标题卡 / Back to the title card", () => this.focusRoot());
        this.makeButton(bar, "refresh-cw", "重新编译 / Recompile now", () => void this.recompile());
      } else {
        this.makeButton(bar, "move-horizontal", "适配宽度 / Fit width", () => {
          if (this.layer) this.layer.fitWidth(this.plugin.settings.padding);
        });
      }
      this.makeButton(bar, "maximize", "复位 / Reset", () => this.resetView());
      const toggle = this.makeButton(
        bar,
        this.mode === "board" ? "file-text" : "layout-grid",
        this.mode === "board" ? "切回版面模式 / Back to page mode" : "白板模式：把这篇笔记编译成卡片 / Whiteboard mode",
        () => void this.setMode(this.mode === "board" ? "page" : "board")
      );
      toggle.addClass("zr-btn-end");
    } else {
      this.labelEl = null;
    }

    this.viewportEl = root.createDiv({ cls: "zr-viewport" });
    this.canvasEl = this.viewportEl.createDiv({ cls: "zr-canvas" });
    /* 两个类名都加上：markdown-rendered 让主题的正文排版生效，
     * markdown-preview-view 让「阅读视图」那一层样式（行宽、内边距）也生效 ——
     * 于是版面模式看起来就是用户主题的阅读视图，只是多了缩放。 */
    this.pageEl = this.canvasEl.createDiv({ cls: "markdown-preview-view markdown-rendered zr-page" });
    this.boardHostEl = this.canvasEl.createDiv({ cls: "zr-board-host" });

    this.createLayer();

    /* 视口尺寸变化（手机转屏、侧栏开关）时重新算版心宽度 */
    this.observer = new ResizeObserver(() => this.applyPageWidth());
    this.observer.observe(this.viewportEl);

    /* 点卡片标题 / 聚焦按钮 = 把这张卡放到眼前。
     * 拖动之后的点击会被手势层吃掉（onClickCapture），所以这里只会收到真正的点击。 */
    this.registerDomEvent(this.boardHostEl, "click", (event) => this.onBoardClick(event));

    /* 动画期间（聚焦卡片）不要跟随手指，一按下就撤掉过渡 */
    this.registerDomEvent(
      this.viewportEl,
      "pointerdown",
      () => {
        if (this.viewportEl) this.viewportEl.removeClass("zr-animating");
      },
      { capture: true }
    );

    /* 只读视图也要「跟着变」：笔记保存了、或另一个标签页里正在改字，
     * 白板自动重新编译（节流 400ms，避免每敲一个字就整块重排）。
     * 这样「点白板 = 现读现编译」在打开期间也一直成立。 */
    this.registerEvent(
      this.app.vault.on("modify", (changed) => {
        if (this.mode !== "board" || !this.file || changed.path !== this.file.path) return;
        this.scheduleRerender(400);
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (this.mode !== "board" || !this.file) return;
        if (!info || !info.file || info.file.path !== this.file.path) return;
        this.scheduleRerender(400);
      })
    );
  }

  /** 键盘：+ / - / 0，与多数看图工具一致。
   * 只在 onOpen 注册一次 —— 放在 buildUi 里会在每次切换模式时又注册一遍，
   * 同一个键被处理两次（放大一下变两下）。 */
  private registerKeys(): void {
    const scope = this.scope;
    if (!scope) return;
    const keys: Array<[string, () => void]> = [
      ["+", () => this.zoom(1)],
      ["=", () => this.zoom(1)],
      ["-", () => this.zoom(-1)],
      ["0", () => this.resetView()],
    ];
    for (const [key, action] of keys) {
      scope.register([], key, (event) => {
        action();
        event.preventDefault();
        return false;
      });
    }
  }

  /** 建手势层：白板允许缩到更小（要能一眼看全），版面模式保持原来的下限。 */
  private createLayer(): void {
    if (!this.viewportEl || !this.canvasEl) return;
    const previous = this.layer ? this.layer.transform : null;
    if (this.layer) {
      this.layer.destroy();
      this.layer = null;
    }
    this.layer = new ZoomPanLayer(this.viewportEl, this.canvasEl, {
      minScale: this.mode === "board" ? BOARD_MIN_SCALE : undefined,
      maxScale: this.plugin.settings.maxScale,
      doubleTapZoom: this.plugin.settings.doubleTapZoom,
      pinch: this.plugin.settings.pinchZoom,
      pinchSensitivity: this.plugin.settings.pinchSensitivity,
      onCommit: (t) => this.onTransform(t),
    });
    if (previous) this.layer.setTransform(previous, false);
  }

  private makeButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
    const button = parent.createEl("button", {
      cls: "zr-btn",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    this.registerDomEvent(button, "click", onClick);
    return button;
  }

  private get padding(): number {
    return this.plugin.settings.padding;
  }

  private zoom(direction: number): void {
    if (!this.layer) return;
    const focal = this.viewportEl
      ? { x: this.viewportEl.clientWidth / 2, y: this.viewportEl.clientHeight / 2 }
      : undefined;
    this.layer.zoomBy(direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, focal);
  }

  private resetView(): void {
    if (this.layer) this.layer.reset(this.padding);
  }

  /** 白板：把整块白板缩进视口（「回到全图」）。 */
  private fitBoard(): void {
    if (!this.layer || !this.board) return;
    this.animateOnce();
    this.layer.focusRect({ x: 0, y: 0, width: this.board.layout.width, height: this.board.layout.height }, 16);
  }

  /** 白板：回到根卡（笔记标题卡）。 */
  private focusRoot(): void {
    if (!this.doc) return;
    this.focusCard(this.doc.rootId);
  }

  /** 白板：把某张卡放到眼前。 */
  private focusCard(id: string, animate: boolean = true): void {
    const card = this.board ? this.board.layout.byId[id] : null;
    if (!card || !this.layer) return;
    if (animate) this.animateOnce();
    /* 聚焦时留一点余量：卡片宽度铺满视口会挤掉圆角与阴影，读起来也更喘 */
    this.layer.focusRect(card, this.mode === "board" ? 32 : 16);
  }

  private animateOnce(): void {
    const viewport = this.viewportEl;
    if (!viewport) return;
    viewport.addClass("zr-animating");
    if (this.animTimer !== null) window.clearTimeout(this.animTimer);
    this.animTimer = window.setTimeout(() => {
      viewport.removeClass("zr-animating");
      this.animTimer = null;
    }, 260);
  }

  private onBoardClick(event: MouseEvent): void {
    /* 判定在 board-render.ts 里（同一个函数在真实浏览器验证台里也被验证）：
     * 只有卡片头与聚焦按钮是入口，正文里的链接保持链接的语义。 */
    const id = cardIdFromClick(event.target instanceof Element ? event.target : null);
    if (id) this.focusCard(id);
  }

  private onTransform(t: Transform): void {
    if (this.labelEl) this.labelEl.setText(formatPercent(t.scale));
    if (this.file && this.plugin.settings.rememberPosition) {
      this.plugin.rememberPosition(this.file.path, this.mode, t, this.plugin.settings.boardCardWidth);
    }
  }

  /* ------------------------------------------------------------------ 模式 */

  /** 切换模式：立刻重渲染，并把选择记成默认（下次打开也是这样）。 */
  async setMode(mode: ReaderMode): Promise<void> {
    if (mode === this.mode) return;
    this.mode = mode;
    this.plugin.rememberMode(mode);
    this.buildUi();
    if (this.file) await this.renderFile(this.file);
  }

  /** 设置变更后的局部刷新：只重建必要的东西，避免滑块每动一下整页重排。 */
  applySettingChange(key: string): void {
    const layerKeys = ["pinchZoom", "pinchSensitivity", "doubleTapZoom", "maxScale"];
    if (layerKeys.includes(key)) {
      this.createLayer();
      return;
    }
    this.scheduleRerender();
  }

  /** 重新编译当前白板（工具条上的「重新编译」按钮走它）。
   * 每次进白板、每次笔记改动都会重新编译一遍 —— 只读视图，不落盘、不缓存。 */
  async recompile(): Promise<void> {
    if (this.file) await this.renderFile(this.file);
  }

  private scheduleRerender(delay: number = 220): void {
    if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
    this.rerenderTimer = window.setTimeout(() => {
      this.rerenderTimer = null;
      const file = this.file;
      if (!file) return;
      const transform = this.layer ? this.layer.transform : null;
      void this.renderFile(file).then(() => {
        if (transform && this.layer) this.layer.setTransform(transform, false);
      });
    }, delay);
  }

  /* ------------------------------------------------------------------ 渲染 */

  async renderFile(file: TFile): Promise<void> {
    this.file = file;
    /* 渲染前先让「要填的这一层」变成可见的那一层。
     * 这里不是多余的保险：真机上 setState 会把模式改成白板，而类是在 onOpen 时
     * 按设置（默认版面）设好的 —— 漏这一步，白板就渲染进了 display:none 的层里，
     * 用户看到一片空白（1.3.0 的真实 bug，见 board-render.ts 的注释）。 */
    applyModeClasses(this.contentEl, this.mode);
    if (this.mode === "board") await this.renderBoard(file);
    else await this.renderPage(file);
    this.updateTitle();
  }

  private disposeRenderComponent(): void {
    if (this.renderComponent) {
      this.removeChild(this.renderComponent);
      this.renderComponent = null;
    }
  }

  private beginRenderComponent(): Component {
    this.disposeRenderComponent();
    const component = new Component();
    this.addChild(component);
    this.renderComponent = component;
    return component;
  }

  /** 版面模式：整页笔记渲染成一张纸，放在可缩放的板子上。 */
  private async renderPage(file: TFile): Promise<void> {
    const page = this.pageEl;
    if (!page) return;
    const component = this.beginRenderComponent();

    this.board = null;
    this.doc = null;
    page.empty();
    const markdown = await this.app.vault.cachedRead(file);
    await MarkdownRenderer.render(this.app, markdown, page, file.path, component);

    this.applyPageWidth();
    const saved = this.plugin.settings.rememberPosition ? this.plugin.getPosition(file.path, "page") : null;
    if (this.layer) {
      if (saved) this.layer.setTransform(saved);
      else this.layer.reset(this.padding);
    }
  }

  /**
   * 取「此刻的正文」。
   *
   * 白板是【查看】而不是编辑：每次进白板都重新编译一遍，代价小、心里有底。
   * 所以刻意不用 cachedRead（它有缓存，改完字白板可能还是旧的）：
   *   ① 文件同时开在某个 Markdown 标签页里 → 直接读编辑器里的实时文本（含还没保存的改动）；
   *   ② 否则读一遍文件本体。
   */
  private async readSource(file: TFile): Promise<string> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file && view.file.path === file.path) {
        return view.editor.getValue();
      }
    }
    return this.app.vault.read(file);
  }

  /** 白板模式：把 Markdown 编译成卡片画布（标题成卡、正文成块、大纲成连线）。 */
  private async renderBoard(file: TFile): Promise<void> {
    const host = this.boardHostEl;
    if (!host) return;
    const component = this.beginRenderComponent();

    const markdown = await this.readSource(file);
    const parsed = parseBoard(markdown, { title: file.basename });
    const fitted = foldToFit(parsed, this.plugin.settings.boardMaxDepth, this.plugin.settings.boardMaxCards);
    this.doc = fitted.doc;

    const gap = this.plugin.settings.boardGap;
    let rendered: BoardRenderResult;
    try {
      rendered = await renderBoardInto(fitted.doc, host, {
        cardWidth: this.plugin.settings.boardCardWidth,
        gapX: Math.round(gap * 2.5),
        gapY: gap,
        padding: DEFAULT_BOARD_LAYOUT.padding,
        connectors: this.plugin.settings.boardConnectors,
        meta: this.boardMeta(fitted.doc, parsed.nodes.length, fitted.depth),
        focusLabel: "放大到这张卡 / Zoom to this card",
        renderBody: (bodyEl, node) => {
          const body = node.blocks.map((block) => block.markdown).join("\n\n");
          if (!body) return Promise.resolve();
          return MarkdownRenderer.render(this.app, body, bodyEl, file.path, component);
        },
      });
    } catch (error) {
      /* 手机上打不开控制台，所以失败必须【看得见】：给一条通知，别静默留一块空白。
       * 这样用户至少知道发生了什么，也能把那句话回报过来。 */
      this.board = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Zoomable Reader: 白板渲染失败", error);
      new Notice("白板渲染失败 / Whiteboard failed: " + message);
      return;
    }
    this.board = rendered;

    /* 首次打开（没有存过位置）：按【原大】显示 —— A5 宽 148mm 就是一张纸的尺寸。
     * 以前这里聚焦到标题卡，而标题卡只有标题与「N 张卡片」那一行，于是屏幕中间只有一小块，
     * 用户实测反馈「白板看起来尺寸很小」。
     * 白板本来就能捏合缩放，默认宁可按纸的真实尺寸给，让用户自己缩，而不是替他缩好。 */
    const saved = this.plugin.settings.rememberPosition
      ? this.plugin.getPosition(file.path, "board", this.plugin.settings.boardCardWidth)
      : null;
    if (!this.layer) return;
    if (saved) this.layer.setTransform(saved);
    else this.layer.reset(this.padding);
  }

  /** 根卡上的一行元信息：这张白板有多少卡、展开到第几层。 */
  private boardMeta(doc: BoardDoc, originalCount: number, depth: number): string {
    const folded = originalCount > doc.nodes.length;
    const zh = doc.nodes.length + " 张卡片 · 展开到 H" + depth + (folded ? "（更深的层级已折进卡片）" : "");
    const en = doc.nodes.length + " cards, outline depth H" + depth + (folded ? " (deeper headings folded in)" : "");
    return zh + "  ·  " + en;
  }

  /** 版心宽度 = min(主题行宽, 视口宽度)。手机上于是「100% 就是一屏宽」，
   * 放大只是把手势交回给用户 —— 而不是先缩到看不清再让你放大。 */
  private applyPageWidth(): void {
    const page = this.pageEl;
    const viewport = this.viewportEl;
    if (!page || !viewport) return;
    const available = Math.max(MIN_PAGE_WIDTH, viewport.clientWidth - this.padding * 2);
    const width = Math.min(this.themeLineWidth(), available);
    page.style.width = width + "px";
  }

  /** 读取主题的正文行宽（--file-line-width 是 Obsidian 的公开变量）。 */
  private themeLineWidth(): number {
    const styles = getComputedStyle(this.contentEl);
    const candidates = ["--file-line-width", "--line-width"];
    for (const name of candidates) {
      const value = styles.getPropertyValue(name).trim();
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= MIN_PAGE_WIDTH) return parsed;
    }
    return FALLBACK_LINE_WIDTH;
  }

  private updateTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    if (typeof leaf.updateHeader === "function") leaf.updateHeader();
  }
}
