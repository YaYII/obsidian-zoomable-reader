import { describe, expect, it } from "vitest";
import {
  ALL_SETTING_SPECS,
  DEFAULT_SETTINGS,
  PAPER_WIDTHS_PX,
  SETTINGS_GROUPS,
  WEB_WIDTH_PX,
  paperNameFor,
  widthLabel,
  widthPresetName,
  widthToMm,
} from "../src/settings-spec";

/* 「设置页中英对照」不是文案偏好，是这次用户明确提的需求（他找不到「双指」在哪）。
 * 所以用测试把它钉住：每一项都必须有中文名 + 英文名、双语说明、双语搜索别名。
 * 这样以后加设置项时，忘记写英文（或忘记写中文）会直接测试失败。 */

const HAN = /[\u4e00-\u9fff]/;
const LATIN = /[A-Za-z]/;

describe("设置页的双语契约", () => {
  it("每一项都有中文名与英文名", () => {
    for (const spec of ALL_SETTING_SPECS) {
      expect(spec.zh, spec.id + " 缺中文名").toMatch(HAN);
      expect(spec.en, spec.id + " 缺英文名").toMatch(LATIN);
    }
  });

  it("每一项都有双语说明（中文一行 + 英文一行，或多行手势说明）", () => {
    for (const spec of ALL_SETTING_SPECS) {
      if (spec.zhDesc && spec.enDesc) {
        expect(spec.zhDesc, spec.id + " 缺中文说明").toMatch(HAN);
        expect(spec.enDesc, spec.id + " 缺英文说明").toMatch(LATIN);
        continue;
      }
      /* 手势速查这类「表格」用 lines：每一行也必须中英并列 */
      expect(spec.lines, spec.id + " 既没有双语说明，也没有多行说明").toBeDefined();
      for (const line of spec.lines || []) {
        expect(line.zh, spec.id + " 的某一行缺中文").toMatch(HAN);
        expect(line.en, spec.id + " 的某一行缺英文").toMatch(LATIN);
      }
    }
  });

  it("搜索别名中英都有：打「双指」和打 pinch 都要能找到", () => {
    for (const spec of ALL_SETTING_SPECS) {
      const aliases = (spec.aliases || []).join(" ");
      expect(aliases, spec.id + " 缺搜索别名").not.toBe("");
      expect(aliases, spec.id + " 的别名里没有中文").toMatch(HAN);
      expect(aliases, spec.id + " 的别名里没有英文").toMatch(LATIN);
    }
  });

  it("分组标题也是双语的", () => {
    for (const group of SETTINGS_GROUPS) {
      expect(group.zh).toMatch(HAN);
      expect(group.en).toMatch(LATIN);
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("id 唯一（DOM 标记与测试都靠它）", () => {
    const ids = ALL_SETTING_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("有 key 的设置项都能在 DEFAULT_SETTINGS 里找到默认值", () => {
    for (const spec of ALL_SETTING_SPECS) {
      if (spec.control === "info" || spec.control === "action") continue;
      expect(DEFAULT_SETTINGS[spec.key], spec.id + " 的 key 不在 DEFAULT_SETTINGS 里").not.toBeUndefined();
    }
  });

  it("滑块的默认值落在 [min, max] 区间内", () => {
    for (const spec of ALL_SETTING_SPECS) {
      if (spec.control !== "slider") continue;
      const value = DEFAULT_SETTINGS[spec.key];
      expect(value, spec.id).toBeGreaterThanOrEqual(spec.min);
      expect(value, spec.id).toBeLessThanOrEqual(spec.max);
      expect(spec.step, spec.id + " 的步长必须为正").toBeGreaterThan(0);
    }
  });

  it("下拉框的默认值必须是选项之一", () => {
    for (const spec of ALL_SETTING_SPECS) {
      if (spec.control !== "dropdown") continue;
      expect(Object.keys(spec.options)).toContain(String(DEFAULT_SETTINGS[spec.key]));
      for (const label of Object.values(spec.options)) {
        expect(label, spec.id + " 的选项文案必须中英对照").toMatch(HAN);
        expect(label, spec.id + " 的选项文案必须中英对照").toMatch(LATIN);
      }
    }
  });
});

describe("白板版面宽度：默认 1280 网页宽（用户要求「按 1280 的宽度展示，去掉卡片概念」）", () => {
  it("默认白板版面宽度 = 1280px（网页版心），整篇一张版面", () => {
    expect(DEFAULT_SETTINGS.boardWidth).toBe(WEB_WIDTH_PX);
    expect(WEB_WIDTH_PX).toBe(1280);
    expect(widthPresetName(DEFAULT_SETTINGS.boardWidth)).toContain("网页宽");
  });

  it("纸张仍是可选预设：A5 宽 148mm 在 96dpi 下 ≈ 560px", () => {
    expect(paperNameFor(PAPER_WIDTHS_PX.A5)).toBe("A5");
    expect(widthToMm(PAPER_WIDTHS_PX.A5)).toBe(148);
    expect(Math.abs(PAPER_WIDTHS_PX.A5 - (148 / 25.4) * 96)).toBeLessThanOrEqual(1);
  });

  it("三张常见纸都能被认出来（A6 / A5 / A4），1280 不算纸", () => {
    expect(paperNameFor(PAPER_WIDTHS_PX.A6)).toBe("A6");
    expect(paperNameFor(PAPER_WIDTHS_PX.A4)).toBe("A4");
    expect(paperNameFor(WEB_WIDTH_PX)).toBeNull();
    expect(paperNameFor(500)).toBeNull();
  });

  it("滑块读数说人话：网页宽给「网页宽 Web」，纸张给毫米数", () => {
    expect(widthLabel(WEB_WIDTH_PX)).toContain("网页宽");
    expect(widthLabel(PAPER_WIDTHS_PX.A5)).toContain("A5");
    expect(widthLabel(PAPER_WIDTHS_PX.A5)).toContain("148mm");
    expect(widthLabel(500)).toContain("132mm");
  });

  it("滑块范围能选到 1280（默认值）与 A4", () => {
    const spec = ALL_SETTING_SPECS.find((s) => s.id === "board-width");
    expect(spec?.control).toBe("slider");
    const slider = spec as { min: number; max: number; step: number };
    expect(slider.max).toBeGreaterThanOrEqual(WEB_WIDTH_PX);
    expect(slider.max).toBeGreaterThanOrEqual(PAPER_WIDTHS_PX.A4);
    expect((WEB_WIDTH_PX - slider.min) % slider.step).toBe(0);
  });
});

describe("这次用户提的具体要求", () => {
  const byId = (id: string) => ALL_SETTING_SPECS.find((spec) => spec.id === id);

  it("「双指」有独立开关（用户找不到的那个手势设置）", () => {
    const pinch = byId("pinch-zoom");
    expect(pinch).toBeDefined();
    expect(pinch?.control).toBe("toggle");
    expect((pinch?.aliases || []).join(" ")).toContain("双指");
    expect((pinch?.aliases || []).join(" ")).toContain("pinch");
  });

  it("手势速查里逐条写明双指捏合（手机上手势总览）", () => {
    const help = byId("gesture-help");
    const text = (help?.lines || []).map((line) => line.zh + line.en).join(" ");
    expect(text).toContain("双指");
    expect(text.toLowerCase()).toContain("pinch");
    expect(text).toContain("Ctrl");
  });

  it("白板模式的设置只剩「版面宽度」—— 卡片相关的设置项全部退场", () => {
    expect(byId("board-width"), "缺少「白板版面宽度」设置").toBeDefined();
    for (const gone of ["board-layout", "board-card-width", "board-max-depth", "board-gap", "board-connectors", "board-max-cards"]) {
      expect(byId(gone), "卡片时代的设置项还在：" + gone).toBeUndefined();
    }
  });

  it("设置项里没有卡片功能词汇（概念已移除；「没有卡片」这种否定说法不算）", () => {
    const cardVocabulary = ["卡片宽度", "卡片间距", "卡片数量", "卡片展开", "卡片画布", "成卡", "每张卡", "卡片之间", "连线"];
    for (const spec of ALL_SETTING_SPECS) {
      const text = spec.zh + " " + (spec.zhDesc || "") + " " + (spec.aliases || []).join(" ");
      for (const word of cardVocabulary) {
        expect(text, spec.id + " 里还在用卡片词汇：" + word).not.toContain(word);
      }
    }
  });

  it("白板是默认模式的合法取值（打开笔记就能进白板）", () => {
    const mode = byId("default-mode");
    expect(mode?.control).toBe("dropdown");
    expect(Object.keys((mode as { options: Record<string, string> }).options)).toContain("board");
  });

  it("放大按钮的默认角是左上（右上角是 Obsidian 的编辑源文件入口，不能盖住）", () => {
    expect(DEFAULT_SETTINGS.zoomButtonCorner).toBe("top-left");
    const corner = byId("zoom-button-corner");
    expect(Object.keys((corner as { options: Record<string, string> }).options)).toContain("top-right");
  });
});
