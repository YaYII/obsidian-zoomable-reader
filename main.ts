import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./src/defaults";
import { DEFAULT_DIAGRAM_LAYOUT, DiagramLayout, MermaidGlobal, applyDiagramLayout } from "./src/diagram-layout";
import { ImageLightbox, installZoomAffordance } from "./src/lightbox";
import { ZoomableReaderSettingTab, ZoomableReaderSettings } from "./src/settings";
import { Transform, normalizeTransform } from "./src/zoom-pan";
import { VIEW_TYPE_ZOOMABLE_READER, ZoomableReaderView } from "./src/view";

export default class ZoomableReaderPlugin extends Plugin {
  settings: ZoomableReaderSettings = Object.assign({}, DEFAULT_SETTINGS);
  /** 每篇笔记的缩放与位置：只存在本地 data.json，不做任何网络请求。 */
  positions: Record<string, Transform> = {};
  private saveTimer: number | null = null;
  private lightbox: ImageLightbox | null = null;

  async onload(): Promise<void> {
    await this.loadPersisted();

    this.registerView(VIEW_TYPE_ZOOMABLE_READER, (leaf: WorkspaceLeaf) => new ZoomableReaderView(leaf, this));

    this.addRibbonIcon("zoom-in", "Open the active note on a zoomable board", () => {
      void this.openActiveFile();
    });

    this.addCommand({
      id: "open-active-note",
      name: "Open the active note",
      callback: () => {
        void this.openActiveFile();
      },
    });

    this.addCommand({
      id: "open-active-note-as-zoomed-copy",
      name: "Open the active note in a new tab",
      callback: () => {
        void this.openActiveFile(true);
      },
    });

    this.addSettingTab(new ZoomableReaderSettingTab(this.app, this));
    this.registerLightbox();
    this.registerDiagramLayout();
  }

  /**
   * 图片 / 图表的放大入口。
   *
   * 桌面：指针移到图片（或图表）上时，右上角出现一个小按钮，点它才打开查看器 ——
   *       点击图片本身保持它原本的含义（选中、拖拽、Obsidian 自己的行为）。
   * 触屏：没有悬停，轻点即打开查看器。
   *
   * 判定与按钮都在 src/lightbox.ts 的 installZoomAffordance 里，那部分不依赖
   * obsidian，因此能在真实浏览器里用真鼠标/真触摸验证。
   */
  private registerLightbox(): void {
    const doc = this.app.workspace.containerEl.ownerDocument;
    const detach = installZoomAffordance(doc, {
      images: this.settings.imageViewer,
      diagrams: this.settings.diagramViewer,
      clickToOpen: this.settings.clickToOpenViewer,
      persistent: this.settings.persistentZoomButton,
      label: "Zoom in",
      onTarget: (found) => {
        const lightbox = this.openLightbox();
        if (found.kind === "image") lightbox.openImage(found.element as HTMLImageElement);
        else lightbox.openNode(found.element, { title: "Mermaid diagram" });
      },
    });
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

  async openActiveFile(forceNewTab: boolean = false): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a note first, then run this command.");
      return;
    }
    if (!forceNewTab) {
      const existing = this.findLeafFor(file);
      if (existing) {
        this.app.workspace.setActiveLeaf(existing, { focus: true });
        return;
      }
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_ZOOMABLE_READER,
      active: true,
      state: { file: file.path },
    });
  }

  private findLeafFor(file: TFile): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOOMABLE_READER);
    for (const leaf of leaves) {
      const state = leaf.getViewState().state as { file?: string } | undefined;
      if (state && state.file === file.path) return leaf;
    }
    return null;
  }

  getPosition(path: string): Transform | null {
    return normalizeTransform(this.positions[path], 0.2, this.settings.maxScale);
  }

  rememberPosition(path: string, t: Transform): void {
    this.positions[path] = { scale: t.scale, x: t.x, y: t.y };
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
        const t = normalizeTransform(data.positions[key], 0.2, this.settings.maxScale);
        if (t) restored[key] = t;
      }
      this.positions = restored;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, positions: this.positions });
  }
}