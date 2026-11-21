import { z } from "zod";
import { envelope, type SourceDTO } from "@/contracts";

const failureEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

type SuccessPayload<T extends z.ZodTypeAny> = {
  data: z.infer<T>;
  source: SourceDTO;
};

export type ApiPostOptions = {
  headers?: HeadersInit;
};

export type ApiRequestOptions = ApiPostOptions;

async function requestJson(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiClientError("网络请求失败。", "NETWORK_ERROR", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      `接口返回不是有效 JSON（HTTP ${response.status}）。`,
      "INVALID_RESPONSE",
      response.status,
    );
  }

  if (!response.ok) {
    const failure = failureEnvelope.safeParse(payload);
    if (failure.success) {
      throw new ApiClientError(
        `${failure.data.error.message}（HTTP ${response.status}）。`,
        failure.data.error.code,
        response.status,
      );
    }
    throw new ApiClientError(
      `接口请求失败（HTTP ${response.status}）。`,
      `HTTP_${response.status}`,
      response.status,
    );
  }

  return { payload, status: response.status };
}

function parseSuccess<T extends z.ZodTypeAny>(payload: unknown, schema: T, status: number) {
  const parsed = envelope(schema).safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      `接口返回格式不符合契约（HTTP ${status}）。`,
      "INVALID_RESPONSE",
      status,
    );
  }
  return parsed.data;
}

function jsonHeaders(options: ApiRequestOptions = {}): HeadersInit {
  if (!options.headers) return { "content-type": "application/json" };
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  return headers;
}

async function requestMutation<T extends z.ZodTypeAny>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  schema: T,
  options: ApiRequestOptions = {},
): Promise<SuccessPayload<T>> {
  const response = await requestJson(path, {
    method,
    headers: jsonHeaders(options),
    body: JSON.stringify(body),
  });
  const parsed = parseSuccess(response.payload, schema, response.status);
  return { data: parsed.data, source: parsed.meta.source };
}

/** 浏览器端调用相对路径；响应先校验再交给页面，避免不同 AI 悄悄改字段。 */
export async function apiGet<T extends z.ZodTypeAny>(path: string, schema: T) {
  const response = await requestJson(path);
  return parseSuccess(response.payload, schema, response.status);
}

/** 提交 JSON 并返回已校验的数据与来源；HTTP 501 会保留给调用方处理。 */
export async function apiPost<T extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: T,
  options: ApiPostOptions = {},
): Promise<SuccessPayload<T>> {
  return requestMutation("POST", path, body, schema, options);
}

/** 更新 JSON 资源；失败时保留真实 HTTP 状态和服务端错误码。 */
export async function apiPut<T extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: T,
  options: ApiRequestOptions = {},
): Promise<SuccessPayload<T>> {
  return requestMutation("PUT", path, body, schema, options);
}

/** 删除资源并校验统一成功信封；不会把 501 当成成功。 */
export async function apiDelete<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  options: ApiRequestOptions = {},
): Promise<SuccessPayload<T>> {
  const response = await requestJson(path, {
    method: "DELETE",
    headers: options.headers,
  });
  const parsed = parseSuccess(response.payload, schema, response.status);
  return { data: parsed.data, source: parsed.meta.source };
}
