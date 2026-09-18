import { Component, ItemView, MarkdownView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ZoomableReaderPlugin from "../main";
import type { ReaderMode } from "./settings-spec";
import { BOARD_MIN_SCALE, ZOOM_STEP, ZoomPanLayer, formatPercent, type Transform } from "./zoom-pan";

export const VIEW_TYPE_ZOOMABLE_READER = "zoomable-reader-view";

/** 主题没给出行宽时的兜底宽度（与多数主题的 700~760px 版心一致） */
const FALLBACK_LINE_WIDTH = 760;
const MIN_PAGE_WIDTH = 240;

/**
 * 把一篇笔记渲染进「可平移 + 可缩放」的画布。两种模式，区别只有一个：版面的宽度。
 *
 *   ① 版面模式（page）—— 跟随主题行宽（多数主题 700~760px），看起来就是阅读视图。
 *   ② 白板模式（board）—— 整篇笔记渲染成【一张】1280px 宽的版面（网页版心宽），
 *      放在板子上：往下滑就是往下读，宽表格与长图不再挤在窄版心里。
 *
 * 刻意【没有卡片】：不是「每节一张卡」，而是「一整张宽版面」。要求过卡片画布，
 * 用户明确说「请去掉卡片的功能，不要有卡片的概念了」—— 于是它退场得干干净净。
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
  private labelEl: HTMLElement | null = null;
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
    return this.mode === "board" ? "file-text" : "zoom-in";
  }

  async onOpen(): Promise<void> {
    this.mode = this.plugin.settings.defaultMode;
    this.buildUi();
    this.registerKeys();
    this.registerLiveRecompile();
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
    root.toggleClass("zr-mode-page", this.mode === "page");
    root.toggleClass("zr-mode-board", this.mode === "board");

    if (this.plugin.settings.showToolbar) {
      const bar = root.createDiv({ cls: "zr-toolbar" });
      this.makeButton(bar, "minus", "缩小 / Zoom out", () => this.zoom(-1));
      this.labelEl = bar.createEl("button", { cls: "zr-label", attr: { type: "button", title: "复位到 100% / reset to 100%" } });
      this.labelEl.setText("100%");
      this.registerDomEvent(this.labelEl, "click", () => this.resetView());
      this.makeButton(bar, "plus", "放大 / Zoom in", () => this.zoom(1));
      /* 适配宽度：把整张版面铺满视口 —— 白板（1280 宽）在手机上装不下一屏时，
       * 这是「往下滑着读」最快的一个动作。 */
      this.makeButton(bar, "move-horizontal", "适配宽度 / Fit width", () => {
        if (this.layer) this.layer.fitWidth(this.plugin.settings.padding);
      });
      this.makeButton(bar, "maximize", "复位 / Reset", () => this.resetView());
      if (this.mode === "board") {
        this.makeButton(bar, "refresh-cw", "重新编译 / Recompile now", () => void this.recompile());
      }
      const toggle = this.makeButton(
        bar,
        this.mode === "board" ? "zoom-in" : "file-text",
        this.mode === "board"
          ? "切回版面模式（跟随主题行宽）/ back to page mode"
          : "白板模式（1280px 宽版面，上下滑动读）/ whiteboard: one 1280px page",
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
     * 于是版面模式看起来就是用户主题的阅读视图，白板模式只是把它放宽到 1280。 */
    this.pageEl = this.canvasEl.createDiv({ cls: "markdown-preview-view markdown-rendered zr-page" });

    this.createLayer();

    /* 视口尺寸变化（手机转屏、侧栏开关）时重新算版面宽度 */
    this.observer = new ResizeObserver(() => this.applyPageWidth());
    this.observer.observe(this.viewportEl);

    /* 动画期间（例如适配宽度）不要跟随手指，一按下就撤掉过渡 */
    this.registerDomEvent(
      this.viewportEl,
      "pointerdown",
      () => {
        if (this.viewportEl) this.viewportEl.removeClass("zr-animating");
      },
      { capture: true }
    );
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

  /** 键盘：+ / - / 0，与多数看图工具一致。只在 onOpen 注册一次。 */
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

  /**
   * 只读视图也要「跟着变」：笔记保存了、或另一个标签页里正在改字，白板自动重新编译
   * （节流 400ms）。这样「点白板 = 现读现编译」在打开期间也一直成立。
   */
  private registerLiveRecompile(): void {
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

  private onTransform(t: Transform): void {
    if (this.labelEl) this.labelEl.setText(formatPercent(t.scale));
    if (this.file && this.plugin.settings.rememberPosition) {
      this.plugin.rememberPosition(this.file.path, this.mode, t, this.plugin.settings.boardWidth);
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

  /** 重新编译当前版面（工具条上的「重新编译」按钮走它）。每次进白板、每次笔记改动都会重来一遍。 */
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
    const page = this.pageEl;
    if (!page) return;
    const component = this.beginRenderComponent();

    page.empty();
    try {
      const markdown = await this.readSource(file);
      await MarkdownRenderer.render(this.app, markdown, page, file.path, component);
    } catch (error) {
      /* 手机上打不开控制台，所以失败必须【看得见】：给一条通知，别静默留一块空白。 */
      reportRenderFailure(error);
      this.updateTitle();
      return;
    }

    this.applyPageWidth();

    const saved = this.plugin.settings.rememberPosition
      ? this.plugin.getPosition(file.path, this.mode, this.plugin.settings.boardWidth)
      : null;
    if (!this.layer) return;
    if (saved) this.layer.setTransform(saved);
    else this.layer.reset(this.padding);

    this.updateTitle();
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

  private beginRenderComponent(): Component {
    if (this.renderComponent) {
      this.removeChild(this.renderComponent);
      this.renderComponent = null;
    }
    const component = new Component();
    this.addChild(component);
    this.renderComponent = component;
    return component;
  }

  /**
   * 版面宽度：
   *   ① 版面模式 = min(主题行宽, 视口宽度 - 留白)，于是「100% 就是一屏宽」；
   *   ② 白板模式 = 设置里的白板版面宽度（默认 1280px）——【整篇一张这么宽的版面】，
   *      装不下就平移/缩放，不缩水。
   */
  private applyPageWidth(): void {
    const page = this.pageEl;
    const viewport = this.viewportEl;
    if (!page || !viewport) return;
    const available = Math.max(MIN_PAGE_WIDTH, viewport.clientWidth - this.padding * 2);
    const width =
      this.mode === "board"
        ? Math.max(MIN_PAGE_WIDTH, this.plugin.settings.boardWidth)
        : Math.min(this.themeLineWidth(), available);
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

/* 渲染失败的可视化提示：手机上打不开控制台，所以失败必须看得见。 */
export function reportRenderFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Zoomable Reader: 渲染失败", error);
  new Notice("渲染失败 / Render failed: " + message);
}
