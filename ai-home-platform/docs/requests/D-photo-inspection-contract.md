# D：施工照片辅助检查接口契约

> 本文为最初契约交接记录，示例不是当前成功响应。最新上传与权限实现见 `D-photo-image-upload.md`；mock 检查结果及 A 上传接线见 `D-photo-inspection-mock.md`。当前仅 live 分析保持 501，mock 模式校验已上传引用后返回 200/mock；文件名或示例中的 upload:// 引用不可用于真实请求。

- 角色：D
- 状态：输入/输出契约已提供；真实图片存储、模型分析和人工复核流程仍未接通。
- 关联请求：`docs/requests/A-photo-inspection.md`

## 输入

`POST /api/inspect` 接收公共 `PhotoInspectionInput`：

```json
{
  "demandId": "demand-1",
  "imageRefs": ["upload://photo-1", "upload://photo-2"]
}
```

- `demandId` 必填且不能是空白。
- `imageRefs` 必须有 1–10 个非空、不重复的引用，每项最多 2048 个字符。
- 请求体使用 strict schema；不得传入 `providerId`、验收状态、排期状态或模型结论。
- 当前接口不接收二进制上传；引用的存储、访问权限和需求归属由后续服务端链路确认。

## 输出

接通真实分析后使用 `envelope(PhotoInspectionResult)`：

```json
{
  "ok": true,
  "data": {
    "demandId": "demand-1",
    "findings": [
      {"imageRef": "upload://photo-1", "severity": "medium", "message": "局部反光，建议补拍。"}
    ],
    "reviewedAt": "2026-11-14T10:00:00.000Z",
    "disclaimer": "照片只能辅助提示疑点，不能替代现场检测或证明施工合格。"
  },
  "meta": {"source": "live"}
}
```

严重程度只允许 `low`、`medium`、`high`。结果不得表达“已验收”或自动修改排期状态。

## 当前实现和 A 的接入

- 当前合法请求返回 501 `NOT_IMPLEMENTED`，仍使用失败信封；这不是成功响应，页面必须显示“尚未开放”并保留可重试状态。
- 坏 JSON 和契约校验失败返回 400；A 使用 `apiPost("/api/inspect", body, PhotoInspectionResult)` 时应按实际 HTTP 状态处理。
- 当前未使用 mock 分析结果，也未新增上传依赖、数据库字段或 AI 能力声明。
