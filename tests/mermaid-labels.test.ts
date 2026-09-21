import { describe, expect, it } from "vitest";
import { estimateLabelWidth, extractMermaidFence, wrapLongMermaidLabels, wrapMermaidFences } from "../src/mermaid-labels";

/* 长标签折行的契约（真实渲染由 tools/verify-diagram-layout.mjs 在 Chromium 里量）。
 *
 * 为什么需要这一层：Mermaid 只对 **markdown 字符串** 标签按 wrappingWidth 折行，
 * 普通 A[长文本] 从不折行（10.9 实测：上限 460 与 120 渲染结果一模一样）。
 * 用户的原话是「图形里面的文字内容太多了，你应该可以换行呀，而不是一行顶一个宽度呀」。
 * 所以插件负责把长标签改写成 markdown 字符串，折行交给 Mermaid 自己的布局。 */

const BT = String.fromCharCode(96);
const md = (text: string) => '"' + BT + text + BT + '"';

describe("estimateLabelWidth：估算标签宽度", () => {
  it("汉字按 1em、英文按 0.55em", () => {
    expect(estimateLabelWidth("中文四个字", 16)).toBe(80);
    expect(estimateLabelWidth("abcd", 16)).toBeCloseTo(35.2, 1);
  });

  it("<br/> 算换行：取最长那一行（不是把两行加起来）", () => {
    expect(estimateLabelWidth("短<br/>这是很长的一行文字", 16)).toBe(144); /* 最长一行 9 字 × 16px */
  });
});

describe("wrapLongMermaidLabels：只改长标签，且只改成 markdown 字符串", () => {
  it("长标签被改写（方括号 / 圆括号 / 花括号三种形状）", () => {
    const long = "第一件事：把标签宽度上限从 200px 放宽到 460px，让框随文字走";
    expect(wrapLongMermaidLabels("flowchart LR\n  A[" + long + "] --> B[短]")).toBe(
      "flowchart LR\n  A[" + md(long) + "] --> B[短]"
    );
    expect(wrapLongMermaidLabels("A(" + long + ")")).toBe("A(" + md(long) + ")");
    expect(wrapLongMermaidLabels("A{" + long + "}")).toBe("A{" + md(long) + "}");
    expect(wrapLongMermaidLabels("A([" + long + "])")).toBe("A([" + md(long) + "])");
  });

  it("短标签一个字都不动（改多了会把图改坏）", () => {
    const source = "flowchart TD\n  A[开始] --> B{判断}\n  B --> C[结束]";
    expect(wrapLongMermaidLabels(source)).toBe(source);
    expect(wrapLongMermaidLabels(source, { maxWidth: 20 })).not.toBe(source);
  });

  it("已经是 markdown 字符串 / 含引号 / 含 <br> 的标签不重复包装", () => {
    const long = "这是一段足够长的中文标签文字，用来确认不会被重复包装处理";
    const already = "A[" + md(long) + "]";
    expect(wrapLongMermaidLabels(already)).toBe(already);
    const quoted = 'A["已经带引号的标签，很长很长很长很长很长很长很长"]';
    expect(wrapLongMermaidLabels(quoted)).toBe(quoted);
    const br = "A[第一行<br/>第二行，很长很长很长很长很长很长很长很长]";
    expect(wrapLongMermaidLabels(br)).toBe(br);
  });

  it("边标签同样处理：-->|长文本| 改成 markdown 字符串", () => {
    const long = "这是一条很长的边标签说明文字，超过宽度上限就该折行显示";
    expect(wrapLongMermaidLabels("A -->|" + long + "| B")).toBe("A -->|" + md(long) + "| B");
  });

  it("幂等：改写过的源码再跑一次不会变", () => {
    const long = "这是一段很长的中文标签，长度明显超过默认的折行宽度上限";
    const once = wrapLongMermaidLabels("A[" + long + "]");
    expect(wrapLongMermaidLabels(once)).toBe(once);
  });
});

describe("wrapMermaidFences：只动 mermaid 围栏里的内容", () => {
  const fence = BT + BT + BT;
  it("正文里的长文本不受影响，围栏里的标签才改写", () => {
    const long = "这是一段很长的中文标签，长度明显超过默认的折行宽度上限";
    const markdown = [
      "# 标题",
      "A[" + long + "] 这句是正文，不是图。",
      fence + "mermaid",
      "flowchart LR",
      "  A[" + long + "] --> B[短]",
      fence,
      "收尾正文。",
    ].join("\n");
    const out = wrapMermaidFences(markdown);
    expect(out).toContain("A[" + long + "] 这句是正文");
    expect(out).toContain("A[" + md(long) + "] --> B[短]");
    expect(out.split("\n").length).toBe(markdown.split("\n").length);
  });

  it("其它语言的围栏不动", () => {
    const markdown = fence + "js\nconst a = 1;\n" + fence;
    expect(wrapMermaidFences(markdown)).toBe(markdown);
  });
});

describe("extractMermaidFence：从整节原文里抠出图表源码", () => {
  const fence = BT + BT + BT;
  const text = [
    "前言",
    fence + "mermaid",
    "flowchart LR",
    "  A[开始] --> B[结束]",
    fence,
    "后记",
  ].join("\n");

  it("按行范围找到围栏并取出内容", () => {
    expect(extractMermaidFence(text, 0, 5)).toBe("flowchart LR\n  A[开始] --> B[结束]");
  });

  it("范围里没有 mermaid 围栏就返回 null（宁可不折行，也不要乱改）", () => {
    expect(extractMermaidFence(text, 0, 0)).toBeNull();
    expect(extractMermaidFence("", 0, 3)).toBeNull();
  });
});
