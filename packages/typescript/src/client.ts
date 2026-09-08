import { BoxComputeTransportError, responseError } from "./errors.js";
import type {
  CreateSandboxRequest,
  CreateWorkspaceRequest,
  EditFileInput,
  EditFileResponse,
  ExecuteRequest,
  ExecutionResult,
  FileList,
  FileStat,
  ListFilesOptions,
  LogsOptions,
  Operation,
  OperationOutputChunk,
  OperationOutputOptions,
  ReadFileOptions,
  ReadFileResult,
  RemoveFileOptions,
  RenameFileInput,
  RequestOptions,
  Sandbox,
  SandboxLogs,
  StartOperationRequest,
  Usage,
  WaitOperationInput,
  Workspace,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.boxcompute.ai";
const DEFAULT_TIMEOUT_MS = 180_000;

export type ApiKeyProvider = string | (() => string | Promise<string>);

export interface BoxComputeOptions {
  apiKey: ApiKeyProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type ResponseKind = "json" | "bytes" | "void";

interface TransportRequest extends RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: HeadersInit;
  responseKind?: ResponseKind;
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function jsonBody(value: unknown): Pick<TransportRequest, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  };
}

class Transport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly apiKey: ApiKeyProvider, options: BoxComputeOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<T>(path: string, input: TransportRequest = {}): Promise<T> {
    const key = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!key.trim()) throw new TypeError("BoxCompute apiKey must not be empty");

    const headers = new Headers(input.headers);
    headers.set("authorization", `Bearer ${key}`);
    headers.set("accept", input.responseKind === "bytes" ? "application/octet-stream" : "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
      input.timeoutMs ?? this.timeoutMs,
    );
    const onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      const request: RequestInit = {
        method: input.method ?? "GET",
        headers,
        signal: controller.signal,
      };
      if (input.body !== undefined) request.body = input.body;
      response = await this.fetchImpl(`${this.baseUrl}${path}`, request);
    } catch (error) {
      throw new BoxComputeTransportError("BoxCompute request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) throw await responseError(response);
    if (input.responseKind === "void" || response.status === 204) return undefined as T;
    if (input.responseKind === "bytes") return new Uint8Array(await response.arrayBuffer()) as T;
    return await response.json() as T;
  }

  async raw(path: string, input: TransportRequest = {}): Promise<Response> {
    const key = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!key.trim()) throw new TypeError("BoxCompute apiKey must not be empty");
    const headers = new Headers(input.headers);
    headers.set("authorization", `Bearer ${key}`);
    headers.set("accept", "application/octet-stream");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
      input.timeoutMs ?? this.timeoutMs,
    );
    const onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      const request: RequestInit = {
        method: input.method ?? "GET",
        headers,
        signal: controller.signal,
      };
      if (input.body !== undefined) request.body = input.body;
      response = await this.fetchImpl(`${this.baseUrl}${path}`, request);
    } catch (error) {
      throw new BoxComputeTransportError("BoxCompute request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
    }
    if (!response.ok) throw await responseError(response);
    return response;
  }
}

export class AuthResource {
  constructor(private readonly transport: Transport) {}

  async revoke(options: RequestOptions = {}): Promise<void> {
    await this.transport.request("/api/v2/auth", {
      method: "DELETE",
      responseKind: "void",
      ...options,
    });
  }
}

export class WorkspacesResource {
  constructor(private readonly transport: Transport) {}

  async list(options: RequestOptions = {}): Promise<Workspace[]> {
    const response = await this.transport.request<{ workspaces: Workspace[] }>(
      "/api/v2/workspaces",
      options,
    );
    return response.workspaces;
  }

  async create(
    input: CreateWorkspaceRequest & { idempotencyKey: string },
    options: RequestOptions = {},
  ): Promise<Workspace> {
    const { idempotencyKey, ...body } = input;
    const payload = jsonBody(body);
    const response = await this.transport.request<{ workspace: Workspace }>(
      "/api/v2/workspaces",
      {
        method: "POST",
        ...payload,
        headers: {
          ...payload.headers,
          "idempotency-key": idempotencyKey,
        },
        ...options,
      },
    );
    return response.workspace;
  }
}

export class SandboxesResource {
  constructor(private readonly transport: Transport) {}

  async list(options: RequestOptions = {}): Promise<Sandbox[]> {
    const response = await this.transport.request<{ sandboxes: Sandbox[] }>(
      "/api/v2/sandboxes",
      options,
    );
    return response.sandboxes;
  }

  async create(
    input: CreateSandboxRequest & { idempotencyKey?: string },
    options: RequestOptions = {},
  ): Promise<Sandbox> {
    const { idempotencyKey, ...body } = input;
    const payload = jsonBody(body);
    const response = await this.transport.request<{ sandbox: Sandbox }>(
      "/api/v2/sandboxes",
      {
        method: "POST",
        ...payload,
        ...(idempotencyKey ? {
          headers: { ...payload.headers, "idempotency-key": idempotencyKey },
        } : {}),
        ...options,
      },
    );
    return response.sandbox;
  }

  async inspect(id: string, options: RequestOptions = {}): Promise<Sandbox> {
    const response = await this.transport.request<{ sandbox: Sandbox }>(
      `/api/v2/sandboxes/${encodeURIComponent(id)}`,
      options,
    );
    return response.sandbox;
  }

  async delete(id: string, options: RequestOptions = {}): Promise<void> {
    await this.transport.request(`/api/v2/sandboxes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      responseKind: "void",
      ...options,
    });
  }

  async execute(
    id: string,
    input: ExecuteRequest,
    options: RequestOptions = {},
  ): Promise<ExecutionResult> {
    const response = await this.transport.request<{ result: ExecutionResult }>(
      `/api/v2/sandboxes/${encodeURIComponent(id)}/execute`,
      { method: "POST", ...jsonBody(input), ...options },
    );
    return response.result;
  }

  async logs(id: string, options: LogsOptions = {}): Promise<SandboxLogs> {
    const { signal, timeoutMs, ...filters } = options;
    const response = await this.transport.request<{ logs: SandboxLogs }>(
      `/api/v2/sandboxes/${encodeURIComponent(id)}/logs${query(filters)}`,
      {
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    );
    return response.logs;
  }
}

export class OperationsResource {
  constructor(private readonly transport: Transport) {}

  async start(
    sandboxId: string,
    input: StartOperationRequest & { idempotencyKey: string },
    options: RequestOptions = {},
  ): Promise<Operation> {
    const { idempotencyKey, ...body } = input;
    const payload = jsonBody(body);
    const response = await this.transport.request<{ operation: Operation }>(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/operations`,
      {
        method: "POST",
        ...payload,
        headers: { ...payload.headers, "idempotency-key": idempotencyKey },
        ...options,
      },
    );
    return response.operation;
  }

  async inspect(
    sandboxId: string,
    operationId: string,
    options: RequestOptions = {},
  ): Promise<Operation> {
    const response = await this.transport.request<{ operation: Operation }>(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/operations/${encodeURIComponent(operationId)}`,
      options,
    );
    return response.operation;
  }

  async output(
    sandboxId: string,
    operationId: string,
    options: OperationOutputOptions,
  ): Promise<OperationOutputChunk> {
    const { signal, timeoutMs, ...parameters } = options;
    return await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/operations/${encodeURIComponent(operationId)}/output${query(parameters)}`,
      {
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    );
  }

  async wait(
    sandboxId: string,
    operationId: string,
    input: WaitOperationInput = {},
    options: RequestOptions = {},
  ): Promise<Operation> {
    const response = await this.transport.request<{ operation: Operation }>(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/operations/${encodeURIComponent(operationId)}/wait`,
      { method: "POST", ...jsonBody(input), ...options },
    );
    return response.operation;
  }

  async cancel(
    sandboxId: string,
    operationId: string,
    options: RequestOptions = {},
  ): Promise<Operation> {
    const response = await this.transport.request<{ operation: Operation }>(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/operations/${encodeURIComponent(operationId)}/cancel`,
      { method: "POST", ...options },
    );
    return response.operation;
  }
}

export class FilesResource {
  constructor(private readonly transport: Transport) {}

  async stat(sandboxId: string, path: string, options: RequestOptions = {}): Promise<FileStat> {
    const response = await this.transport.request<{ file: FileStat }>(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/stat${query({ path })}`,
      options,
    );
    return response.file;
  }

  async read(
    sandboxId: string,
    path: string,
    options: ReadFileOptions = {},
  ): Promise<ReadFileResult> {
    const { signal, timeoutMs, ...parameters } = options;
    const response = await this.transport.raw(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/content${query({ path, ...parameters })}`,
      {
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    );
    const data = new Uint8Array(await response.arrayBuffer());
    const integerHeader = (name: string, fallback: number): number => {
      const value = Number(response.headers.get(name));
      return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
    };
    const offset = integerHeader("x-boxcompute-offset", options.offset ?? 0);
    const nextOffset = integerHeader("x-boxcompute-next-offset", offset + data.byteLength);
    const fileSize = integerHeader("x-boxcompute-file-size", nextOffset);
    const nextCursor = response.headers.get("x-boxcompute-next-cursor") ?? undefined;
    return {
      data,
      offset,
      nextOffset,
      fileSize,
      eof: response.headers.get("x-boxcompute-eof") === "true",
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async write(
    sandboxId: string,
    path: string,
    data: Uint8Array,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/content${query({ path })}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: Uint8Array.from(data).buffer,
        responseKind: "void",
        ...options,
      },
    );
  }

  async edit(
    sandboxId: string,
    path: string,
    input: EditFileInput,
    options: RequestOptions = {},
  ): Promise<EditFileResponse> {
    return await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/content${query({ path })}`,
      {
        method: "PATCH",
        ...jsonBody({ ...input, replaceAll: input.replaceAll ?? false }),
        ...options,
      },
    );
  }

  async list(
    sandboxId: string,
    path: string,
    options: ListFilesOptions = {},
  ): Promise<FileList> {
    const { signal, timeoutMs, ...parameters } = options;
    return await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/list${query({ path, ...parameters })}`,
      {
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    );
  }

  async mkdir(
    sandboxId: string,
    path: string,
    input: { recursive?: boolean } = {},
    options: RequestOptions = {},
  ): Promise<void> {
    await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/directory${query({ path })}`,
      { method: "POST", ...jsonBody(input), responseKind: "void", ...options },
    );
  }

  async rename(
    sandboxId: string,
    path: string,
    input: RenameFileInput,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files/rename${query({ path })}`,
      {
        method: "POST",
        ...jsonBody({ ...input, overwrite: input.overwrite ?? false }),
        responseKind: "void",
        ...options,
      },
    );
  }

  async remove(
    sandboxId: string,
    path: string,
    options: RemoveFileOptions = {},
  ): Promise<void> {
    const { signal, timeoutMs, ...parameters } = options;
    await this.transport.request(
      `/api/v2/sandboxes/${encodeURIComponent(sandboxId)}/files${query({ path, ...parameters })}`,
      {
        method: "DELETE",
        responseKind: "void",
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    );
  }
}

export class UsageResource {
  constructor(private readonly transport: Transport) {}

  async get(days = 30, options: RequestOptions = {}): Promise<Usage> {
    const response = await this.transport.request<{ usage: Usage }>(
      `/api/v2/usage${query({ days })}`,
      options,
    );
    return response.usage;
  }
}

export class BoxCompute {
  readonly auth: AuthResource;
  readonly workspaces: WorkspacesResource;
  readonly sandboxes: SandboxesResource;
  readonly operations: OperationsResource;
  readonly files: FilesResource;
  readonly usage: UsageResource;

  constructor(options: BoxComputeOptions) {
    const transport = new Transport(options.apiKey, options);
    this.auth = new AuthResource(transport);
    this.workspaces = new WorkspacesResource(transport);
    this.sandboxes = new SandboxesResource(transport);
    this.operations = new OperationsResource(transport);
    this.files = new FilesResource(transport);
    this.usage = new UsageResource(transport);
  }
}
