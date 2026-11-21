# A 的变更请求：施工照片上传与引用链路

- 申请角色：A（业主端）
- 用户场景：业主在施工进度页选择现场照片，提交给照片辅助检查接口。
- 需要修改的共享文件：由 D 评估并维护 `src/contracts/index.ts`、图片存储/上传 API、`docs/API.md`；A 不直接修改公共契约或服务端存储。
- D 处理状态：待讨论

## 当前前端状态

`PhotoInspectionPanel` 已按公共 `PhotoInspectionInput` 限制 1–10 张照片，并把选择结果作为 `imageRefs` 提交到 `POST /api/inspect`。浏览器目前只能取得文件名，因此当前实现把文件名作为临时引用；这不是可用于真实分析或跨会话读取的上传结果。

真实上传方式确定前，页面继续显示来源未确认；接口返回 501 时显示未开放，不生成检查结论，也不把照片标记为已上传。

## 建议的最小链路

建议采用两步协议，避免把二进制内容塞进照片检查 JSON：

1. `POST /api/inspect/images` 上传 1–10 个图片文件，服务端校验文件类型、大小、数量，并返回本次上传生成的引用。
2. `POST /api/inspect` 只接收公共 `PhotoInspectionInput`，其中 `imageRefs` 使用上一步返回的引用。

如果 D 采用预签名直传或其他存储方案，前端只依赖最终返回的 `imageRef` 字符串，不依赖存储厂商 URL、数据库主键或临时上传字段。

## 建议字段

上传接口的成功响应可沿用统一 envelope，字段全部由 D 冻结：

```json
{
  "ok": true,
  "data": {
    "images": [
      {
        "imageRef": "inspect-image/<opaque-id>",
        "contentType": "image/jpeg",
        "sizeBytes": 123456
      }
    ]
  },
  "meta": { "source": "live" }
}
```

约束建议如下：

- `imageRef` 为不含个人路径或原始文件名的 opaque 字符串，长度和字符集由公共契约规定。
- 引用必须绑定 `demandId` 和当前业主会话；客户端不能自行伪造另一条需求的引用。
- `imageRefs` 仍由 `PhotoInspectionInput` 限制为 1–10 个不重复引用。
- 上传接口应拒绝空文件、非图片 MIME、超出大小限制、重复文件和超过 10 个文件，并返回可读失败信封。
- 检查接口收到不存在、过期、未授权或不属于当前需求的引用时，不得把它当作成功分析。
- 删除、过期和失败清理策略由 D 决定；页面只根据接口返回状态展示“上传失败/引用失效”，不自行猜测。

## 兼容与来源

- 旧版 `PhotoInspectionInput` 和 `POST /api/inspect` 的字段保持不变；`imageRefs` 继续是唯一检查输入。
- 上传成功响应必须声明 `meta.source`。真实存储未接通时可以返回明确 501；不得把本地文件名或 mock 引用标记成 live。
- 检查结果中的 `findings[].imageRef` 应回传已上传引用，页面才能把疑点对应回用户选择的照片。
- D 若选择单步 multipart 检查，也应把二进制上传和引用生成封装在服务端，最终结果仍遵循上述 `imageRefs` 语义，避免 A 页面改成依赖私有存储字段。

## 受影响页面与验收

- A 页面：`/owner/project/[id]` 的 `PhotoInspectionPanel`。
- D API：图片上传接口、`POST /api/inspect` 的引用校验和照片存储生命周期。
- 验收步骤：
  1. 选择 1–10 张合法图片后能得到服务端生成的 `imageRefs`，页面不展示本地路径。
  2. 超过 10 张、重复、非图片、超限或空文件均显示可读错误，且不调用检查接口。
  3. 跨需求或过期引用返回明确失败；HTTP 501 仍显示未开放，不生成分析成功态。
  4. 成功检查结果中的每个 `finding.imageRef` 都能对应本次上传引用，并保留固定的辅助检查免责声明。
  5. 未接通真实上传时，现有 A 页面测试和 mock 运行方式继续通过。

- 当前接口为何不够：`POST /api/inspect` 只接受引用，尚无浏览器上传、引用生成、需求绑定和生命周期协议；直接发送文件名无法证明文件已被服务端保存。
- 兼容旧数据的办法：继续接受已有合法 `imageRefs`；新增上传响应只增加服务端生成引用，不改变 `PhotoInspectionResult` 的结果字段。
