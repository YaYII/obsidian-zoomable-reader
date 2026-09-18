import { describe, expect, it } from "vitest";
import { parseBoard } from "../src/board-model";
import {
  DEFAULT_BOARD_LAYOUT,
  cardAt,
  estimateCardHeight,
  layoutBoard,
  linkPath,
  type BoardCard,
} from "../src/board-layout";

/* 排版错了在手机上就是灾难（卡片叠在一起、连线插进卡片里），所以这里断言的是
 * 几何不变量，而不是「大概对」：不重叠、父子中心对齐、实测高度优先。 */

const MD = [
  "# 主线",
  "",
  "一段正文。",
  "",
  "## 分支 A",
  "",
  "- 一",
  "- 二",
  "",
  "### A-1 细节",
  "",
  "细节正文。",
  "",
  "## 分支 B",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
].join("\n");

const doc = parseBoard(MD, { title: "排版测试.md" });
const layout = layoutBoard(doc, { cardWidth: 320, gapX: 88, gapY: 32, padding: 40 });

function overlaps(a: BoardCard, b: BoardCard): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("layoutBoard：白板几何", () => {
  it("每张卡片都有位置，且互不重叠", () => {
    expect(layout.cards).toHaveLength(doc.nodes.length);
    for (let i = 0; i < layout.cards.length; i += 1) {
      for (let j = i + 1; j < layout.cards.length; j += 1) {
        expect(overlaps(layout.cards[i], layout.cards[j]), layout.cards[i].id + " 与 " + layout.cards[j].id).toBe(false);
      }
    }
  });

  it("同深度的卡片落在同一列（列 = 深度），横向步长 = 卡片宽 + 列间距", () => {
    const byDepth = new Map<number, number>();
    for (const card of layout.cards) {
      const x = byDepth.get(card.depth);
      if (x === undefined) byDepth.set(card.depth, card.x);
      else expect(card.x).toBe(x);
    }
    /* n1（# 主线）是第 1 列，root 是第 0 列 */
    expect(layout.byId["n1"].x - layout.byId.root.x).toBeCloseTo(320 + 88, 6);
  });

  it("父卡的顶 = 子卡带的顶（自上而下读，打开时不会有一大块上方留白）", () => {
    for (const node of doc.nodes) {
      if (node.children.length === 0) continue;
      const parent = layout.byId[node.id];
      const first = layout.byId[node.children[0]];
      expect(first.y).toBeCloseTo(parent.y, 6);
    }
  });

  it("根卡贴着上边距（打开即原大时，可见区顶部就是内容）", () => {
    expect(layout.byId.root.y).toBeCloseTo(DEFAULT_BOARD_LAYOUT.padding, 6);
  });

  it("子卡永远在父卡右边（左→右读大纲）", () => {
    for (const node of doc.nodes) {
      for (const childId of node.children) {
        expect(layout.byId[childId].x).toBeGreaterThanOrEqual(layout.byId[node.id].x + layout.byId[node.id].width);
      }
    }
  });

  it("连线条数与父子关系数一致，端点落在卡片边缘", () => {
    const expected = doc.nodes.reduce((sum, n) => sum + n.children.length, 0);
    expect(layout.links).toHaveLength(expected);
    for (const link of layout.links) {
      const from = layout.byId[link.from];
      const to = layout.byId[link.to];
      expect(link.x1).toBeCloseTo(from.x + from.width, 6);
      expect(link.y1).toBeCloseTo(from.y + from.height / 2, 6);
      expect(link.x2).toBeCloseTo(to.x, 6);
      expect(link.y2).toBeCloseTo(to.y + to.height / 2, 6);
    }
  });

  it("白板边界包住所有卡片（含四周留白）", () => {
    for (const card of layout.cards) {
      expect(card.x + card.width).toBeLessThanOrEqual(layout.width);
      expect(card.y + card.height).toBeLessThanOrEqual(layout.height);
    }
    expect(layout.width).toBeGreaterThan(DEFAULT_BOARD_LAYOUT.padding);
  });

  it("实测高度优先于估算（第二遍排版用真实 DOM 高度）", () => {
    const tall = layoutBoard(doc, { heights: { n3: 900 } });
    const plain = layoutBoard(doc, {});
    expect(tall.byId["n3"].height).toBe(900);
    expect(tall.height).toBeGreaterThan(plain.height);
  });

  it("空文档（只有根卡）也能排版，不会出现 NaN", () => {
    const empty = layoutBoard(parseBoard("", { title: "空" }), {});
    expect(empty.cards).toHaveLength(1);
    expect(Number.isFinite(empty.width)).toBe(true);
    expect(Number.isFinite(empty.height)).toBe(true);
  });

  it("窄卡片（手机上的 260px）依然不重叠", () => {
    const narrow = layoutBoard(doc, { cardWidth: 260 });
    for (let i = 0; i < narrow.cards.length; i += 1) {
      for (let j = i + 1; j < narrow.cards.length; j += 1) {
        expect(overlaps(narrow.cards[i], narrow.cards[j])).toBe(false);
      }
    }
  });
});

describe("估算高度：只求「八九不离十」", () => {
  it("内容越多卡片越高", () => {
    /* 正文挂在标题卡上（# A 是 n1），根卡自己没有正文 —— 断言对象必须是同一张卡 */
    const small = parseBoard("# A\n\n短。", {}).byId["n1"];
    const big = parseBoard("# A\n\n" + "很长的正文。".repeat(60), {}).byId["n1"];
    expect(estimateCardHeight(big, 320)).toBeGreaterThan(estimateCardHeight(small, 320));
  });

  it("空卡片也有下限高度（至少装得下标题栏）", () => {
    expect(estimateCardHeight(parseBoard("", {}).byId.root, 320)).toBeGreaterThanOrEqual(72);
  });

  it("代码块按行数增长（不按字符数）", () => {
    const few = parseBoard("\x60\x60\x60js\na\n\x60\x60\x60", {}).byId.root;
    const many = parseBoard("\x60\x60\x60js\n" + "a\n".repeat(30) + "\x60\x60\x60", {}).byId.root;
    expect(estimateCardHeight(many, 320) - estimateCardHeight(few, 320)).toBeGreaterThan(300);
  });
});

describe("linkPath / cardAt", () => {
  it("连线是三段贝塞尔，起点终点用卡片边缘坐标", () => {
    const d = linkPath({ from: "a", to: "b", x1: 100, y1: 50, x2: 300, y2: 120 });
    expect(d.startsWith("M 100 50 C ")).toBe(true);
    expect(d).toContain("300 120");
  });

  it("cardAt 命中卡片内部，空白处返回 null", () => {
    const card = layout.byId["n2"];
    expect(cardAt(layout, card.x + 5, card.y + 5)?.id).toBe("n2");
    expect(cardAt(layout, card.x - 20, card.y - 20)).toBeNull();
  });
});
