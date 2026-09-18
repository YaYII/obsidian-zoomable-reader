/* ============================================================================
 * Zoomable Reader · 手机阅读视图里的双击（不依赖 obsidian，可在真浏览器里验证）
 * ---------------------------------------------------------------------------
 * 需求（来自手机用户，两次反馈合并）：
 *   ① 「阅读模式必须通过菜单按钮进入编辑，双击进编辑是很糟糕的体验」→ 手机上在阅读视图里
 *      **双击任何地方都不该进入编辑**（正文、图片、图表都一样）；
 *   ② 「双击图片应该可以放大」→ 双击图片/图表时打开可缩放的查看器。
 *
 * 为什么不是只拦图片（第一版就是这么写的，被用户当场打回）：Obsidian 的双击进编辑是
 * **整个阅读视图**的手势，点在正文上也会触发 —— 只拦图片等于没拦。
 *
 * 实现要点（都是实测教训）：
 *   · 一个「双击」在触摸设备上会走多条事件路径：两次 tap（touchend / pointerup）、
 *     合成的 click、合成的 dblclick，**顺序不稳定**。所以四条路径都要拦，
 *     并且用同一个「本次手势已处理」窗口保证只执行一次业务动作。
 *   · 注册在 window + document 的**捕获阶段**，且插件加载时就注册（尽早排队），
 *     这样宿主的冒泡处理拿不到这次事件。
 *   · 只吃掉「第二次 tap 及其后续」：单击、滚动、链接点击、文本选择一律照旧。
 *   · 只在移动端、只在 .markdown-reading-view 内生效；桌面与编辑模式完全不碰。
 * ========================================================================== */

import { findLightboxTarget, type LightboxTarget } from "./lightbox";

const READING_VIEW = ".markdown-reading-view";

export interface MobileReadingTapOptions {
  /** 只在移动端启用（桌面为 false → 不挂任何监听） */
  mobile: boolean;
  /** 手机上禁止「双击进入编辑」（阅读视图内任何位置） */
  blockDoubleTapEdit: boolean;
  /** 双击图片 → 打开查看器 */
  images: boolean;
  /** 双击图表 → 打开查看器 */
  diagrams: boolean;
  /** 打开查看器 */
  onOpen: (target: LightboxTarget) => void;
  /** 每次拦截的回调（自检开关用它弹提示；验证台用它计数） */
  onIntercept?: (info: {
    gesture: string;
    kind: LightboxTarget["kind"] | "text";
    opened: boolean;
    /** 命中的元素（排查用：tag#id.class） */
    element: string;
    /** 产生这次判定的原始事件类型 */
    eventType: string;
  }) => void;
  /** 双击时间窗（毫秒），默认 320 */
  doubleTapMs?: number;
  /** 双击位移容差（px），默认 32 */
  doubleTapSlop?: number;
}

/** 需要监听的路径：
 *   · touchstart —— 识别「多指手势」，别把捏合算成单击（实测踩到）；
 *   · touchend   —— 触摸设备上【唯一的 tap 计数来源】；
 *   · pointerup / click / dblclick —— 同一次双击的其余路径，只用于「吃掉」，不计数。 */
const TAP_EVENTS = ["touchstart", "touchend", "pointerup", "click", "dblclick"] as const;

/**
 * 命中判定：必须落在阅读视图里。
 * 图片/图表用宽松一点的口径 —— 链接里的图片也算（单击仍然归链接，只有双击才归我们）。
 */
/** 元素的人话描述（排查用） */
function describe(element: Element): string {
  const id = element.id ? "#" + element.id : "";
  const cls = typeof element.className === "string" && element.className ? "." + element.className.split(" ")[0] : "";
  return element.tagName.toLowerCase() + id + cls;
}

function targetInReadingView(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(READING_VIEW);
}

function zoomableTarget(element: Element, options: MobileReadingTapOptions): LightboxTarget | null {
  if (options.images || options.diagrams) {
    const relaxed = findLightboxTarget(element, { images: options.images, diagrams: options.diagrams });
    if (relaxed) return relaxed;
  }
  /* findLightboxTarget 对链接里的图片会返回 null（单击要归链接）；
   * 但双击是我们接管的手势，链接里的图片也应该能放大。 */
  const img = element.closest("img");
  if (options.images && img) return { kind: "image", element: img };
  const svg = element.closest("svg");
  if (options.diagrams && svg) return { kind: "diagram", element: svg };
  return null;
}

export function installMobileReadingTaps(doc: Document, options: MobileReadingTapOptions): () => void {
  if (!options.mobile || (!options.blockDoubleTapEdit && !options.images && !options.diagrams)) {
    return () => {};
  }

  const win = doc.defaultView;
  const doubleTapMs = options.doubleTapMs === undefined ? 320 : options.doubleTapMs;
  const doubleTapSlop = options.doubleTapSlop === undefined ? 32 : options.doubleTapSlop;

  let lastTapAt = 0;
  let lastTapPoint = { x: 0, y: 0 };
  /** 本次双击已经处理过（打开或已拦下）：同组的后续事件只吃掉、不再执行业务动作 */
  let swallowUntil = 0;
  /** 正在进行的是一次【多指手势】（捏合/双指滚动）：不算 tap，也不参与双击判定 */
  let multiTouch = false;
  /* 同一个事件会先经过 window 捕获、再经过 document 捕获 —— 我们两处都挂了监听，
   * 必须去重：否则一次 touchend 被处理两次，第一次记成「第一次 tap」、第二次就变成
   * 「第二次 tap」→ 单击被误判成双击（实测踩到，验证台抓的）。 */
  const seen = new WeakSet<Event>();
  /* 命中判定用【这次触摸的起点元素】，而不是 touchend 的 target：
   * 实测 touchstart/pointerup 的 target 是图片，而同一个手势的 touchend 目标会变成容器 div ——
   * 拿它判命中会得到「点了正文」的结论，双击图片就永远打不开。 */
  let currentStart: { element: Element; point: { x: number; y: number } } | null = null;

  /** 吃掉这次事件：不让宿主在冒泡阶段看到它 */
  const consume = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const stoppable = event as Event & { stopImmediatePropagation?: () => void };
    if (typeof stoppable.stopImmediatePropagation === "function") stoppable.stopImmediatePropagation();
  };

  const pointOf = (event: Event): { x: number; y: number } | null => {
    if (event instanceof TouchEvent) {
      const touch = event.changedTouches[0];
      return touch ? { x: touch.clientX, y: touch.clientY } : null;
    }
    if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
    return null;
  };

  /**
   * 命中判定：先看事件/起点的元素，再【按坐标兜底】。
   * 实测：同一个手势里 touchstart 的 target 是图片，touchend 与合成 dblclick 的 target
   * 却会是容器 div —— 只认 target 会得到「点了正文」的错误结论。坐标兜底最可靠。
   */
  const resolveHit = (element: Element | null, point: { x: number; y: number } | null): LightboxTarget | null => {
    if (element) {
      const direct = zoomableTarget(element, options);
      if (direct) return direct;
    }
    if (point && typeof doc.elementFromPoint === "function") {
      const at = doc.elementFromPoint(point.x, point.y);
      if (at instanceof Element) return zoomableTarget(at, options);
    }
    return null;
  };

  /** 双击成立：拦下这次事件；命中图片/图表就打开查看器（每次双击只执行一次） */
  const handleDoubleTap = (
    event: Event,
    element: Element | null,
    point: { x: number; y: number } | null,
    gesture: "double-tap" | "dblclick"
  ): void => {
    consume(event);
    swallowUntil = Date.now() + 700; /* 同组的其余路径（合成 click / dblclick）只吃掉 */
    const zoomable = resolveHit(element, point);
    if (zoomable) options.onOpen(zoomable);
    if (options.onIntercept) {
      options.onIntercept({
        gesture: gesture,
        kind: zoomable ? zoomable.kind : "text",
        opened: !!zoomable,
        element: element ? describe(element) : "(按坐标命中)",
        eventType: event.type,
      });
    }
  };

  const handler = (event: Event): void => {
    if (seen.has(event)) return;
    seen.add(event);
    const element = targetInReadingView(event.target);
    if (!element) return;
    const now = Date.now();

    /* 多指手势的第一步：标记并清掉 tap 状态 —— 捏合的 touchend 绝不能被当成单击 */
    if (event.type === "touchstart") {
      const touchEvent = event as TouchEvent;
      if (touchEvent.touches.length >= 2) {
        multiTouch = true;
        lastTapAt = 0;
        currentStart = null;
        return;
      }
      const touch = touchEvent.touches[0];
      if (touch) currentStart = { element: element, point: { x: touch.clientX, y: touch.clientY } };
      return;
    }

    /* 本次双击的后续事件（pointerup / click / 合成 dblclick）：吃掉即可 */
    if (now < swallowUntil) {
      consume(event);
      return;
    }

    /* 合成 dblclick：它本身就是「双击」，直接处理（也是宿主最常用的编辑触发点） */
    if (event.type === "dblclick") {
      const point = pointOf(event);
      if (!options.blockDoubleTapEdit && !resolveHit(element, point)) return;
      handleDoubleTap(event, element, point, "dblclick");
      return;
    }

    /* 触摸设备的 tap 计数只认 touchend（pointerup/click 会重复计一次） */
    if (event.type !== "touchend") return;
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length > 0) return; /* 还有手指没抬起来 */
    if (multiTouch) {
      multiTouch = false;
      lastTapAt = 0;
      return;
    }
    const point = pointOf(event);
    if (!point) return;
    const moved = Math.hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y);
    const isSecondTap = now - lastTapAt <= doubleTapMs && moved <= doubleTapSlop;
    if (!isSecondTap) {
      lastTapAt = now;
      lastTapPoint = point;
      return;
    }
    lastTapAt = 0;
    /* 命中用【起点元素】+ 坐标兜底（见 resolveHit 的注释） */
    const hitElement = currentStart ? currentStart.element : element;
    const hitPoint = point;
    if (!options.blockDoubleTapEdit && !resolveHit(hitElement, hitPoint)) return; /* 两个开关都关：不插手 */
    handleDoubleTap(event, hitElement, hitPoint, "double-tap");
  };

  /* window 与 document 的捕获阶段都挂：既早于宿主的冒泡处理，也不怕它只在某一层监听 */
  const targets: EventTarget[] = [doc];
  if (win) targets.push(win);
  for (const target of targets) {
    for (const type of TAP_EVENTS) {
      /* touchstart 只用来识别多指，必须是被动的（否则会拖慢单指滚动） */
      target.addEventListener(type, handler, { capture: true, passive: type !== "touchstart" });
    }
  }

  return () => {
    for (const target of targets) {
      for (const type of TAP_EVENTS) {
        target.removeEventListener(type, handler, { capture: true });
      }
    }
    lastTapAt = 0;
    swallowUntil = 0;
    multiTouch = false;
  };
}
