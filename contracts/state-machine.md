# 状态机与枚举契约 v1

## 题目状态

- `draft`：解析或生成刚完成，缺少审核，不可组卷。
- `reviewed`：离线审核通过，等待发布或抽检，不可组卷。
- `published`：唯一可进入组卷池的状态。
- `pending_review`：被举报后临时隐藏，不可组卷；必须保留原状态以便复核。
- `hidden`：确认下架，不可组卷。
- `rejected`：审核失败，不可组卷。

允许的迁移：

```text
draft → reviewed → published
reviewed → rejected
published → pending_review → published
published → pending_review → hidden
published → hidden（仅管理复核）
rejected → draft（仅修改后重新进入审核）
```

## 每日一题

按设备和上海日期固定题目及各小问。若已核实当前版本缺少解题必需的图，题库将其标为 `pending_review` 并为尚未完成的每日题重新选题。跨日页面的提交或追问返回 `state_conflict`。

`available` 时可以作答，空白提交返回 `invalid_input`。图片无法辨认时保持 `available`，`result.correct` 为 `null`，可重新提交。模型不可用时保留原状态。

可判定的作答进入 `submitted`，记录布尔对错、文字作答和反馈。此时可查看题库参考解并主动追问。错误进入当日设备的错题本，之后答对已有错题会更新复习间隔。重复提交沿用当次判定。每日题不产生试卷或分数。

## 试卷实例状态

- `draft`：已组卷但未开始作答。
- `in_progress`：作答中。
- `submitted`：已提交并完成判卷。
- `expired`：超过有效期，只能查看，不可继续作答。

## 生成任务状态

- `queued` → `running` → `succeeded`
- `running` → `failed`
- `queued/running` → `cancelled`

任务完成必须落库，前端轮询或 SSE 进度不能代替最终状态。

## 举报状态

- `open`：新建，关联 AI 题立即转为 `pending_review`。
- `resolved`：已复核，`resolution` 为 `fixed` / `removed` / `no_issue`。
- `rejected`：举报不成立，题目可恢复 `published`。

## 其他固定枚举

- 题源：`real` / `ai` / `mixed`（mixed 只用于试卷实例）。
- 组卷模式：`exam` / `drill`。
- 题型：`single_choice` / `fill_blank` / `free_response`。
- 难度：`easy` / `medium` / `hard`。
- 答案来源：`official` / `ai_verified`。
- rubric 来源：`derived_official` / `ai_verified`。
- 关系类型：`prereq` / `confusion` / `same_method`。
- 知识点关联角色：`main` / `aux`，不参与组卷筛选，仅参与归因。
