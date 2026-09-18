/* 浏览器验证台入口：把不依赖 obsidian 的核心挂到 window，供 Playwright 驱动真实事件。
 * 白板模式现在是「一整张 1280px 宽的版面」，所以这里只需要手势层 + 出厂默认值。 */
import { ZoomPanLayer, formatPercent, fitRect, BOARD_MIN_SCALE } from "../../src/zoom-pan";
import { ImageLightbox, installZoomAffordance } from "../../src/lightbox";
import { installMobileReadingTaps } from "../../src/mobile-reading-taps";
import { DEFAULT_DIAGRAM_LAYOUT, applyDiagramLayout, mergeDiagramConfig } from "../../src/diagram-layout";
import { DEFAULT_SETTINGS, PAPER_WIDTHS_PX, WEB_WIDTH_PX, paperNameFor, readingLineWidth, widthLabel, widthToMm } from "../../src/settings-spec";
import {
  READING_ZOOM_MAX,
  READING_ZOOM_MIN,
  STYLE_ELEMENT_ID,
  clampReadingZoom,
  installReadingGestures,
  installReadingStyle,
  readingCss,
} from "../../src/reading-view";

declare global {
  interface Window {
    ZoomPanLayer: typeof ZoomPanLayer;
    ZoomPanFormat: { percent: typeof formatPercent; fitRect: typeof fitRect; boardMinScale: number };
    ImageLightbox: typeof ImageLightbox;
    installZoomAffordance: typeof installZoomAffordance;
    installMobileReadingTaps: typeof installMobileReadingTaps;
    DiagramLayout: {
      apply: typeof applyDiagramLayout;
      merge: typeof mergeDiagramConfig;
      defaults: typeof DEFAULT_DIAGRAM_LAYOUT;
    };
    ZoomableReaderDefaults: typeof DEFAULT_SETTINGS;
    ReadingView: {
      css: typeof readingCss;
      installStyle: typeof installReadingStyle;
      installGestures: typeof installReadingGestures;
      clampZoom: typeof clampReadingZoom;
      lineWidth: typeof readingLineWidth;
      styleId: string;
      zoomMin: number;
      zoomMax: number;
    };
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
window.installMobileReadingTaps = installMobileReadingTaps;
window.DiagramLayout = { apply: applyDiagramLayout, merge: mergeDiagramConfig, defaults: DEFAULT_DIAGRAM_LAYOUT };
window.ZoomableReaderDefaults = DEFAULT_SETTINGS;
window.ReadingView = {
  css: readingCss,
  installStyle: installReadingStyle,
  installGestures: installReadingGestures,
  clampZoom: clampReadingZoom,
  lineWidth: readingLineWidth,
  styleId: STYLE_ELEMENT_ID,
  zoomMin: READING_ZOOM_MIN,
  zoomMax: READING_ZOOM_MAX,
};
window.Width = { web: WEB_WIDTH_PX, papers: PAPER_WIDTHS_PX, nameFor: paperNameFor, toMm: widthToMm, label: widthLabel };
