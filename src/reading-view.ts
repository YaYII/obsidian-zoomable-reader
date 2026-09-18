/* ============================================================================
 * Zoomable Reader · 阅读视图的宽度与缩放（不依赖 obsidian，可在真浏览器里验证）
 * ---------------------------------------------------------------------------
 * 用户读的是 Obsidian 自己的阅读视图，本插件不接管它 —— 但可以【改它的样式】，
 * 于是「版心宽度」与「缩放」都归插件调，且不动任何主题文件：
 *
 *   ① 版心宽度：往 head 注入一条规则，把 .markdown-reading-view 上的
 *      --file-line-width / --line-width 改成用户要的值（Obsidian 与主题读的就是它），
 *      再补一条 sizer 的 max-width 兜底（有的主题把宽度写死在选择器里）。
 *
 *   ② 缩放：用 CSS 的 zoom（Chromium 与 WebKit 都支持，而且会【重排】，
 *      不像 transform 只是视觉拉伸）。关键细节：zoom 之后 sizer 的 max-width 要按
 *      比例除掉，否则屏幕上的版心会跟着变宽、一行变长 —— 那不是阅读，是横向溢出。
 *      「字变大、行宽不变」才是读者要的缩放。
 *
 * 手势（只在阅读视图里生效）：
 *   · 手机：双指捏合 → 改缩放；
 *   · 桌面：Ctrl / ⌘ + 滚轮 → 改缩放；
 *   · 单指滚动、单击、普通滚轮一律不插手，仍旧归 Obsidian 自己。
 * ========================================================================== */

/** CSS zoom 的下限与上限（再大就不是阅读，是放大镜）。 */
export const READING_ZOOM_MIN = 0.6;
export const READING_ZOOM_MAX = 2;
export const READING_ZOOM_STEP = 0.05;
export const STYLE_ELEMENT_ID = "zr-reading-style";
export const READING_VIEW_SELECTOR = ".markdown-reading-view";

/** 阅读视图里图片怎么占宽度：撑满版心（等比放大）/ 不超过版心 / 原始尺寸 */
export type ReadingImageWidth = "fill" | "contain" | "natural";

export interface ReadingViewOptions {
  /** 版心宽度（px），"theme" = 跟随主题（不注入任何宽度规则） */
  lineWidth: number | "theme";
  /** 缩放倍率（1 = 100%） */
  zoom: number;
  /** 是否启用手势缩放（手机双指捏合 / 桌面 Ctrl+滚轮） */
  gestures: boolean;
  /** 图片宽度策略（默认撑满版心：等比放大，不裁剪、不拉伸） */
  imageWidth: ReadingImageWidth;
}

export function clampReadingZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(READING_ZOOM_MAX, Math.max(READING_ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/** 生成注入的 CSS。纯函数：单测直接断言字符串，不用起浏览器。 */
export function readingCss(options: ReadingViewOptions): string {
  const zoom = clampReadingZoom(options.zoom);
  const width = options.lineWidth === "theme" ? null : Math.max(240, Math.round(options.lineWidth));
  const rules: string[] = [];

  if (width !== null) {
    rules.push(
      [
        READING_VIEW_SELECTOR + ",",
        READING_VIEW_SELECTOR + " .markdown-preview-view {",
        "  --file-line-width: " + width + "px;",
        "  --line-width: " + width + "px;",
        "}",
      ].join("\n")
    );
    /* 兜底：主题若把宽度写死在 sizer 上，这一条仍然生效。
     * 先按 zoom 除掉：CSS px 会被 zoom 再放大一次，除掉之后屏幕上的版心才是 width。 */
    rules.push(
      READING_VIEW_SELECTOR + " .markdown-preview-sizer { max-width: " + (width / zoom).toFixed(2) + "px !important; }"
    );
  }

  if (zoom !== 1) {
    rules.push(READING_VIEW_SELECTOR + " { zoom: " + zoom + "; }");
  }

  /* 图片：默认【撑满版心】——按版心宽度等比放大，高度自动，绝不拉伸变形。
   * 显式写了宽度的图片（![[x.png|300]]）也被统一到版心宽度：用户要的是
   * 「严格按照插件约束的宽度显示」，不是每张图各说各话。
   * 只作用于阅读视图，编辑模式与其它视图不受影响。 */
  if (options.imageWidth === "fill") {
    rules.push(
      READING_VIEW_SELECTOR + " .markdown-preview-view img,\n" +
        READING_VIEW_SELECTOR + " .markdown-preview-view video {\n" +
        "  width: 100% !important;\n" +
        "  max-width: 100% !important;\n" +
        "  height: auto !important;\n" +
        "  object-fit: contain;\n" +
        "}"
    );
  } else if (options.imageWidth === "contain") {
    rules.push(
      READING_VIEW_SELECTOR + " .markdown-preview-view img,\n" +
        READING_VIEW_SELECTOR + " .markdown-preview-view video {\n" +
        "  max-width: 100% !important;\n" +
        "  height: auto !important;\n" +
        "}"
    );
  }

  if (options.gestures) {
    /* 必须有这一条：否则浏览器会把双指当成它自己的捏合手势，事件被掐断（实测踩到：
     * 10 帧手势只收到 2 次）。pan-y = 单指纵向滚动照旧，双指捏合归我们。 */
    rules.push(READING_VIEW_SELECTOR + " { touch-action: pan-y; }");
  }

  return rules.join("\n");
}

/** 注入/更新样式表；返回可随时改设置、可卸载的句柄。 */
export function installReadingStyle(
  doc: Document,
  initial: ReadingViewOptions
): { update: (next: ReadingViewOptions) => void; destroy: () => void } {
  let style: HTMLStyleElement | null = null;

  const write = (options: ReadingViewOptions): void => {
    const css = readingCss(options);
    if (css === "") {
      /* 跟随主题 + 100%：不留任何注入痕迹 */
      if (style) {
        style.remove();
        style = null;
      }
      return;
    }
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ELEMENT_ID;
      (doc.head || doc.documentElement).appendChild(style);
    }
    style.textContent = css;
  };

  write(initial);
  return {
    update: write,
    destroy: () => {
      if (style) {
        style.remove();
        style = null;
      }
    },
  };
}

export interface ReadingGestureOptions {
  /** 当前缩放（手势在此基础上乘比例） */
  getZoom: () => number;
  /** 缩放变化（已夹紧）；会被节流调用 —— 重排很贵 */
  onZoom: (zoom: number) => void;
  /** 节流窗口（毫秒），默认 80 */
  throttleMs?: number;
}

/**
 * 手势缩放：手机双指捏合 / 桌面 Ctrl+滚轮，只在阅读视图里生效。
 * 返回卸载函数。
 */
export function installReadingGestures(doc: Document, options: ReadingGestureOptions): () => void {
  const win = doc.defaultView;
  const throttleMs = options.throttleMs === undefined ? 80 : options.throttleMs;

  let pinchDistance = 0;
  let pinchZoom = 1;
  let appliedAt = 0;
  let timer: number | null = null;
  let pending: number | null = null;

  const inReadingView = (target: EventTarget | null): boolean =>
    target instanceof Element && !!target.closest(READING_VIEW_SELECTOR);

  const flush = (): void => {
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    appliedAt = Date.now();
    options.onZoom(value);
  };

  const schedule = (zoom: number): void => {
    pending = clampReadingZoom(zoom);
    const elapsed = Date.now() - appliedAt;
    if (elapsed >= throttleMs) {
      flush();
      return;
    }
    if (timer === null && win) timer = win.setTimeout(flush, throttleMs - elapsed);
  };

  const distanceBetween = (touches: TouchList): number =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  /* 为什么用 touch 事件而不是 pointer：双指在页面里是【浏览器自己的手势】，
   * 不 preventDefault 就会被 pointercancel 掐断（实测：10 帧只收到 2 次）。 */
  const onTouchStart = (event: TouchEvent): void => {
    if (!inReadingView(event.target)) return;
    if (event.touches.length !== 2) return;
    pinchDistance = distanceBetween(event.touches);
    pinchZoom = options.getZoom();
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length < 2) return;
    if (!inReadingView(event.target)) return;
    if (pinchDistance === 0) {
      pinchDistance = distanceBetween(event.touches);
      pinchZoom = options.getZoom();
      return;
    }
    const distance = distanceBetween(event.touches);
    if (distance <= 0) return;
    /* 相对手势起点累计（不是逐帧相乘），避免误差滚雪球 */
    schedule(pinchZoom * (distance / pinchDistance));
    event.preventDefault();
  };

  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) pinchDistance = 0;
  };

  const onWheel = (event: WheelEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (!inReadingView(event.target)) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1 + READING_ZOOM_STEP : 1 - READING_ZOOM_STEP;
    schedule(options.getZoom() * factor);
  };

  doc.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  doc.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  doc.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
  doc.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });
  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });

  return () => {
    if (timer !== null && win) win.clearTimeout(timer);
    doc.removeEventListener("touchstart", onTouchStart, { capture: true });
    doc.removeEventListener("touchmove", onTouchMove, { capture: true });
    doc.removeEventListener("touchend", onTouchEnd, { capture: true });
    doc.removeEventListener("touchcancel", onTouchEnd, { capture: true });
    doc.removeEventListener("wheel", onWheel, { capture: true });
    pinchDistance = 0;
  };
}
