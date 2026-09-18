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
      .setDesc("Upper limit for pinch and Ctrl+wheel zoom.")
      .addSlider((slider) =>
        slider
          .setLimits(2, 16, 1)
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
