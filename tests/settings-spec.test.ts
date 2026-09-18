import { describe, expect, it } from "vitest";
import {
  ALL_SETTING_SPECS,
  DEFAULT_SETTINGS,
  PAPER_WIDTHS_PX,
  SETTINGS_GROUPS,
  cardWidthLabel,
  paperNameFor,
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

describe("纸张尺寸：默认 A5（用户要求「默认要 A5，这符合纸张的大小」）", () => {
  it("默认卡片宽 = A5 宽（148mm 在 96dpi 下 ≈ 560px）", () => {
    expect(paperNameFor(DEFAULT_SETTINGS.boardCardWidth)).toBe("A5");
    expect(widthToMm(DEFAULT_SETTINGS.boardCardWidth)).toBe(148);
    expect(Math.abs(DEFAULT_SETTINGS.boardCardWidth - (148 / 25.4) * 96)).toBeLessThanOrEqual(1);
  });

  it("三张常见纸都能被认出来（A6 / A5 / A4）", () => {
    expect(paperNameFor(PAPER_WIDTHS_PX.A6)).toBe("A6");
    expect(paperNameFor(PAPER_WIDTHS_PX.A5)).toBe("A5");
    expect(paperNameFor(PAPER_WIDTHS_PX.A4)).toBe("A4");
    expect(paperNameFor(500)).toBeNull();
  });

  it("滑块读数带毫米与纸名（用户按「多大一张纸」来选，而不是按像素）", () => {
    expect(cardWidthLabel(DEFAULT_SETTINGS.boardCardWidth)).toContain("A5");
    expect(cardWidthLabel(DEFAULT_SETTINGS.boardCardWidth)).toContain("148mm");
    expect(cardWidthLabel(500)).toContain("132mm");
  });

  it("A4 也在滑块能选到的范围内", () => {
    const spec = ALL_SETTING_SPECS.find((s) => s.id === "board-card-width");
    expect(spec?.control).toBe("slider");
    const slider = spec as { min: number; max: number };
    expect(slider.max).toBeGreaterThanOrEqual(PAPER_WIDTHS_PX.A4);
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

  it("白板模式的设置齐全：默认模式 / 卡片宽度 / 层级 / 间距 / 连线 / 上限", () => {
    for (const id of ["default-mode", "board-card-width", "board-max-depth", "board-gap", "board-connectors", "board-max-cards"]) {
      expect(byId(id), "缺少设置项 " + id).toBeDefined();
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
