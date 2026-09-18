import {
  App,
  ButtonComponent,
  DropdownComponent,
  Notice,
  PluginSettingTab,
  Setting,
  SliderComponent,
  ToggleComponent,
  type SettingDefinition,
  type SettingDefinitionItem,
  type SettingGroupItem,
} from "obsidian";
import type ZoomableReaderPlugin from "../main";
import {
  DEFAULT_SETTINGS,
  SETTINGS_GROUPS,
  type SettingActionSpec,
  type SettingSpec,
  type ZoomableReaderSettings,
} from "./settings-spec";

export type { ZoomableReaderSettings };
export { DEFAULT_SETTINGS };

/* ============================================================================
 * 设置页：一份内容，两个渲染器
 * ---------------------------------------------------------------------------
 * 内容（双语文案、控件参数、搜索别名）全部住在 settings-spec.ts，这里只负责渲染：
 *   ① getSettingDefinitions()：Obsidian 1.13+ 的声明式 API。好处是【能进设置搜索】——
 *      手机用户打「双指」或 pinch 就能跳到那一项，而不是在几十行里翻。
 *   ② display()：1.5.7~1.12 没有声明式 API，用命令式逐行搭同样的内容（内容同源，
 *      所以两条路径不会长歪 —— 这一点由 tests/settings-spec.test.ts 钉住）。
 * 两个渲染器都经过同一对 getControlValue / setControlValue，读写与副作用只有一份。
 * ========================================================================== */

/** 「中文 / English」：中文界面里先看到中文，英文用来对文档、对搜索。 */
export function bilingual(zh: string, en: string): string {
  return zh + " / " + en;
}

/** 双语文案块：中文一行、英文一行（setDesc 接受 DocumentFragment，所以能这样排版）。 */
export function bilingualFragment(spec: Pick<SettingSpec, "zhDesc" | "enDesc" | "lines">): DocumentFragment {
  const fragment = createFragment();
  if (spec.zhDesc) fragment.createDiv({ cls: "zr-set-zh", text: spec.zhDesc });
  if (spec.enDesc) fragment.createDiv({ cls: "zr-set-en", text: spec.enDesc });
  if (spec.lines) {
    const list = fragment.createDiv({ cls: "zr-set-lines" });
    for (const line of spec.lines) {
      const row = list.createDiv({ cls: "zr-set-line" });
      row.createSpan({ cls: "zr-set-zh", text: line.zh });
      row.createSpan({ cls: "zr-set-en", text: line.en });
    }
  }
  return fragment;
}

export class ZoomableReaderSettingTab extends PluginSettingTab {
  plugin: ZoomableReaderPlugin;
  /** 设置侧栏里的图标（Obsidian 1.11+） */
  icon = "zoom-in";

  constructor(app: App, plugin: ZoomableReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /* --------------------------------------------------- 值的读写（两个渲染器共用） */

  /** 声明式控件读值：一律从插件自己的 settings 读，不依赖基类的存储约定。 */
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  /** 声明式控件写值：落盘 + 让需要即时生效的设置马上生效。 */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    this.plugin.applySettingChange(key as keyof ZoomableReaderSettings);
  }

  /** 命令式路径也走同一套写值逻辑（旧的 onChange 回调直接调它）。 */
  private async set(key: string, value: unknown): Promise<void> {
    await this.setControlValue(key, value);
  }

  /* --------------------------------------------------- ① 声明式（1.13+，可被搜索） */

  getSettingDefinitions(): SettingDefinitionItem[] {
    return SETTINGS_GROUPS.map((group) => {
      const items: SettingGroupItem[] = [];
      if (group.zhIntro || group.enIntro) {
        items.push({
          name: bilingual("说明", "About"),
          desc: bilingualFragment({ zhDesc: group.zhIntro, enDesc: group.enIntro }),
          aliases: [group.zh, group.en, "说明", "about"],
        });
      }
      for (const spec of group.items) items.push(this.toDefinition(spec));
      return { type: "group" as const, heading: bilingual(group.zh, group.en), items: items };
    });
  }

  private toDefinition(spec: SettingSpec): SettingDefinition {
    const name = bilingual(spec.zh, spec.en);
    const desc = bilingualFragment(spec);
    const aliases = spec.aliases ? spec.aliases.slice() : [];

    switch (spec.control) {
      case "toggle":
        return {
          name: name,
          desc: desc,
          aliases: aliases,
          control: { type: "toggle", key: spec.key, defaultValue: DEFAULT_SETTINGS[spec.key] },
        };
      case "slider":
        return {
          name: name,
          desc: desc,
          aliases: aliases,
          control: Object.assign(
            {
              type: "slider" as const,
              key: spec.key,
              min: spec.min,
              max: spec.max,
              step: spec.step,
              defaultValue: DEFAULT_SETTINGS[spec.key],
            },
            spec.format ? { displayFormat: spec.format } : {}
          ),
        };
      case "dropdown":
        return {
          name: name,
          desc: desc,
          aliases: aliases,
          control: {
            type: "dropdown",
            key: spec.key,
            options: spec.options,
            defaultValue: DEFAULT_SETTINGS[spec.key],
          },
        };
      case "action":
        return {
          name: name,
          desc: desc,
          aliases: aliases,
          action: (el: HTMLElement) => {
            const button = el.createEl("button", { cls: "zr-set-button" });
            button.setText(bilingual(spec.buttonZh, spec.buttonEn));
            button.addEventListener("click", (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              void this.runAction(spec);
            });
          },
        };
      default:
        return { name: name, desc: desc, aliases: aliases };
    }
  }

  /* --------------------------------------------------- ② 命令式（1.5.7~1.12 兜底） */

  display(): void {
    const container = this.containerEl;
    container.empty();

    const intro = container.createDiv({ cls: "zr-set-header" });
    intro.createDiv({ cls: "zr-set-zh", text: "Zoomable Reader · 设置（中英对照）" });
    intro.createDiv({ cls: "zr-set-en", text: "Zoomable Reader - settings (Chinese and English side by side)" });
    intro.createDiv({
      cls: "zr-set-zh",
      text: "手机上要缩放，请用本插件的视图打开笔记：侧边栏的放大镜图标，或命令面板里的「打开当前笔记」。Obsidian 自带的阅读视图无法缩放。",
    });
    intro.createDiv({
      cls: "zr-set-en",
      text: "To zoom on mobile, open the note with this plugin's view: the zoom-in ribbon icon, or the command palette. Obsidian's own reading view cannot be zoomed.",
    });

    for (const group of SETTINGS_GROUPS) {
      new Setting(container).setName(bilingual(group.zh, group.en)).setHeading();
      if (group.zhIntro || group.enIntro) {
        const box = container.createDiv({ cls: "zr-set-intro" });
        if (group.zhIntro) box.createDiv({ cls: "zr-set-zh", text: group.zhIntro });
        if (group.enIntro) box.createDiv({ cls: "zr-set-en", text: group.enIntro });
      }
      for (const spec of group.items) this.renderRow(container, spec);
    }
  }

  private renderRow(container: HTMLElement, spec: SettingSpec): void {
    const setting = new Setting(container).setName(bilingual(spec.zh, spec.en)).setDesc(bilingualFragment(spec));

    switch (spec.control) {
      case "toggle":
        setting.addToggle((toggle: ToggleComponent) =>
          toggle.setValue(Boolean(this.getControlValue(spec.key))).onChange(async (value: boolean) => {
            await this.set(spec.key, value);
          })
        );
        break;
      case "slider":
        setting.addSlider((component: SliderComponent) =>
          component
            .setLimits(spec.min, spec.max, spec.step)
            .setValue(Number(this.getControlValue(spec.key)))
            .onChange(async (value: number) => {
              await this.set(spec.key, value);
            })
        );
        break;
      case "dropdown":
        setting.addDropdown((component: DropdownComponent) =>
          component
            .addOptions(spec.options)
            .setValue(String(this.getControlValue(spec.key)))
            .onChange(async (value: string) => {
              await this.set(spec.key, value);
            })
        );
        break;
      case "action":
        setting.addButton((button: ButtonComponent) =>
          button.setButtonText(bilingual(spec.buttonZh, spec.buttonEn)).onClick(async () => {
            await this.runAction(spec);
          })
        );
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------- 动作 */

  private async runAction(spec: SettingActionSpec): Promise<void> {
    if (spec.action === "clear-positions") {
      this.plugin.positions = {};
      await this.plugin.saveSettings();
      new Notice("Saved zoom and positions cleared · 已清除缩放与位置");
    }
  }
}
