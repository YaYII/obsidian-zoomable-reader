import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./src/defaults";
import { ImageLightbox, registerLightboxClicks } from "./src/lightbox";
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
  }

  /**
   * 点击笔记里的图片 / 图表 → 打开可缩放查看器。
   * 判定逻辑在 src/lightbox.ts 的 findLightboxTarget / registerLightboxClicks 里，
   * 那部分刻意不依赖 obsidian，因此在真实浏览器里可以用真点击验证。
   */
  private registerLightbox(): void {
    const doc = this.app.workspace.containerEl.ownerDocument;
    const detach = registerLightboxClicks(doc, {
      images: this.settings.imageViewer,
      diagrams: this.settings.diagramViewer,
      onTarget: (found) => {
        const lightbox = this.openLightbox();
        if (found.kind === "image") lightbox.openImage(found.element as HTMLImageElement);
        else lightbox.openNode(found.element, { title: "Mermaid diagram" });
      },
    });
    this.register(detach);
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