import type { components } from "./generated/schema.js";

export type Workspace = components["schemas"]["Workspace"];
export type Sandbox = components["schemas"]["Sandbox"];
export type ExecuteRequest = components["schemas"]["ExecuteRequest"];
export type ExecutionResult = components["schemas"]["ExecutionResult"];
export type Operation = components["schemas"]["Operation"];
export type OperationOutputChunk = components["schemas"]["OperationOutputChunk"];
export type FileStat = components["schemas"]["FileStat"];
export type FileListEntry = components["schemas"]["FileListEntry"];
export type FileList = components["schemas"]["FileList"];
export type SandboxLogs = components["schemas"]["SandboxLogs"];
export type Usage = components["schemas"]["Usage"];
export type BillingSummary = components["schemas"]["BillingSummary"];
export type BillingTransaction = components["schemas"]["BillingTransaction"];
export type BillingTransactionPage = components["schemas"]["BillingTransactionPage"];
export type ApiErrorBody = components["schemas"]["Error"];
export type CreateWorkspaceRequest = components["schemas"]["CreateWorkspaceRequest"];
export type Me = components["schemas"]["Me"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditEventPage = components["schemas"]["AuditEventPage"];
export type DeletedSandbox = components["schemas"]["DeletedSandbox"];
export type Preview = components["schemas"]["Preview"];
export type CreatePreviewRequest = components["schemas"]["CreatePreviewRequest"];
export type SandboxAnalytics = components["schemas"]["SandboxAnalytics"];
export type SandboxCostReport = components["schemas"]["SandboxCostReport"];
export type SandboxCostDetail = components["schemas"]["SandboxCostDetail"];
/** VM compute size tier: `small` (0.5 vCPU / 1024 MiB) or `large` (1.5 vCPU / 3072 MiB). */
export type VmSandboxSize = "small" | "large";

/**
 * The contract marks vmSandbox and size as defaulted, which the TypeScript
 * generator renders as required. The server accepts an omitted vmSandbox (it
 * selects the VM runtime by default) and an omitted size (it selects `small`),
 * so the hand-written surface keeps both fields optional to match the
 * documented request behavior and the Python client.
 */
export type CreateSandboxRequest = Omit<
  components["schemas"]["CreateSandboxRequest"],
  "vmSandbox" | "size"
> & {
  vmSandbox?: boolean;
  size?: VmSandboxSize;
};
export type StartOperationRequest = components["schemas"]["StartOperationRequest"];
export type WaitOperationRequest = components["schemas"]["WaitOperationRequest"];
export type EditFileRequest = components["schemas"]["EditFileRequest"];
export type EditFileResponse = components["schemas"]["EditFileResponse"];
export type CreateDirectoryRequest = components["schemas"]["CreateDirectoryRequest"];
export type RenameFileRequest = components["schemas"]["RenameFileRequest"];

export type WaitOperationInput = Partial<WaitOperationRequest>;
export type EditFileInput = Omit<EditFileRequest, "replaceAll"> & {
  replaceAll?: boolean;
};
export type RenameFileInput = Omit<RenameFileRequest, "overwrite"> & {
  overwrite?: boolean;
};

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LogsOptions extends RequestOptions {
  since?: string;
  until?: string;
  stream?: "stdout" | "stderr";
  source?: "workload" | "execute" | "process";
  limit?: number;
}

export interface DeletedSandboxLogsOptions extends LogsOptions {
  /** Restrict logs to one retained runtime of the deleted Sandbox. */
  runtime?: string;
}

export interface AnalyticsOptions extends RequestOptions {
  /** RFC 3339 window start. */
  from?: string;
  /** RFC 3339 window end. */
  to?: string;
  /** Bucket width, 60–86400 seconds. The server defaults to 300. */
  resolutionSeconds?: number;
  /** Select one runtime generation. */
  generation?: number;
}

export interface CostReportOptions extends RequestOptions {
  /** RFC 3339 window start. The server defaults to the last 30 days. */
  from?: string;
  /** RFC 3339 window end. */
  to?: string;
  /** Restrict to one API key, or `"none"` for Sandboxes not created with an API key. */
  apiKeyId?: string;
}

export interface BillingTransactionsOptions extends RequestOptions {
  /** Inclusive RFC 3339 start. */
  from?: string;
  /** Exclusive RFC 3339 end. */
  to?: string;
  kind?: string;
  bucket?: BillingTransaction["bucket"];
  /** nextCursor from the previous page. */
  before?: string;
  /** Page size, 1–200; defaults to 50. */
  limit?: number;
}

export interface AuditEventsOptions extends RequestOptions {
  apiKeyId?: string;
  type?: AuditEvent["type"];
  resourceId?: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  outcome?: "success" | "error";
  /** RFC 3339 window start. */
  from?: string;
  /** RFC 3339 window end. */
  to?: string;
  /** `nextCursor` from the previous page. */
  before?: string;
  /** Page size, 1–200. The server defaults to 50. */
  limit?: number;
}

export interface OperationOutputOptions extends RequestOptions {
  stream: "stdout" | "stderr";
  offset: number;
  limit?: number;
}

export interface ReadFileOptions extends RequestOptions {
  offset?: number;
  maxBytes?: number;
  cursor?: string;
}

export interface ReadFileResult {
  data: Uint8Array;
  offset: number;
  nextOffset: number;
  fileSize: number;
  eof: boolean;
  nextCursor?: string;
}

export interface ListFilesOptions extends RequestOptions {
  pageSize?: number;
  cursor?: string;
}

export interface RemoveFileOptions extends RequestOptions {
  recursive?: boolean;
  force?: boolean;
}
