/* 浏览器验证台入口：把不依赖 obsidian 的核心挂到 window，供 Playwright 驱动真实事件。 */
import { ZoomPanLayer, formatPercent, fitRect, BOARD_MIN_SCALE } from "../../src/zoom-pan";
import { ImageLightbox, installZoomAffordance } from "../../src/lightbox";
import { DEFAULT_DIAGRAM_LAYOUT, applyDiagramLayout, mergeDiagramConfig } from "../../src/diagram-layout";
import { classifyBlock, foldBoard, foldToFit, parseBoard, plainText } from "../../src/board-model";
import {
  DEFAULT_SETTINGS,
  PAPER_WIDTHS_PX,
  cardWidthLabel,
  paperNameFor,
  widthToMm,
} from "../../src/settings-spec";
import { DEFAULT_BOARD_LAYOUT, cardAt, estimateCardHeight, layoutBoard, linkPath } from "../../src/board-layout";
import {
  BOARD_CLASS,
  BOARD_LINKS_CLASS,
  CARD_ATTR,
  CARD_BODY_CLASS,
  CARD_CLASS,
  CARD_FOCUS_CLASS,
  CARD_HEAD_CLASS,
  CARD_META_CLASS,
  CARD_TITLE_CLASS,
  MODE_BOARD_CLASS,
  MODE_PAGE_CLASS,
  applyModeClasses,
  cardIdFromClick,
  renderBoardInto,
} from "../../src/board-render";

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
    BoardModel: {
      parse: typeof parseBoard;
      fold: typeof foldBoard;
      foldToFit: typeof foldToFit;
      classify: typeof classifyBlock;
      plainText: typeof plainText;
    };
    ZoomableReaderDefaults: typeof DEFAULT_SETTINGS;
    Paper: {
      widths: typeof PAPER_WIDTHS_PX;
      nameFor: typeof paperNameFor;
      toMm: typeof widthToMm;
      label: typeof cardWidthLabel;
    };
    BoardLayout: {
      layout: typeof layoutBoard;
      linkPath: typeof linkPath;
      estimateCardHeight: typeof estimateCardHeight;
      cardAt: typeof cardAt;
      defaults: typeof DEFAULT_BOARD_LAYOUT;
    };
    BoardRender: {
      render: typeof renderBoardInto;
      cardIdFromClick: typeof cardIdFromClick;
      applyModeClasses: typeof applyModeClasses;
      classes: {
        board: string;
        links: string;
        card: string;
        head: string;
        title: string;
        meta: string;
        focus: string;
        body: string;
        cardAttr: string;
      };
      modeClasses: { page: string; board: string };
    };
  }
}

window.ZoomPanLayer = ZoomPanLayer;
window.ZoomPanFormat = { percent: formatPercent, fitRect: fitRect, boardMinScale: BOARD_MIN_SCALE };
window.ImageLightbox = ImageLightbox;
window.installZoomAffordance = installZoomAffordance;
window.DiagramLayout = { apply: applyDiagramLayout, merge: mergeDiagramConfig, defaults: DEFAULT_DIAGRAM_LAYOUT };
window.ZoomableReaderDefaults = DEFAULT_SETTINGS;
window.Paper = { widths: PAPER_WIDTHS_PX, nameFor: paperNameFor, toMm: widthToMm, label: cardWidthLabel };
window.BoardModel = { parse: parseBoard, fold: foldBoard, foldToFit: foldToFit, classify: classifyBlock, plainText: plainText };
window.BoardLayout = { layout: layoutBoard, linkPath: linkPath, estimateCardHeight: estimateCardHeight, cardAt: cardAt, defaults: DEFAULT_BOARD_LAYOUT };
window.BoardRender = {
  render: renderBoardInto,
  cardIdFromClick: cardIdFromClick,
  applyModeClasses: applyModeClasses,
  classes: {
    board: BOARD_CLASS,
    links: BOARD_LINKS_CLASS,
    card: CARD_CLASS,
    head: CARD_HEAD_CLASS,
    title: CARD_TITLE_CLASS,
    meta: CARD_META_CLASS,
    focus: CARD_FOCUS_CLASS,
    body: CARD_BODY_CLASS,
    cardAttr: CARD_ATTR,
  },
  modeClasses: { page: MODE_PAGE_CLASS, board: MODE_BOARD_CLASS },
};
