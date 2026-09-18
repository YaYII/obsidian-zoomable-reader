import { describe, expect, it } from "vitest";
import {
  READING_ZOOM_MAX,
  READING_ZOOM_MIN,
  STYLE_ELEMENT_ID,
  clampReadingZoom,
  readingCss,
} from "../src/reading-view";
import { DEFAULT_SETTINGS, readingLineWidth } from "../src/settings-spec";

/* 「阅读视图也能改宽度、也能缩放」这件事，核心是一段 CSS。它读代码看不出对错，
 * 所以这里直接断言生成的字符串：宽度落在哪、zoom 有没有、sizer 有没有按比例除掉。 */

describe("clampReadingZoom：缩放的边界", () => {
  it("夹在 60%~200% 之间，并取整到 1%", () => {
    expect(clampReadingZoom(0.1)).toBe(READING_ZOOM_MIN);
    expect(clampReadingZoom(9)).toBe(READING_ZOOM_MAX);
    expect(clampReadingZoom(1.234)).toBe(1.23);
    expect(clampReadingZoom(Number.NaN)).toBe(1);
  });
});

describe("readingCss：注入的样式", () => {
  it("默认（900px + 100%）：改版心宽度变量，并给 sizer 兜底", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1, gestures: true, imageWidth: "natural" });
    expect(css).toContain("--file-line-width: 900px");
    expect(css).toContain("--line-width: 900px");
    expect(css).toContain(".markdown-reading-view .markdown-preview-sizer { max-width: 900.00px !important; }");
    expect(css).not.toContain("zoom:");
  });

  it("缩放时用 CSS zoom（会重排），并把 sizer 宽度按比例除掉 —— 字变大、行宽不变", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1.5, gestures: true, imageWidth: "natural" });
    expect(css).toContain(".markdown-reading-view { zoom: 1.5; }");
    expect(css).toContain("max-width: 600.00px !important;");
  });

  it("「跟随主题」：不注入任何宽度规则，只可能注入 zoom", () => {
    const css = readingCss({ lineWidth: "theme", zoom: 1.25, gestures: true, imageWidth: "natural" });
    expect(css).not.toContain("--file-line-width");
    expect(css).toContain(".markdown-reading-view { zoom: 1.25; }");
  });

  it("跟随主题 + 100% + 手势开：只声明 touch-action（否则双指会被浏览器抢走）", () => {
    const css = readingCss({ lineWidth: "theme", zoom: 1, gestures: true, imageWidth: "natural" });
    expect(css).toContain("touch-action: pan-y");
    expect(css).not.toContain("--file-line-width");
    expect(css).not.toContain("zoom:");
  });

  it("手势关掉：不声明 touch-action（一个字节都不注入）", () => {
    expect(readingCss({ lineWidth: "theme", zoom: 1, gestures: false, imageWidth: "natural" })).toBe("");
  });

  it("选择器限定在阅读视图内（本插件自己的视图不受影响）", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1.2, gestures: true, imageWidth: "natural" });
    for (const line of css.split("\n")) {
      if (line.trim() === "" || line.trim() === "}") continue;
      if (line.includes("{") || line.includes("px;") || line.includes("!important")) {
        expect(line.includes(".markdown-reading-view") || line.includes("--file-line-width") || line.includes("--line-width") || line.trim() === "}", line).toBe(true);
      }
    }
  });
});

describe("设置 → 样式 的换算", () => {
  it("默认设置：阅读视图宽度 900、缩放 100、手势开", () => {
    expect(DEFAULT_SETTINGS.readingWidth).toBe("900");
    expect(readingLineWidth(DEFAULT_SETTINGS.readingWidth)).toBe(900);
    expect(DEFAULT_SETTINGS.readingZoom).toBe(100);
    expect(DEFAULT_SETTINGS.readingGestures).toBe(true);
  });

  it("「跟随主题」映射成 theme，脏值也退化成 theme（不产生 NaN 宽度）", () => {
    expect(readingLineWidth("theme")).toBe("theme");
    expect(readingLineWidth("垃圾" as never)).toBe("theme");
  });

  it("样式元素有稳定的 id（便于验证与排查）", () => {
    expect(STYLE_ELEMENT_ID).toBe("zr-reading-style");
  });
});
describe("图片宽度策略：严格按版心宽度等比放大", () => {
  it("默认 fill：图片宽度 = 版心宽（!important），高度自动、object-fit: contain（不变形）", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1, gestures: false, imageWidth: "fill" });
    expect(css).toContain(".markdown-reading-view .markdown-preview-view img");
    expect(css).toContain("width: 100% !important;");
    expect(css).toContain("height: auto !important;");
    expect(css).toContain("object-fit: contain;");
  });

  it("fill 用精确的 width:100%（不是 max-width 那种子串）—— 于是显式写死宽度的图片也被统一", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1, gestures: false, imageWidth: "fill" });
    const exact = css.split("\n").filter((line) => line.trim() === "width: 100% !important;");
    expect(exact).toHaveLength(1);
  });

  it("contain：只保证不溢出（max-width），不放大", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1, gestures: false, imageWidth: "contain" });
    const lines = css.split("\n").map((line) => line.trim());
    expect(lines).toContain("max-width: 100% !important;");
    expect(lines).not.toContain("width: 100% !important;");
  });

  it("natural：一个字节都不注入（完全交给主题）", () => {
    const css = readingCss({ lineWidth: "theme", zoom: 1, gestures: false, imageWidth: "natural" });
    expect(css).toBe("");
  });

  it("图片规则只在阅读视图内（编辑模式与其它视图不受影响）", () => {
    const css = readingCss({ lineWidth: 900, zoom: 1, gestures: false, imageWidth: "fill" });
    for (const line of css.split("\n")) {
      if (!line.includes("img") && !line.includes("video")) continue;
      expect(line.startsWith(".markdown-reading-view"), line).toBe(true);
    }
  });
});
