/* ============================================================================
 * Zoomable Reader · 缩放平移核心（不依赖 obsidian / Electron，可单独测试）
 * ---------------------------------------------------------------------------
 * 分两层：
 *   ① 纯函数（zoomAt / fitScale / clampScale …）—— 只有数学，vitest 直接测；
 *   ② ZoomPanLayer —— 把纯函数接到 DOM 手势上（Pointer Events 统一鼠标与触摸）。
 *
 * 为什么用 Pointer Events 而不是 touchstart/mousedown 各写一套：
 * 指针事件把鼠标、触控笔、手指统一成同一种事件流，双指捏合只需维护一个
 * 「活跃指针表」，代码路径只有一条 —— 少一套分支就少一类只在手机上出现的 bug。
 * ========================================================================== */

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

/** 白板模式的缩放下限更低：一张几百张卡片的白板要能一眼看全（「回到全图」）。 */
export const BOARD_MIN_SCALE = 0.05;

/** 双指捏合灵敏度：1 = 手指距离翻倍即放大一倍（默认）。 */
export const PINCH_SENSITIVITY_DEFAULT = 1;

/** 拖动判定阈值（px）：小于它算“点击”，大于它才算“平移”，否则链接点不动 */
export const DRAG_THRESHOLD = 5;

/** 双击/双击（double tap）判定的时间与位移窗口 */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 28;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampScale(scale: number, min: number = MIN_SCALE, max: number = MAX_SCALE): number {
  return clamp(scale, min, max);
}

export function identity(): Transform {
  return { scale: 1, x: 0, y: 0 };
}

/** 以视口坐标 (px, py) 为锚点缩放：该点在屏幕上保持不动。 */
export function zoomAt(
  t: Transform,
  factor: number,
  px: number,
  py: number,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): Transform {
  const scale = clampScale(t.scale * factor, min, max);
  const k = scale / t.scale;
  return { scale: scale, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
}

export function panBy(t: Transform, dx: number, dy: number): Transform {
  return { scale: t.scale, x: t.x + dx, y: t.y + dy };
}

/** 内容宽度适配视口所需的缩放比（用于「适配宽度」按钮）。 */
export function fitScale(
  viewport: number,
  content: number,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): number {
  if (!(content > 0) || !(viewport > 0)) return 1;
  return clampScale(viewport / content, min, max);
}

/**
 * 把内容坐标系里的一块矩形（白板上的一张卡片 / 整块白板）放进视口：
 * 缩放取「宽高都能装下」的较小值，然后居中。用于「聚焦卡片」与「回到全图」。
 *
 * 注意 rect 必须用【内容坐标】（未变换时的坐标），这样在任意当前缩放下都能算出正确目标。
 */
export function fitRect(
  viewport: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
  padding: number = 24,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): Transform {
  const vw = Math.max(1, viewport.width - padding * 2);
  const vh = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(Math.min(fitScale(vw, rect.width, min, max), fitScale(vh, rect.height, min, max)), min, max);
  return {
    scale: scale,
    x: padding + (vw - rect.width * scale) / 2 - rect.x * scale,
    y: padding + (vh - rect.height * scale) / 2 - rect.y * scale,
  };
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function transformCss(t: Transform): string {
  return "translate3d(" + t.x + "px, " + t.y + "px, 0) scale(" + t.scale + ")";
}

export function formatPercent(scale: number): string {
  return Math.round(scale * 100) + "%";
}

/** 把任意来源的（可能残缺、可能来自旧版本 data.json 的）状态收敛成合法 Transform。 */
export function normalizeTransform(raw: unknown, min: number = MIN_SCALE, max: number = MAX_SCALE): Transform | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Transform>;
  const scale = Number(r.scale);
  const x = Number(r.x);
  const y = Number(r.y);
  if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { scale: clampScale(scale, min, max), x: x, y: y };
}

export interface ZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  /** 双击放大到的倍数（再双击回到 100%） */
  doubleTapZoom?: number;
  /** 双指捏合是否可用（默认 true）。关掉后双指只跟随中点平移，不改缩放。 */
  pinch?: boolean;
  /** 双指灵敏度：1 = 手指距离翻倍即放大一倍（默认） */
  pinchSensitivity?: number;
  /** 状态每次变化都回调（调用方自行节流，用于持久化） */
  onCommit?: (t: Transform) => void;
}

interface ResolvedOptions {
  minScale: number;
  maxScale: number;
  doubleTapZoom: number;
  pinch: boolean;
  pinchSensitivity: number;
  onCommit: ((t: Transform) => void) | null;
}

/* ============================================================================
 * ZoomPanLayer：把纯函数接到真实手势上
 * ========================================================================== */

export class ZoomPanLayer {
  private viewport: HTMLElement;
  private content: HTMLElement;
  private opts: ResolvedOptions;

  private t: Transform = identity();
  private pointers: Map<number, Point> = new Map();
  private pinchDistance = 0;
  private pinchMid: Point = { x: 0, y: 0 };
  private dragging = false;
  private moved = false;
  private downPoint: Point = { x: 0, y: 0 };
  private lastTapTime = 0;
  private lastTapPoint: Point = { x: 0, y: 0 };
  private cleanup: Array<() => void> = [];

  constructor(viewport: HTMLElement, content: HTMLElement, options: ZoomPanOptions = {}) {
    this.viewport = viewport;
    this.content = content;
    this.opts = {
      minScale: options.minScale === undefined ? MIN_SCALE : options.minScale,
      maxScale: options.maxScale === undefined ? MAX_SCALE : options.maxScale,
      doubleTapZoom: options.doubleTapZoom === undefined ? 2 : options.doubleTapZoom,
      pinch: options.pinch === undefined ? true : options.pinch,
      pinchSensitivity:
        options.pinchSensitivity === undefined ? PINCH_SENSITIVITY_DEFAULT : clamp(options.pinchSensitivity, 0.25, 3),
      onCommit: options.onCommit === undefined ? null : options.onCommit,
    };

    /* transform-origin 与 will-change 由 styles.css 声明（静态样式不进内联），
     * 这里只负责每帧变化的 transform。 */

    this.bind(this.viewport, "wheel", this.onWheel, { passive: false });
    this.bind(this.viewport, "pointerdown", this.onPointerDown);
    this.bind(this.viewport, "pointermove", this.onPointerMove);
    this.bind(this.viewport, "pointerup", this.onPointerUp);
    this.bind(this.viewport, "pointercancel", this.onPointerUp);
    /* 拖动之后紧跟的那次 click 要吃掉，否则平移一下就把链接点开了 */
    this.bind(this.viewport, "click", this.onClickCapture, true);

    this.apply();
  }

  private bind(
    target: HTMLElement,
    type: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  get transform(): Transform {
    return { scale: this.t.scale, x: this.t.x, y: this.t.y };
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  setTransform(next: Transform, notify: boolean = true): void {
    this.t = {
      scale: clampScale(next.scale, this.opts.minScale, this.opts.maxScale),
      x: next.x,
      y: next.y,
    };
    this.apply();
    if (notify) this.commit();
  }

  private apply(): void {
    this.content.style.transform = transformCss(this.t);
  }

  private commit(): void {
    if (this.opts.onCommit) this.opts.onCommit(this.transform);
  }

  private focal(event: { clientX: number; clientY: number }): Point {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  zoomBy(factor: number, focal?: Point): void {
    const p = focal === undefined ? { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 } : focal;
    this.t = zoomAt(this.t, factor, p.x, p.y, this.opts.minScale, this.opts.maxScale);
    this.apply();
    this.commit();
  }

  zoomTo(scale: number, focal?: Point): void {
    const target = clampScale(scale, this.opts.minScale, this.opts.maxScale);
    if (this.t.scale === 0) return;
    this.zoomBy(target / this.t.scale, focal);
  }

  /**
   * 适配宽度：把内容整体缩进视口，并回到左上角留一点内边距。
   * maxScale 是【上限】而不是目标值：传 1 表示「装得下就原样放，装不下才缩」——
   * 查看器用它保证打开时绝不会把图放大到超过原图分辨率（放大是插值，等于糊）。
   */
  fitWidth(padding: number = 16, maxScale?: number): void {
    const contentWidth = this.content.scrollWidth || this.content.offsetWidth;
    const limit = maxScale === undefined ? this.opts.maxScale : Math.min(maxScale, this.opts.maxScale);
    const scale = fitScale(this.viewport.clientWidth - padding * 2, contentWidth, this.opts.minScale, limit);
    this.setTransform({ scale: scale, x: padding, y: padding });
  }

  /**
   * 聚焦一块内容矩形（白板上的卡片、或整块白板）：把它居中铺满视口。
   * rect 用内容坐标；padding 是四周留白。
   */
  focusRect(rect: { x: number; y: number; width: number; height: number }, padding: number = 24): void {
    const t = fitRect(
      { width: this.viewport.clientWidth, height: this.viewport.clientHeight },
      rect,
      padding,
      this.opts.minScale,
      this.opts.maxScale
    );
    this.setTransform(t);
  }

  /** 复位：100% + 左上角内边距 */
  reset(padding: number = 16): void {
    this.setTransform({ scale: 1, x: padding, y: padding });
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.pointers.clear();
  }

  /* ------------------------------------------------------------------ 手势 */

  private onWheel = (event: WheelEvent): void => {
    /* 桌面端约定：Ctrl/⌘ + 滚轮 = 缩放（与浏览器、Obsidian 的画布一致），
     * 普通滚轮 = 平移（读长文时不希望一动滚轮就缩放）。 */
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY / 300);
      this.zoomBy(factor, this.focal(event));
      return;
    }
    event.preventDefault();
    this.t = panBy(this.t, -event.deltaX, -event.deltaY);
    this.apply();
    this.commit();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    /* 刻意【不】在按下时就 setPointerCapture：
     * 指针被捕获后，随后的 click 事件会重定向到捕获元素（视口），
     * 于是板子里的链接、脚注就再也点不开了 —— 这是实测踩到的坑
     * （真实鼠标按下抬起时 link 收不到 click，而 elementFromPoint 明明是它）。
     * 改为「确认是拖动 / 出现第二根手指」时才捕获：点击路径不受影响，
     * 拖动路径依旧能在指针移出视口后继续跟随。 */
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.moved = false;
      this.downPoint = { x: event.clientX, y: event.clientY };
    } else if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      this.pinchDistance = distance(pts[0], pts[1]);
      this.pinchMid = midpoint(pts[0], pts[1]);
      /* 双指一定是手势，不会产生「点链接」的意图，这里直接捕获两根手指 */
      for (const id of this.pointers.keys()) this.capture(id);
    }
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const prev = this.pointers.get(event.pointerId) as Point;
    const next = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, next);

    if (this.pointers.size >= 2) {
      const pts = Array.from(this.pointers.values());
      const dist = distance(pts[0], pts[1]);
      const mid = midpoint(pts[0], pts[1]);
      const rect = this.viewport.getBoundingClientRect();
      /* 双指：以两指中点为锚点缩放，同时跟随中点平移 —— 一个手势里同时做到
       * “放大”和“挪动”，这是捏合手感自然的关键。 */
      if (this.opts.pinch && this.pinchDistance > 0 && dist > 0) {
        /* 灵敏度指数：1 = 手指距离翻倍即放大一倍；>1 更灵敏，<1 更细腻。
         * 用幂而不是乘法，是为了「反过来捏回去」能精确回到原缩放（可逆）。 */
        const ratio = dist / this.pinchDistance;
        const factor = this.opts.pinchSensitivity === 1 ? ratio : Math.pow(ratio, this.opts.pinchSensitivity);
        this.t = zoomAt(this.t, factor, mid.x - rect.left, mid.y - rect.top, this.opts.minScale, this.opts.maxScale);
      }
      this.t = panBy(this.t, mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
      this.pinchDistance = dist;
      this.pinchMid = mid;
      this.moved = true;
      this.apply();
      this.commit();
      event.preventDefault();
      return;
    }

    if (!this.dragging) return;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    if (!this.moved && distance(next, this.downPoint) > DRAG_THRESHOLD) {
      this.moved = true;
      /* 确认是拖动后才捕获：此刻起指针移出视口也继续跟随 */
      this.capture(event.pointerId);
    }
    if (this.moved) {
      this.t = panBy(this.t, dx, dy);
      this.apply();
      this.commit();
      event.preventDefault();
    }
  };

  private capture(pointerId: number): void {
    try {
      this.viewport.setPointerCapture(pointerId);
    } catch {
      /* 合成事件或已释放的指针会抛，忽略即可 */
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    const point = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    try {
      this.viewport.releasePointerCapture(event.pointerId);
    } catch {
      /* 未捕获过 / 已释放，忽略即可 */
    }
    if (this.pointers.size < 2) {
      this.pinchDistance = 0;
    }
    if (this.pointers.size === 0) {
      this.dragging = false;
      if (point && !this.moved) this.handleTap(point);
      /* 刻意【不】在这里清 moved：紧跟其后的 click 还要用它来判断
       * 「这次点击是拖动的尾巴，不该当成点击」。
       * 反例（实测踩到）：拖动图片查看器后 click 的 target 会变成视口，
       * 若此时 moved 已归零，查看器会把拖动误判成「点空白」而自己关掉。
       * moved 会在下一次 pointerdown 时归零，也会在 onClickCapture 消费后归零。 */
    }
  };

  /** 双击 / 双指轻点两下：在 100% 与 doubleTapZoom 之间切换（以点击处为锚点）。
   * 刻意**不**同时监听原生 dblclick：鼠标双击会同时产生「两次 pointerup」和一次
   * dblclick，两条路径各切一次，正好互相抵消（实测 scale 回到 1，双击看起来失灵）。
   * 只保留基于 pointer 的这一条，鼠标与手指走同一段代码。 */
  private handleTap(point: Point): void {
    const now = Date.now();
    const isDouble = now - this.lastTapTime < DOUBLE_TAP_MS && distance(point, this.lastTapPoint) < DOUBLE_TAP_SLOP;
    if (!isDouble) {
      this.lastTapTime = now;
      this.lastTapPoint = point;
      return;
    }
    this.lastTapTime = 0;
    const rect = this.viewport.getBoundingClientRect();
    const focal = { x: point.x - rect.left, y: point.y - rect.top };
    if (this.t.scale > 1.01) {
      this.zoomTo(1, focal);
    } else {
      this.zoomTo(this.opts.doubleTapZoom, focal);
    }
  }

  private onClickCapture = (event: MouseEvent): void => {
    if (!this.moved) return;
    this.moved = false;
    /* 拖动结束后的那次 click 属于「平移」而非「点击」：
     * 既不能点开链接，也不能被上层当成「点空白背景」。 */
    event.preventDefault();
    event.stopPropagation();
  };
}
