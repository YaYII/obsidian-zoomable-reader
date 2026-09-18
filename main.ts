import { Menu, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./src/defaults";
import { DEFAULT_DIAGRAM_LAYOUT, DiagramLayout, MermaidGlobal, applyDiagramLayout } from "./src/diagram-layout";
import { ImageLightbox, installZoomAffordance } from "./src/lightbox";
import { ZoomableReaderSettingTab, ZoomableReaderSettings } from "./src/settings";
import type { ReaderMode, ZoomButtonCorner } from "./src/settings-spec";
import { BOARD_MIN_SCALE, MIN_SCALE, Transform, normalizeTransform } from "./src/zoom-pan";
import { VIEW_TYPE_ZOOMABLE_READER, ZoomableReaderView } from "./src/view";

const POSITION_SEPARATOR = "#board";

export default class ZoomableReaderPlugin extends Plugin {
  settings: ZoomableReaderSettings = Object.assign({}, DEFAULT_SETTINGS);
  /** 每篇笔记的缩放与位置：只存在本地 data.json，不做任何网络请求。
   *  键 = 笔记路径（版面模式）或路径 + "#board"（白板模式）—— 两种模式的
   *  内容尺寸完全不同，共用一份缩放会互相踩。 */
  positions: Record<string, Transform> = {};
  private saveTimer: number | null = null;
  private lightbox: ImageLightbox | null = null;
  private detachAffordance: (() => void) | null = null;

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

    this.addSettingTab(new ZoomableReaderSettingTab(this.app, this));
    this.registerLightbox();
    this.registerDiagramLayout();
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
    const detach = installZoomAffordance(doc, {
      images: this.settings.imageViewer,
      diagrams: this.settings.diagramViewer,
      clickToOpen: this.settings.clickToOpenViewer,
      persistent: this.settings.persistentZoomButton,
      corner: this.settings.zoomButtonCorner,
      label: "Zoom in / 放大",
      onTarget: (found) => {
        const lightbox = this.openLightbox();
        if (found.kind === "image") lightbox.openImage(found.element as HTMLImageElement);
        else lightbox.openNode(found.element, { title: "Mermaid diagram" });
      },
    });
    this.detachAffordance = detach;
    this.register(detach);
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
    if (key === "diagramLayout" || key === "diagramWrapWidth") this.applyDiagramLayoutNow();
    if (
      key === "zoomButtonCorner" ||
      key === "persistentZoomButton" ||
      key === "imageViewer" ||
      key === "diagramViewer" ||
      key === "clickToOpenViewer"
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

  getPosition(path: string, mode: ReaderMode = "page"): Transform | null {
    const min = mode === "board" ? BOARD_MIN_SCALE : MIN_SCALE;
    return normalizeTransform(this.positions[this.keyFor(path, mode)], min, this.settings.maxScale);
  }

  rememberPosition(path: string, mode: ReaderMode, t: Transform): void {
    this.positions[this.keyFor(path, mode)] = { scale: t.scale, x: t.x, y: t.y };
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
      const restored: Record<string, Transform> = {};
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
