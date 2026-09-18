/* ============================================================================
 * Zoomable Reader · 手机上的图片手势（不依赖 obsidian，可在真浏览器里验证）
 * ---------------------------------------------------------------------------
 * 需求（来自手机用户）：阅读视图里【双击图片】应该放大查看，而不是进入编辑模式 ——
 * 「阅读模式必须通过菜单里的按钮才能进编辑，双击进编辑是很糟糕的体验」。
 *
 * 为什么要吃掉双击：Obsidian 在阅读视图里对图片的双击有自己的含义（进入编辑/块菜单），
 * 手机上没有悬停、手指也点不准那枚小按钮，所以最自然的手势就是双击。这里在【捕获阶段】
 * 吃掉它（preventDefault + stopPropagation + stopImmediatePropagation），再打开我们的查看器。
 *
 * 只在手机生效（options.mobile）：桌面上双击图片没有「进编辑」的语义，不该插手。
 * 只在阅读视图里生效：编辑模式、其它视图一律不动。
 * 手势判定自己实现（两次 tap 之间的时间与位移），因为真机上不一定有 dblclick。
 * ========================================================================== */

import { findLightboxTarget, type LightboxTarget } from "./lightbox";

export interface MobileImageGestureOptions {
  /** 只在移动端启用（桌面为 false → 整个模块不挂任何监听） */
  mobile: boolean;
  /** 是否接管图片 */
  images: boolean;
  /** 是否接管图表（mermaid 等） */
  diagrams: boolean;
  /** 双击命中后打开查看器 */
  onOpen: (target: LightboxTarget) => void;
  /** 双击时间窗（毫秒），默认 320 */
  doubleTapMs?: number;
  /** 双击位移容差（px），默认 32 */
  doubleTapSlop?: number;
  /** 命中统计（验证台用；真实环境不传） */
  onHit?: (target: LightboxTarget, gesture: "dblclick" | "double-tap") => void;
}

const READING_VIEW = ".markdown-reading-view";

/**
 * 挂上「阅读视图内双击图片/图表 = 放大」的手势；返回卸载函数。
 * mobile 为 false 时是空操作（不留任何监听）。
 */
export function installMobileImageGestures(doc: Document, options: MobileImageGestureOptions): () => void {
  if (!options.mobile) return () => {};

  const doubleTapMs = options.doubleTapMs === undefined ? 320 : options.doubleTapMs;
  const doubleTapSlop = options.doubleTapSlop === undefined ? 32 : options.doubleTapSlop;
  let lastTapAt = 0;
  let lastTapPoint = { x: 0, y: 0 };
  /* 一次双击可能从两条路径到达：触摸的两次 tap（touchend）与浏览器合成的 dblclick。
   * 顺序在不同浏览器/不同帧率下并不固定（实测：合成 dblclick 有时先到）。
   * 所以两边互斥：任一条路径打开过，另一条在窗口期内只吃掉事件、不再打开。 */
  let openedAt = 0;
  const DOUBLE_OPEN_WINDOW_MS = 700;

  /** 命中判定：必须落在阅读视图里的图片/图表上（编辑模式与其它视图不碰） */
  const hit = (target: EventTarget | null): LightboxTarget | null => {
    if (!(target instanceof Element)) return null;
    if (!target.closest(READING_VIEW)) return null;
    return findLightboxTarget(target, { images: options.images, diagrams: options.diagrams });
  };

  /** 吃掉这次事件：既不让 Obsidian 进编辑，也不让它再往上冒 */
  const consume = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const stoppable = event as Event & { stopImmediatePropagation?: () => void };
    if (typeof stoppable.stopImmediatePropagation === "function") stoppable.stopImmediatePropagation();
  };

  const onDblClick = (event: MouseEvent): void => {
    const target = hit(event.target);
    if (!target) return;
    consume(event);
    const now = Date.now();
    if (now - openedAt < DOUBLE_OPEN_WINDOW_MS) return; /* 触摸那条路径已经开过了 */
    openedAt = now;
    if (options.onHit) options.onHit(target, "dblclick");
    options.onOpen(target);
  };

  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length > 0) return; /* 只在最后一根手指抬起时判定 */
    const touch = event.changedTouches[0];
    if (!touch) return;
    const target = hit(event.target);
    if (!target) return;

    const now = Date.now();
    const moved = Math.hypot(touch.clientX - lastTapPoint.x, touch.clientY - lastTapPoint.y);
    const isDoubleTap = now - lastTapAt <= doubleTapMs && moved <= doubleTapSlop;
    if (!isDoubleTap) {
      lastTapAt = now;
      lastTapPoint = { x: touch.clientX, y: touch.clientY };
      return;
    }
    lastTapAt = 0;
    consume(event);
    if (now - openedAt < DOUBLE_OPEN_WINDOW_MS) return; /* 合成的 dblclick 已经开过了 */
    openedAt = now;
    if (options.onHit) options.onHit(target, "double-tap");
    options.onOpen(target);
  };

  doc.addEventListener("dblclick", onDblClick, { capture: true });
  doc.addEventListener("touchend", onTouchEnd, { capture: true });

  return () => {
    doc.removeEventListener("dblclick", onDblClick, { capture: true });
    doc.removeEventListener("touchend", onTouchEnd, { capture: true });
    lastTapAt = 0;
  };
}
