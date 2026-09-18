/* 浏览器验证台入口：把缩放平移核心挂到 window，供 Playwright 驱动真实事件。 */
import { ZoomPanLayer, formatPercent } from "../../src/zoom-pan";

declare global {
  interface Window {
    ZoomPanLayer: typeof ZoomPanLayer;
    ZoomPanFormat: { percent: typeof formatPercent };
  }
}

window.ZoomPanLayer = ZoomPanLayer;
window.ZoomPanFormat = { percent: formatPercent };
