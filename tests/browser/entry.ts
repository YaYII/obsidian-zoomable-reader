/* 浏览器验证台入口：把不依赖 obsidian 的核心挂到 window，供 Playwright 驱动真实事件。 */
import { ZoomPanLayer, formatPercent } from "../../src/zoom-pan";
import { ImageLightbox, registerLightboxClicks } from "../../src/lightbox";

declare global {
  interface Window {
    ZoomPanLayer: typeof ZoomPanLayer;
    ZoomPanFormat: { percent: typeof formatPercent };
    ImageLightbox: typeof ImageLightbox;
    ImageLightboxClicks: typeof registerLightboxClicks;
  }
}

window.ZoomPanLayer = ZoomPanLayer;
window.ZoomPanFormat = { percent: formatPercent };
window.ImageLightbox = ImageLightbox;
window.ImageLightboxClicks = registerLightboxClicks;
