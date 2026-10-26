// AGT-B5：写操作意图零模型拒绝（BND-S02「把最近一次骑行记录改成 100 公里」答非所问驱动）。
//
// 设计要点（见 B5 卡 write_refusal 方案，方案 B）：
//   route=out_of_scope / action=deterministic_reply / risk=none / reasonCode=WRITE_NOT_SUPPORTED
//   —— 只新增一个 reasonCode，不动 ChatAction / ChatRisk 枚举。
//
// 判定必须同时满足"动词 + 受写对象"，否则会误伤：
//   "改天再去骑"（无对象）、"把单位改成公里再算"（改的是说法）。

import assert from "node:assert/strict";
import test from "node:test";

import { classifyChatInputL0 } from "../src/chat/chat-routing.ts";

test("写操作意图：动词 + 受写对象 → 零模型确定性拒绝（route/action/risk/reasonCode 四元组）", () => {
  const blocked = [
    "帮我把最近一次骑行记录改成 100 公里",
    "把上个月所有骑行记录都删了",
    "清空我的骑行数据",
    "覆盖导入的文件",
    "删除这条轨迹",
    "重置里程数据",
    "帮我修改一下那条骑行的距离",
  ];
  for (const text of blocked) {
    const decision = classifyChatInputL0(text);
    assert.ok(decision, `应命中 L0：${text}`);
    assert.equal(decision.route, "out_of_scope", text);
    assert.equal(decision.action, "deterministic_reply", text);
    assert.equal(decision.risk, "none", text);
    assert.equal(decision.reasonCode, "WRITE_NOT_SUPPORTED", text);
  }
});

test("反误伤：无受写对象的动词、问方法、改说法，都不该被写拒绝拦下", () => {
  const allowed = [
    "改天再去骑那条路",              // 无受写对象
    "把单位改成公里再算一遍",         // 改的是说法，对象是"单位/公里"
    "我想删掉这段对话",              // 对象是对话，不是骑行数据
    "怎么删除骑行记录？",            // 问方法（ASK_HOW 排除）
    "如何修改导入的 FIT 文件？",      // 问方法
    "这次骑行的平均功率是多少？",      // 普通取数
  ];
  for (const text of allowed) {
    const decision = classifyChatInputL0(text);
    assert.notEqual(decision?.reasonCode, "WRITE_NOT_SUPPORTED", `不该拦：${text}`);
  }
});
