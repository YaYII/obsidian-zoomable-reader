import { describe, expect, it } from "vitest";
import { nativePixelSize, parseSrcset, pickHiResSource } from "../src/lightbox";
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

describe("parseSrcset / pickHiResSource：查看器要的是原图，不是正文里那张缩略图", () => {
  /* 用户原话：「点击图片的时候，你需要确定放大的图片是原图高清的」。
   * 正文里的 <img> 可能带 srcset（浏览器按【正文里的显示尺寸】× DPR 挑一张），
   * 也可能被懒加载插件塞了 1px 占位图、真图在 data-src 里。 */

  it("data: URL 里的逗号不是候选分隔符（按逗号 split 会把地址切成半截）", () => {
    const small = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg";
    const big = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgBIG";
    const parts = parseSrcset(small + " 200w, " + big + " 1600w");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ url: small, weight: 200 });
    expect(parts[1]).toEqual({ url: big, weight: 1600 });
  });

  it("普通写法：1x / 2x 描述符、换行、结尾多余逗号都能吃下", () => {
    expect(parseSrcset("a.png 1x, b.png 2x")).toEqual([
      { url: "a.png", weight: 1 },
      { url: "b.png", weight: 2 },
    ]);
    expect(parseSrcset("  a.png 100w,\n  b.png 800w,\n")).toEqual([
      { url: "a.png", weight: 100 },
      { url: "b.png", weight: 800 },
    ]);
    expect(parseSrcset("solo.png")).toEqual([{ url: "solo.png", weight: 1 }]);
  });

  it("挑最大的一张，并且把相对地址按 baseURI 拼成绝对地址", () => {
    expect(pickHiResSource({ srcset: "small.png 200w, big.png 1600w", baseURI: "app://vault/note.md" })).toBe(
      "app://vault/note.md".replace("note.md", "big.png")
    );
    expect(pickHiResSource({ srcset: "a.png 2x, b.png 1x" })).toBe("a.png");
  });

  it("没有 srcset 时用 currentSrc（浏览器已经挑好的那张），再退回 src", () => {
    expect(pickHiResSource({ currentSrc: "app://vault/a.png", src: "app://vault/b.png" })).toBe("app://vault/a.png");
    expect(pickHiResSource({ src: "app://vault/b.png" })).toBe("app://vault/b.png");
  });

  it("src 是 1px 占位图（懒加载）时改用 data-src 的真图", () => {
    const placeholder = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    expect(pickHiResSource({ src: placeholder, dataSrc: "app://vault/real.png" })).toBe("app://vault/real.png");
    /* data-src 也没有：只能返回占位图（调用方自己会量到 1x1） */
    expect(pickHiResSource({ src: placeholder })).toBe(placeholder);
  });

  it("绝对地址与 data: 地址不会被 baseURI 二次拼接", () => {
    expect(pickHiResSource({ src: "https://example.com/a.png", baseURI: "app://vault/note.md" })).toBe("https://example.com/a.png");
    const dataUrl = "data:image/png;base64,AAA";
    expect(pickHiResSource({ srcset: dataUrl + " 900w", baseURI: "app://vault/note.md" })).toBe(dataUrl);
  });
});

