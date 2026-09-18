import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  distance,
  fitScale,
  formatPercent,
  identity,
  midpoint,
  normalizeTransform,
  panBy,
  transformCss,
  zoomAt,
} from "../src/zoom-pan";

/* 这些是缩放平移的「数学契约」。手势那一层由 tools/verify-gestures.mjs 在真实
 * Chromium 里用真事件验证；这里只测不依赖 DOM 的部分，跑得快、失败定位准。 */

/** 把视口坐标 (px,py) 反推成内容坐标：缩放前后它应当不变。 */
function contentPoint(t: { scale: number; x: number; y: number }, px: number, py: number) {
  return { x: (px - t.x) / t.scale, y: (py - t.y) / t.scale };
}

describe("zoomAt：以光标为锚点缩放", () => {
  it("锚点在屏幕上保持不动（这是「跟着手指缩放」的核心不变量）", () => {
    const before = { scale: 1, x: 30, y: 40 };
    const anchor = { x: 120, y: 90 };
    const contentBefore = contentPoint(before, anchor.x, anchor.y);

    const after = zoomAt(before, 2.5, anchor.x, anchor.y);

    expect(after.scale).toBeCloseTo(2.5, 6);
    const contentAfter = contentPoint(after, anchor.x, anchor.y);
    expect(contentAfter.x).toBeCloseTo(contentBefore.x, 6);
    expect(contentAfter.y).toBeCloseTo(contentBefore.y, 6);
  });

  it("缩小同样保持锚点", () => {
    const before = { scale: 3, x: -100, y: -50 };
    const anchor = { x: 400, y: 300 };
    const contentBefore = contentPoint(before, anchor.x, anchor.y);
    const after = zoomAt(before, 1 / 3, anchor.x, anchor.y);
    const contentAfter = contentPoint(after, anchor.x, anchor.y);
    expect(contentAfter.x).toBeCloseTo(contentBefore.x, 6);
    expect(contentAfter.y).toBeCloseTo(contentBefore.y, 6);
  });

  it("放大倍数被上限截断，且截断后锚点依然不动", () => {
    const before = { scale: MAX_SCALE, x: 0, y: 0 };
    const after = zoomAt(before, 4, 50, 50);
    expect(after.scale).toBe(MAX_SCALE);
    const contentBefore = contentPoint(before, 50, 50);
    const contentAfter = contentPoint(after, 50, 50);
    expect(contentAfter.x).toBeCloseTo(contentBefore.x, 6);
  });
});

describe("clampScale / fitScale", () => {
  it("clampScale 夹在上下限之间，NaN 落到下限", () => {
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
  });

  it("fitScale 把内容缩进视口", () => {
    expect(fitScale(800, 1600)).toBeCloseTo(0.5, 6);
    expect(fitScale(800, 400)).toBe(2);
  });

  it("fitScale 对非法输入退化为 1，不产生 NaN 变换", () => {
    expect(fitScale(0, 100)).toBe(1);
    expect(fitScale(800, 0)).toBe(1);
    expect(fitScale(Number.NaN, Number.NaN)).toBe(1);
  });
});

describe("panBy / 基础几何", () => {
  it("平移只改位置不改缩放", () => {
    const t = panBy({ scale: 2, x: 10, y: 10 }, -5, 7);
    expect(t).toEqual({ scale: 2, x: 5, y: 17 });
  });

  it("distance / midpoint", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });

  it("distance 是双指缩放的比例来源：两指距离翻倍 = 放大一倍", () => {
    const start = distance({ x: 0, y: 0 }, { x: 100, y: 0 });
    const end = distance({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(end / start).toBe(2);
  });
});

describe("输出格式", () => {
  it("transformCss 生成 3D 变换串（含 scale）", () => {
    expect(transformCss({ scale: 1.5, x: 12, y: -8 })).toBe("translate3d(12px, -8px, 0) scale(1.5)");
  });

  it("百分比取整，越界值不出现科学计数法", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.333)).toBe("33%");
    expect(formatPercent(8)).toBe("800%");
  });

  it("identity 是 100% 且无偏移", () => {
    expect(identity()).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("normalizeTransform：读旧 data.json 时不崩", () => {
  it("合法值原样返回（缩放夹紧）", () => {
    expect(normalizeTransform({ scale: 2, x: 5, y: -5 })).toEqual({ scale: 2, x: 5, y: -5 });
    expect(normalizeTransform({ scale: 99, x: 0, y: 0 })).toEqual({ scale: MAX_SCALE, x: 0, y: 0 });
  });

  it("垃圾输入返回 null，而不是 NaN 变换（NaN 会让整页消失）", () => {
    expect(normalizeTransform(null)).toBeNull();
    expect(normalizeTransform(undefined)).toBeNull();
    expect(normalizeTransform("nope")).toBeNull();
    expect(normalizeTransform({ scale: 1 })).toBeNull();
    expect(normalizeTransform({ scale: "x", x: 1, y: 2 })).toBeNull();
    expect(normalizeTransform({ scale: Number.NaN, x: 0, y: 0 })).toBeNull();
  });
});

describe("常量契约", () => {
  it("拖动阈值必须大于 0，否则链接永远点不开", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThan(0);
  });
  it("缩放范围合理（能缩小到 20%，能放大到 8 倍）", () => {
    expect(MIN_SCALE).toBeLessThan(1);
    expect(MAX_SCALE).toBeGreaterThanOrEqual(4);
  });
});
