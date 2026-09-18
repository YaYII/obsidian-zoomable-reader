import { describe, expect, it } from "vitest";
import { classifyBlock, foldBoard, foldToFit, parseBoard, plainText } from "../src/board-model";

/* 白板模式的前提是「解析对」：标题成卡、正文成块、围栏里的 # 不是标题。
 * 这些断言都用真实中文文档的形态，而不是玩具输入。 */

const SAMPLE = [
  "---",
  "tags: [读书笔记]",
  "---",
  "# 项目周报",
  "",
  "本周把白板模式做完了。",
  "",
  "## 进展",
  "",
  "- 解析器完成",
  "- 排版完成",
  "",
  "\x60\x60\x60bash",
  "# 这一行是注释，不是标题",
  "npm test",
  "\x60\x60\x60",
  "",
  "### 细节",
  "",
  "> [!note] 提示",
  "> 折叠到二级就够了。",
  "",
  "## 风险",
  "",
  "| 项 | 状态 |",
  "| --- | --- |",
  "| 手势 | 已验证 |",
].join("\n");

describe("parseBoard：Markdown → 卡片层级", () => {
  const doc = parseBoard(SAMPLE, { title: "周报.md" });

  it("frontmatter 不进正文，且如实计数", () => {
    expect(doc.skippedLines).toBe(3);
    expect(doc.byId[doc.rootId].blocks).toHaveLength(0);
  });

  it("根卡片用传入的笔记名，正文从第一个标题开始", () => {
    expect(doc.byId[doc.rootId].title).toBe("周报.md");
    expect(doc.byId[doc.rootId].children).toHaveLength(1);
  });

  it("标题成卡，且 id 稳定（同一篇笔记两次解析结果一致）", () => {
    const again = parseBoard(SAMPLE, { title: "周报.md" });
    expect(again.nodes.map((n) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    expect(doc.nodes.map((n) => n.title)).toEqual(["周报.md", "项目周报", "进展", "细节", "风险"]);
  });

  it("跳级标题挂到最近的更浅标题下，而不是丢掉层级", () => {
    const detail = doc.nodes.find((n) => n.title === "细节");
    expect(detail?.depth).toBe(3);
    expect(doc.byId[detail!.parentId!].title).toBe("进展");
  });

  it("围栏里的 # 不是标题（否则一段 shell 注释就能把大纲劈碎）", () => {
    expect(doc.nodes.some((n) => n.title.includes("注释"))).toBe(false);
    const code = doc.byId["n2"].blocks.find((b) => b.kind === "code");
    expect(code?.markdown).toContain("这一行是注释");
  });

  it("列表、标注、表格各自成块并判对类型", () => {
    /* n1 = 项目周报（正文段落）、n2 = 进展（列表 + 代码）、n3 = 细节（标注）、n4 = 风险（表格） */
    expect(doc.byId["n1"].blocks.map((b) => b.kind)).toContain("paragraph");
    expect(doc.byId["n2"].blocks.map((b) => b.kind)).toEqual(["list", "code"]);
    expect(doc.byId["n3"].blocks[0].kind).toBe("callout");
    expect(doc.byId["n4"].blocks[0].kind).toBe("table");
  });

  it("标了非 mermaid 的语言就是普通代码块", () => {
    expect(classifyBlock(["~~~", "x", "~~~"]).kind).toBe("code");
    expect(classifyBlock(["~~~mermaid", "graph TD;", "~~~"]).kind).toBe("mermaid");
  });

  it("没有标题的短笔记也能成板：所有内容挂在根卡上", () => {
    const flat = parseBoard("只有一段话。", {});
    expect(flat.nodes).toHaveLength(1);
    expect(flat.byId.root.blocks).toHaveLength(1);
    expect(flat.byId.root.title).toBe("Note");
  });

  it("空文档不崩（手机上误开空笔记很常见）", () => {
    const empty = parseBoard("", { title: "空.md" });
    expect(empty.nodes).toHaveLength(1);
    expect(empty.byId.root.blocks).toHaveLength(0);
  });
});

describe("plainText：给折叠态用的纯文本摘要", () => {
  it("去掉标记，保留内容", () => {
    expect(plainText("**加粗**与 [[双链|别名]] 和 ![图](a.png)")).toBe("加粗与 别名 和 图");
  });

  it("超长文本截断成一行", () => {
    const text = plainText("中".repeat(200), 20);
    expect(text.length).toBe(20);
    expect(text.endsWith("…")).toBe(true);
  });

  it("围栏与标题符号不留在摘要里", () => {
    expect(plainText("# 标题\n\x60\x60\x60js\ncode\n\x60\x60\x60")).toBe("标题 code");
  });
});

describe("foldBoard：深层标题折进祖先卡片", () => {
  const doc = parseBoard(SAMPLE, { title: "周报.md" });
  const folded = foldBoard(doc, 2);

  it("只保留不超过上限的卡片", () => {
    expect(folded.nodes.map((n) => n.depth).sort()).toEqual([0, 1, 2, 2]);
    expect(folded.nodes.some((n) => n.title === "细节")).toBe(false);
  });

  it("折叠掉的内容以小节形式留在祖先卡里，不丢文字", () => {
    const progress = folded.nodes.find((n) => n.title === "进展")!;
    const section = progress.blocks.find((b) => b.kind === "section")!;
    expect(section.markdown).toContain("#### 细节");
    expect(section.markdown).toContain("折叠到二级就够了");
  });

  it("上限大于文档深度时原样返回（不复制、不重排）", () => {
    expect(foldBoard(doc, 6)).toBe(doc);
  });
});
describe("foldToFit：卡片数量上限下的自动折叠", () => {
  const md = ["# A", "", "## A1", "", "a", "", "### A1a", "", "b", "", "## A2", "", "c"].join("\n");
  const doc = parseBoard(md, { title: "t" });

  it("上限够宽松时用用户设的层级（不无谓折叠）", () => {
    const result = foldToFit(doc, 3, 100);
    expect(result.depth).toBe(3);
    expect(result.doc.nodes.map((n) => n.title)).toEqual(["t", "A", "A1", "A1a", "A2"]);
  });

  it("卡片超上限时自动折浅，直到数量达标", () => {
    const result = foldToFit(doc, 3, 4);
    expect(result.depth).toBe(2);
    expect(result.doc.nodes).toHaveLength(4);
  });

  it("再紧也要给出结果（折到第一层），不返回空板", () => {
    const result = foldToFit(doc, 3, 1);
    expect(result.depth).toBe(1);
    expect(result.doc.nodes.length).toBeGreaterThan(0);
  });

  it("上限小于 1 时按 1 处理（坏设置不产生空白板）", () => {
    expect(foldToFit(doc, 3, 0).depth).toBeGreaterThanOrEqual(1);
  });
});
