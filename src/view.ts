import { Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ZoomableReaderPlugin from "../main";
import { Transform, ZOOM_STEP, ZoomPanLayer, formatPercent } from "./zoom-pan";

export const VIEW_TYPE_ZOOMABLE_READER = "zoomable-reader-view";

/** 主题没给出行宽时的兜底宽度（与多数主题的 700~760px 版心一致） */
const FALLBACK_LINE_WIDTH = 760;
const MIN_PAGE_WIDTH = 240;

/**
 * 把一篇笔记渲染进「可平移 + 可缩放」的画布。
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
  private renderComponent: Component | null = null;
  private observer: ResizeObserver | null = null;

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
    return "zoom-in";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
  }

  async onClose(): Promise<void> {
    this.plugin.flushPositions();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.layer) {
      this.layer.destroy();
      this.layer = null;
    }
  }

  getState(): Record<string, unknown> {
    return { file: this.file ? this.file.path : null };
  }

  async setState(state: unknown, result: unknown): Promise<void> {
    const path = state && typeof state === "object" ? (state as { file?: string }).file : undefined;
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
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

    if (this.plugin.settings.showToolbar) {
      const bar = root.createDiv({ cls: "zr-toolbar" });
      this.makeButton(bar, "minus", "Zoom out", () => this.zoom(-1));
      this.labelEl = bar.createEl("button", { cls: "zr-label", attr: { type: "button", title: "Reset to 100%" } });
      this.labelEl.setText("100%");
      this.registerDomEvent(this.labelEl, "click", () => this.resetView());
      this.makeButton(bar, "plus", "Zoom in", () => this.zoom(1));
      this.makeButton(bar, "move-horizontal", "Fit width", () => {
        if (this.layer) this.layer.fitWidth(this.plugin.settings.padding);
      });
      this.makeButton(bar, "maximize", "Reset", () => this.resetView());
    }

    this.viewportEl = root.createDiv({ cls: "zr-viewport" });
    this.canvasEl = this.viewportEl.createDiv({ cls: "zr-canvas" });
    /* 两个类名都加上：markdown-rendered 让主题的正文排版生效，
     * markdown-preview-view 让「阅读视图」那一层样式（行宽、内边距）也生效 ——
     * 于是这个视图看起来就是用户主题的阅读视图，只是多了缩放。 */
    this.pageEl = this.canvasEl.createDiv({ cls: "markdown-preview-view markdown-rendered zr-page" });

    this.layer = new ZoomPanLayer(this.viewportEl, this.canvasEl, {
      maxScale: this.plugin.settings.maxScale,
      doubleTapZoom: this.plugin.settings.doubleTapZoom,
      onCommit: (t) => this.onTransform(t),
    });

    /* 视口尺寸变化（手机转屏、侧栏开关）时重新算版心宽度 */
    this.observer = new ResizeObserver(() => this.applyPageWidth());
    this.observer.observe(this.viewportEl);

    /* 键盘：+ / - / 0，与多数看图工具一致 */
    const scope = this.scope;
    const keys: Array<[string, () => void]> = [
      ["+", () => this.zoom(1)],
      ["=", () => this.zoom(1)],
      ["-", () => this.zoom(-1)],
      ["0", () => this.resetView()],
    ];
    if (scope) {
      for (const [key, action] of keys) {
        scope.register([], key, (event) => {
          action();
          event.preventDefault();
          return false;
        });
      }
    }
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
      this.plugin.rememberPosition(this.file.path, t);
    }
  }

  /* ------------------------------------------------------------------ 渲染 */

  async renderFile(file: TFile): Promise<void> {
    this.file = file;
    const page = this.pageEl;
    if (!page) return;

    if (this.renderComponent) {
      this.removeChild(this.renderComponent);
      this.renderComponent = null;
    }
    const component = new Component();
    this.addChild(component);
    this.renderComponent = component;

    page.empty();
    const markdown = await this.app.vault.cachedRead(file);
    await MarkdownRenderer.render(this.app, markdown, page, file.path, component);

    this.applyPageWidth();
    const saved = this.plugin.settings.rememberPosition ? this.plugin.getPosition(file.path) : null;
    if (this.layer) {
      if (saved) this.layer.setTransform(saved);
      else this.layer.reset(this.padding);
    }
    this.updateTitle();
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
