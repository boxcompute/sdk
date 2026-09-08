import type { ApiErrorBody } from "./types.js";

export class BoxComputeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryable: boolean;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
  }) {
    super(input.message);
    this.name = "BoxComputeError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.status === 429 || input.status >= 500;
  }
}

export class BoxComputeTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BoxComputeTransportError";
  }
}

export async function responseError(response: Response): Promise<BoxComputeError> {
  const body = await response.json().catch(() => undefined) as ApiErrorBody | undefined;
  const requestId = response.headers.get("x-request-id") ??
    response.headers.get("trace-id") ?? undefined;
  return new BoxComputeError({
    status: response.status,
    code: body?.code ?? "HTTP_ERROR",
    message: body?.error ?? `BoxCompute returned HTTP ${response.status}`,
    ...(requestId ? { requestId } : {}),
  });
}
