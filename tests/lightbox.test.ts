import { describe, expect, it } from "vitest";
import { nativePixelSize } from "../src/lightbox";
import { MIN_SCALE, fitScale } from "../src/zoom-pan";

/* 查看器「高清」的数学契约（真实渲染由 tools/verify-gestures.mjs 在 Chromium 里量）。
 *
 * 用户原话：「双击后的图片，不要压缩了，因为我双击就是需要高清的，否则，放大查看都模糊了」。
 * 症状的根因是换算错了：把源图的自然像素当成 CSS 像素（1600px 的图 = 1600 CSS px），
 * 在 DPR=3 的手机上，100% 其实是把一张 1600px 的位图铺到 4800 个物理像素上 —— 横向拉伸 3 倍。
 * 正确的基准是「1 个源像素 = 1 个设备像素」，也就是 CSS 尺寸 = 自然尺寸 / devicePixelRatio。 */

describe("nativePixelSize：100% 就是原图分辨率", () => {
  it("DPR=3 的手机：1600px 的图摆成 533.33 CSS px（一个源像素对一个物理像素）", () => {
    expect(nativePixelSize(1600, 3)).toBeCloseTo(533.33, 2);
  });

  it("DPR=1 的桌面：与自然尺寸完全相同（老行为不变，不惊动桌面用户）", () => {
    expect(nativePixelSize(1600, 1)).toBe(1600);
    expect(nativePixelSize(200, 1)).toBe(200);
  });

  it("按比例缩放不会丢像素：CSS 尺寸 × DPR = 自然尺寸", () => {
    for (const [natural, dpr] of [
      [1600, 3],
      [3840, 2],
      [900, 1.5],
      [200, 3],
    ] as Array<[number, number]>) {
      expect(nativePixelSize(natural, dpr) * dpr).toBeCloseTo(natural, 0);
    }
  });

  it("devicePixelRatio 不老实（0 / 负数 / NaN / 缺失）时退回 1，不做除零", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nativePixelSize(1600, bad)).toBe(1600);
    }
  });

  it("自然尺寸未知（0 或负数）时返回 0，交给调用方跳过", () => {
    expect(nativePixelSize(0, 3)).toBe(0);
    expect(nativePixelSize(-5, 3)).toBe(0);
  });
});

describe("查看器打开时的适配契约：装得下就 100%，装不下才缩，绝不放大", () => {
  /* fitWidth(padding, 1) 里的 1 就是这条契约：放大是插值，插值就是糊。 */
  it("小图（200px）放进 390px 的手机屏：按 100% 放，不被拉大", () => {
    expect(fitScale(390 - 48, 200, MIN_SCALE, 1)).toBe(1);
  });

  it("大图（1600px）放进同一个屏：缩到装得下", () => {
    expect(fitScale(390 - 48, 1600, MIN_SCALE, 1)).toBeCloseTo(342 / 1600, 4);
  });
});
