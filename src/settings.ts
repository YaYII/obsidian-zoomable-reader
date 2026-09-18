import { App, PluginSettingTab, Setting } from "obsidian";
import type ZoomableReaderPlugin from "../main";
import { DEFAULT_SETTINGS } from "./defaults";

export interface ZoomableReaderSettings {
  /** 记住每篇笔记的缩放与位置（存在 data.json 里，不上传任何地方） */
  rememberPosition: boolean;
  /** 双击 / 双击放大到的倍数 */
  doubleTapZoom: number;
  /** 最大放大倍数 */
  maxScale: number;
  /** 顶部工具条（手机上也靠它一键放大） */
  showToolbar: boolean;
  /** 版心四周留白（px） */
  padding: number;
  /** 点击笔记里的图片 → 打开可缩放查看器 */
  imageViewer: boolean;
  /** 点击 Mermaid 图表 → 打开可缩放查看器 */
  diagramViewer: boolean;
  /** 查看器打开时先适配窗口（关掉则先按 100%） */
  lightboxFitOnOpen: boolean;
  /** 桌面上点击图片也直接打开查看器（默认关：桌面上用右上角的按钮） */
  clickToOpenViewer: boolean;
  /** 右上角放大按钮常驻显示（默认开；关掉则只有悬停时出现） */
  persistentZoomButton: boolean;
  /** 图表排版增强：放宽 Mermaid 的标签最大宽度、给框更多留白（学 PlantUML「框随文字走」） */
  diagramLayout: boolean;
  /** 标签最大宽度（px）：越大越接近不折行，460 是实测的中文舒适值 */
  diagramWrapWidth: number;
}

export { DEFAULT_SETTINGS };

/* 说明：官方 linter 建议改用声明式设置 API（getSettingDefinitions），这样设置项能出现在
 * Obsidian 1.13+ 的设置搜索里。本版本仍用命令式设置页 —— 功能等价、只是不参与搜索；
 * 迁移需要整页重写，留到后续版本，先在 lint 里作为已知警告保留。 */
export class ZoomableReaderSettingTab extends PluginSettingTab {
  plugin: ZoomableReaderPlugin;

  constructor(app: App, plugin: ZoomableReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const container = this.containerEl;
    container.empty();

    new Setting(container)
      .setName("Remember zoom and position per note")
      .setDesc("Stored locally in this plugin's data.json. Nothing is uploaded.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rememberPosition).onChange(async (value) => {
          this.plugin.settings.rememberPosition = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Double-tap zoom")
      .setDesc("How far a double-click (or double-tap on mobile) zooms in.")
      .addSlider((slider) =>
        slider
          .setLimits(1.25, 4, 0.25)
          .setValue(this.plugin.settings.doubleTapZoom)
          .onChange(async (value) => {
            this.plugin.settings.doubleTapZoom = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Maximum zoom")
      .setDesc("Upper limit for pinch and wheel zoom. High values are fine; the cap only exists so a stray gesture cannot lose your place.")
      .addSlider((slider) =>
        slider
          .setLimits(8, 256, 8)
          .setValue(this.plugin.settings.maxScale)
          .onChange(async (value) => {
            this.plugin.settings.maxScale = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Show toolbar")
      .setDesc("Zoom out, reset, zoom in buttons and the current zoom level.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolbar).onChange(async (value) => {
          this.plugin.settings.showToolbar = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Page padding")
      .setDesc("Gap between the note and the edge of the view, in pixels.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 48, 4)
          .setValue(this.plugin.settings.padding)
          .onChange(async (value) => {
            this.plugin.settings.padding = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Click images to open a zoomable viewer")
      .setDesc("Opens the image full screen with wheel zoom, drag to pan and zoom buttons. Works on desktop and mobile.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.imageViewer).onChange(async (value) => {
          this.plugin.settings.imageViewer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Click diagrams to open a zoomable viewer")
      .setDesc("Mermaid diagrams open in the same viewer, so you can zoom into a dense flow chart.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.diagramViewer).onChange(async (value) => {
          this.plugin.settings.diagramViewer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Always show the zoom button")
      .setDesc("On: every image and diagram carries a small button in its top right corner, so you never have to hunt for it. Off: the button only appears while the pointer is over the image.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.persistentZoomButton).onChange(async (value) => {
          this.plugin.settings.persistentZoomButton = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Open the viewer by clicking images too")
      .setDesc("Off: on desktop the small button in the top right corner of an image opens the viewer, and clicking the image keeps its usual meaning. On touch devices a tap always opens the viewer, since there is no hover.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.clickToOpenViewer).onChange(async (value) => {
          this.plugin.settings.clickToOpenViewer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Fit to window when the viewer opens")
      .setDesc("Off: images open at 100% instead of being scaled to fit.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.lightboxFitOnOpen).onChange(async (value) => {
          this.plugin.settings.lightboxFitOnOpen = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Wider diagram boxes")
      .setDesc(
        "Mermaid caps a label at 200px, so long Chinese labels fold into four or five narrow lines. " +
          "This widens that cap and adds padding, so boxes follow the text — the way PlantUML lays them out. " +
          "Diagrams that are already open pick it up the next time they render."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.diagramLayout).onChange(async (value) => {
          this.plugin.settings.diagramLayout = value;
          await this.plugin.saveSettings();
          this.plugin.applyDiagramLayoutNow();
        })
      );

    new Setting(container)
      .setName("Max label width")
      .setDesc("How wide one label may get before it wraps, in pixels (default 460; up to 800 for almost no wrapping).")
      .addSlider((slider) =>
        slider
          .setLimits(240, 800, 20)
          .setValue(this.plugin.settings.diagramWrapWidth)
          .onChange(async (value) => {
            this.plugin.settings.diagramWrapWidth = value;
            await this.plugin.saveSettings();
            this.plugin.applyDiagramLayoutNow();
          })
      );

    new Setting(container)
      .setName("Clear saved zoom and positions")
      .setDesc("Reset every note back to 100% next time it opens.")
      .addButton((button) =>
        button.setButtonText("Clear").onClick(async () => {
          this.plugin.positions = {};
          await this.plugin.saveSettings();
        })
      );
  }
}
