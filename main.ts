import { Menu, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./src/defaults";
import { DEFAULT_DIAGRAM_LAYOUT, DiagramLayout, MermaidGlobal, applyDiagramLayout } from "./src/diagram-layout";
import { ImageLightbox, installZoomAffordance, type LightboxTarget } from "./src/lightbox";
import { installMobileReadingTaps } from "./src/mobile-reading-taps";
import {
  READING_ZOOM_STEP,
  clampReadingZoom,
  installReadingGestures,
  installReadingStyle,
  type ReadingViewOptions,
} from "./src/reading-view";
import { ZoomableReaderSettingTab, ZoomableReaderSettings } from "./src/settings";
import { readingLineWidth, type ReaderMode, type ZoomButtonCorner } from "./src/settings-spec";
import { BOARD_MIN_SCALE, MIN_SCALE, Transform, normalizeTransform } from "./src/zoom-pan";

/** 存下来的变换，外加「当时用的白板版面宽度」：版面宽度变了，旧位置就不适用了
 *  （否则用户改完宽度会在板子上落到莫名其妙的地方）。 */
interface StoredTransform extends Transform {
  pageWidth?: number;
}
import { VIEW_TYPE_ZOOMABLE_READER, ZoomableReaderView } from "./src/view";

const POSITION_SEPARATOR = "#board";

export default class ZoomableReaderPlugin extends Plugin {
  settings: ZoomableReaderSettings = Object.assign({}, DEFAULT_SETTINGS);
  /** 每篇笔记的缩放与位置：只存在本地 data.json，不做任何网络请求。
   *  键 = 笔记路径（版面模式）或路径 + "#board"（白板模式）—— 两种模式的
   *  内容尺寸完全不同，共用一份缩放会互相踩。 */
  positions: Record<string, StoredTransform> = {};
  private saveTimer: number | null = null;
  private lightbox: ImageLightbox | null = null;
  private detachAffordance: (() => void) | null = null;
  private readingStyle: { update: (next: ReadingViewOptions) => void; destroy: () => void } | null = null;
  private detachReadingGestures: (() => void) | null = null;
  private detachMobileImageGestures: (() => void) | null = null;

  async onload(): Promise<void> {
    await this.loadPersisted();

    this.registerView(VIEW_TYPE_ZOOMABLE_READER, (leaf: WorkspaceLeaf) => new ZoomableReaderView(leaf, this));

    this.addRibbonIcon("zoom-in", "在白板上打开当前笔记 / open on the zoomable board", () => {
      void this.openActiveFile(false);
    });

    this.addCommand({
      id: "open-active-note",
      name: "打开当前笔记 / open the active note",
      callback: () => {
        void this.openActiveFile(false);
      },
    });

    this.addCommand({
      id: "open-active-note-as-whiteboard",
      name: "把当前笔记编译成白板 / open the active note as a whiteboard",
      callback: () => {
        void this.openActiveFile(false, "board");
      },
    });

    this.addCommand({
      id: "open-active-note-in-new-tab",
      name: "在新标签页打开当前笔记 / open the active note in a new tab",
      callback: () => {
        void this.openActiveFile(true);
      },
    });

    this.addCommand({
      id: "toggle-whiteboard-mode",
      name: "在白板与版面之间切换 / toggle whiteboard mode",
      callback: () => {
        void this.toggleModeOfActiveView();
      },
    });

    /* 文件列表的长按 / 右键菜单：手机上从文件管理直接进白板，不用先打开再找命令。 */
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile)) return;
        menu.addItem((item) =>
          item
            .setTitle("编译成白板 / open as a whiteboard")
            .setIcon("layout-grid")
            .onClick(() => {
              void this.openFileInView(file, "board");
            })
        );
      })
    );

    this.addCommand({
      id: "reading-zoom-in",
      name: "阅读视图放大 / reading view: zoom in",
      callback: () => this.zoomReadingView(1),
    });

    this.addCommand({
      id: "reading-zoom-out",
      name: "阅读视图缩小 / reading view: zoom out",
      callback: () => this.zoomReadingView(-1),
    });

    this.addCommand({
      id: "reading-zoom-reset",
      name: "阅读视图复位到 100% / reading view: reset zoom",
      callback: () => this.resetReadingZoom(),
    });

    this.addSettingTab(new ZoomableReaderSettingTab(this.app, this));
    this.registerLightbox();
    this.registerDiagramLayout();
    this.syncReadingView();
  }

  /* --------------------------------------------------- 阅读视图（Obsidian 自带的页面）

  /**
   * 阅读视图的样式与手势。
   *
   * 只注入样式，不接管页面：宽度改的是 Obsidian 与主题都读的 --file-line-width，
   * 缩放用的是 CSS zoom（会重排，字变大而行宽不变）；手势只在「阅读视图里 + 双指/Ctrl 滚轮」
   * 时才插手，单指滚动与单击一律留给 Obsidian 自己。
   */
  private syncReadingView(): void {
    const doc = this.app.workspace.containerEl.ownerDocument;
    const options = this.readingOptions();

    if (!this.readingStyle) {
      const handle = installReadingStyle(doc, options);
      this.readingStyle = handle;
      this.register(() => handle.destroy());
    } else {
      this.readingStyle.update(options);
    }

    if (this.settings.readingGestures) {
      if (!this.detachReadingGestures) {
        const detach = installReadingGestures(doc, {
          getZoom: () => clampReadingZoom(this.settings.readingZoom / 100),
          onZoom: (zoom) => this.setReadingZoom(zoom * 100),
        });
        this.detachReadingGestures = detach;
        this.register(detach);
      }
    } else if (this.detachReadingGestures) {
      this.detachReadingGestures();
      this.detachReadingGestures = null;
    }
  }

  private readingOptions(): ReadingViewOptions {
    return {
      lineWidth: readingLineWidth(this.settings.readingWidth),
      zoom: this.settings.readingZoom / 100,
      gestures: this.settings.readingGestures,
      imageWidth: this.settings.readingImageWidth,
    };
  }

  /** 改阅读视图缩放：立刻生效 + 落盘（不动笔记，也不动主题文件）。 */
  setReadingZoom(percent: number): void {
    const next = Math.round(clampReadingZoom(percent / 100) * 100);
    if (next === this.settings.readingZoom) return;
    this.settings.readingZoom = next;
    if (this.readingStyle) this.readingStyle.update(this.readingOptions());
    void this.saveSettings();
  }

  /** 命令：阅读视图放大 / 缩小（一次 10%），并给一句反馈。 */
  zoomReadingView(direction: number): void {
    const step = Math.round(READING_ZOOM_STEP * 100) * 2;
    this.setReadingZoom(this.settings.readingZoom + direction * step);
    new Notice("阅读视图缩放 / reading zoom: " + this.settings.readingZoom + "%");
  }

  resetReadingZoom(): void {
    this.setReadingZoom(100);
    new Notice("阅读视图缩放 / reading zoom: 100%");
  }

  /**
   * 图片 / 图表的放大入口。
   *
   * 桌面：指针移到图片（或图表）上时，角落出现一个小按钮，点它才打开查看器 ——
   *       点击图片本身保持它原本的含义（选中、拖拽、Obsidian 自己的行为）。
   * 触屏：没有悬停，轻点即打开查看器。
   * 角可选（默认左上）：右上角留给 Obsidian 自己的「编辑源文件 / 更多选项」。
   *
   * 判定与按钮都在 src/lightbox.ts 的 installZoomAffordance 里，那部分不依赖
   * obsidian，因此能在真实浏览器里用真鼠标/真触摸验证。
   */
  private registerLightbox(): void {
    /* 先卸掉上一份：设置改了角、或者开关变了，都要重新装一次（幂等）。 */
    if (this.detachAffordance) {
      this.detachAffordance();
      this.detachAffordance = null;
    }
    const doc = this.app.workspace.containerEl.ownerDocument;

    /* 手机：阅读视图里双击图片/图表 = 放大查看，同时吃掉 Obsidian 的「双击进入编辑」。
     * 之所以要重装：开关变了、或图片/图表开关变了，都得跟着变。 */
    if (this.detachMobileImageGestures) {
      this.detachMobileImageGestures();
      this.detachMobileImageGestures = null;
    }
    const detachMobile = installMobileReadingTaps(doc, {
      mobile: Platform.isMobile,
      blockDoubleTapEdit: this.settings.mobileBlockDoubleTapEdit,
      images: this.settings.mobileDoubleTapImage && this.settings.imageViewer,
      diagrams: this.settings.mobileDoubleTapImage && this.settings.diagramViewer,
      onOpen: (found: LightboxTarget) => this.openTarget(found),
      onIntercept: (info) => {
        if (!this.settings.mobileTapSelfCheck) return;
        new Notice(
          "双击自检 / tap self-check: " +
            info.gesture +
            " · 命中 " +
            info.kind +
            (info.opened ? " → 打开查看器" : " → 不打开") +
            " · " +
            info.element
        );
      },
    });
    this.detachMobileImageGestures = detachMobile;
    this.register(detachMobile);

    const detach = installZoomAffordance(doc, {
      images: this.settings.imageViewer,
      diagrams: this.settings.diagramViewer,
      clickToOpen: this.settings.clickToOpenViewer,
      persistent: this.settings.persistentZoomButton,
      corner: this.settings.zoomButtonCorner,
      label: "Zoom in / 放大",
      onTarget: (found) => this.openTarget(found),
    });
    this.detachAffordance = detach;
    this.register(detach);
  }

  /** 打开查看器（按钮、点击、手机双击三条入口共用一份）。 */
  private openTarget(found: LightboxTarget): void {
    const lightbox = this.openLightbox();
    if (found.kind === "image") lightbox.openImage(found.element as HTMLImageElement);
    else lightbox.openNode(found.element, { title: "Mermaid diagram" });
  }

  /**
   * 图表排版增强：把 Mermaid 的标签宽度上限从 200px 放宽，并给框更多留白
   * （学 PlantUML 的「框随文字走」，理由见 src/diagram-layout.ts 顶部注释）。
   *
   * 两个坑：
   *   ① 必须【深合并宿主配置】，不能整块替换 —— 否则 Obsidian 的
   *      themeVariables.fontFamily = var(--font-mermaid) 会被冲掉，中文掉回默认字体；
   *   ② Mermaid 是懒加载的（第一次出现图表时才注入 window.mermaid），
   *      所以插件加载时它常常还不存在 —— 重试 + 监听 layout-change。
   */
  private registerDiagramLayout(): void {
    this.applyDiagramLayoutNow();

    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (this.applyDiagramLayoutNow() || tries > 60) window.clearInterval(timer);
    }, 500);
    this.register(() => window.clearInterval(timer));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.applyDiagramLayoutNow()));
  }

  /** 立即尝试装一次；返回 true 表示已经是我们想要的状态（含「功能被关掉」）。 */
  applyDiagramLayoutNow(): boolean {
    const layout: DiagramLayout = {
      ...DEFAULT_DIAGRAM_LAYOUT,
      wrapWidth: this.settings.diagramWrapWidth,
    };
    return applyDiagramLayout(window as unknown as { mermaid?: MermaidGlobal }, layout, this.settings.diagramLayout);
  }

  private openLightbox(): ImageLightbox {
    if (!this.lightbox) {
      this.lightbox = new ImageLightbox(this.app.workspace.containerEl.ownerDocument, {
        fitOnOpen: this.settings.lightboxFitOnOpen,
        maxScale: this.settings.maxScale,
      });
      this.register(() => {
        if (this.lightbox) this.lightbox.close();
      });
    }
    return this.lightbox;
  }

  onunload(): void {
    this.flushPositions();
  }

  /* ---------------------------------------------------------------- 打开笔记 */

  async openActiveFile(forceNewTab: boolean = false, mode: ReaderMode | null = null): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a note first, then run this command. / 先打开一篇笔记，再运行这个命令。");
      return;
    }
    await this.openFileInView(file, mode, forceNewTab);
  }

  /** 在插件的视图里打开一篇笔记；mode 缺省用设置里的默认模式。 */
  async openFileInView(file: TFile, mode: ReaderMode | null = null, forceNewTab: boolean = false): Promise<void> {
    const wanted: ReaderMode = mode || this.settings.defaultMode;
    if (!forceNewTab) {
      const existing = this.findLeafFor(file);
      if (existing) {
        const view = existing.view;
        if (view instanceof ZoomableReaderView) {
          await view.setMode(wanted);
          this.app.workspace.setActiveLeaf(existing, { focus: true });
          return;
        }
      }
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_ZOOMABLE_READER,
      active: true,
      state: { file: file.path, mode: wanted },
    });
  }

  /** 命令「在白板与版面之间切换」：当前视图就是本插件时原地切，否则按白板打开。 */
  async toggleModeOfActiveView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOOMABLE_READER);
    for (const leaf of leaves) {
      if (leaf.view instanceof ZoomableReaderView && leaf.view.containerEl.contains(document.activeElement)) {
        await leaf.view.setMode(leaf.view.getState().mode === "board" ? "page" : "board");
        return;
      }
    }
    await this.openActiveFile(false, "board");
  }

  private findLeafFor(file: TFile): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOOMABLE_READER);
    for (const leaf of leaves) {
      const state = leaf.getViewState().state as { file?: string } | undefined;
      if (state && state.file === file.path) return leaf;
    }
    return null;
  }

  /* ---------------------------------------------------------------- 视图刷新 */

  /** 打开着的本插件视图（设置改了要即时生效）。 */
  private views(): ZoomableReaderView[] {
    const out: ZoomableReaderView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOOMABLE_READER)) {
      if (leaf.view instanceof ZoomableReaderView) out.push(leaf.view);
    }
    return out;
  }

  /**
   * 设置变更后的即时生效：分三类处理 ——
   *   ① 图表排版：直接重装 mermaid 配置；
   *   ② 查看器/按钮相关：重装放大入口（含按钮角、常驻/悬停）；
   *   ③ 其余：交给视图自己判断（手势参数只重建手势层，白板排版才重排内容）。
   */
  applySettingChange(key: keyof ZoomableReaderSettings): void {
    if (key === "readingWidth" || key === "readingZoom" || key === "readingGestures" || key === "readingImageWidth") {
      this.syncReadingView();
    }
    if (key === "diagramLayout" || key === "diagramWrapWidth") this.applyDiagramLayoutNow();
    if (
      key === "zoomButtonCorner" ||
      key === "persistentZoomButton" ||
      key === "imageViewer" ||
      key === "diagramViewer" ||
      key === "clickToOpenViewer" ||
      key === "mobileBlockDoubleTapEdit" ||
      key === "mobileDoubleTapImage" ||
      key === "mobileTapSelfCheck"
    ) {
      this.registerLightbox();
    }
    for (const view of this.views()) view.applySettingChange(key);
  }

  /** 视图里切换模式时记成默认：下次打开笔记就是这次选的模式。 */
  rememberMode(mode: ReaderMode): void {
    if (this.settings.defaultMode === mode) return;
    this.settings.defaultMode = mode;
    void this.saveSettings();
  }

  /* ---------------------------------------------------------------- 位置存取 */

  private keyFor(path: string, mode: ReaderMode): string {
    return mode === "board" ? path + POSITION_SEPARATOR : path;
  }

  getPosition(path: string, mode: ReaderMode = "page", pageWidth?: number): Transform | null {
    const min = mode === "board" ? BOARD_MIN_SCALE : MIN_SCALE;
    const raw = this.positions[this.keyFor(path, mode)] as StoredTransform | undefined;
    if (!raw) return null;
    /* 白板：版面宽度变了，旧位置就不算数（版面几何全变了）——回到「原大」比落到乱处好。 */
    if (mode === "board" && typeof pageWidth === "number" && typeof raw.pageWidth === "number") {
      if (Math.abs(raw.pageWidth - pageWidth) > 0.5) return null;
    }
    return normalizeTransform(raw, min, this.settings.maxScale);
  }

  rememberPosition(path: string, mode: ReaderMode, t: Transform, pageWidth?: number): void {
    const entry: StoredTransform = { scale: t.scale, x: t.x, y: t.y };
    if (mode === "board" && typeof pageWidth === "number") entry.pageWidth = pageWidth;
    this.positions[this.keyFor(path, mode)] = entry;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 800);
  }

  /** 关屏 / 关闭视图 / 卸载插件时立即落盘，避免节流窗口里的最后一次变化丢失。 */
  flushPositions(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveSettings();
    }
  }

  private async loadPersisted(): Promise<void> {
    const data = (await this.loadData()) as
      | { settings?: Partial<ZoomableReaderSettings>; positions?: Record<string, unknown> }
      | null;
    if (data && data.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    }
    if (data && data.positions) {
      const restored: Record<string, StoredTransform> = {};
      for (const key of Object.keys(data.positions)) {
        const min = key.endsWith(POSITION_SEPARATOR) ? BOARD_MIN_SCALE : MIN_SCALE;
        const t = normalizeTransform(data.positions[key], min, this.settings.maxScale);
        if (t) restored[key] = t;
      }
      this.positions = restored;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, positions: this.positions });
  }
}

/* 按钮角的类型从设置模型里来（settings-spec 是纯数据模块），这里只是让导入名更清楚。 */
export type { ZoomButtonCorner };
