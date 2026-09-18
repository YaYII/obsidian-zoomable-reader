/* 浏览器验证台入口：把不依赖 obsidian 的核心挂到 window，供 Playwright 驱动真实事件。
 * 白板模式现在是「一整张 1280px 宽的版面」，所以这里只需要手势层 + 出厂默认值。 */
import { ZoomPanLayer, formatPercent, fitRect, BOARD_MIN_SCALE } from "../../src/zoom-pan";
import { ImageLightbox, installZoomAffordance } from "../../src/lightbox";
import { DEFAULT_DIAGRAM_LAYOUT, applyDiagramLayout, mergeDiagramConfig } from "../../src/diagram-layout";
import { DEFAULT_SETTINGS, PAPER_WIDTHS_PX, WEB_WIDTH_PX, paperNameFor, widthLabel, widthToMm } from "../../src/settings-spec";

declare global {
  interface Window {
    ZoomPanLayer: typeof ZoomPanLayer;
    ZoomPanFormat: { percent: typeof formatPercent; fitRect: typeof fitRect; boardMinScale: number };
    ImageLightbox: typeof ImageLightbox;
    installZoomAffordance: typeof installZoomAffordance;
    DiagramLayout: {
      apply: typeof applyDiagramLayout;
      merge: typeof mergeDiagramConfig;
      defaults: typeof DEFAULT_DIAGRAM_LAYOUT;
    };
    ZoomableReaderDefaults: typeof DEFAULT_SETTINGS;
    Width: {
      web: number;
      papers: typeof PAPER_WIDTHS_PX;
      nameFor: typeof paperNameFor;
      toMm: typeof widthToMm;
      label: typeof widthLabel;
    };
  }
}

window.ZoomPanLayer = ZoomPanLayer;
window.ZoomPanFormat = { percent: formatPercent, fitRect: fitRect, boardMinScale: BOARD_MIN_SCALE };
window.ImageLightbox = ImageLightbox;
window.installZoomAffordance = installZoomAffordance;
window.DiagramLayout = { apply: applyDiagramLayout, merge: mergeDiagramConfig, defaults: DEFAULT_DIAGRAM_LAYOUT };
window.ZoomableReaderDefaults = DEFAULT_SETTINGS;
window.Width = { web: WEB_WIDTH_PX, papers: PAPER_WIDTHS_PX, nameFor: paperNameFor, toMm: widthToMm, label: widthLabel };
