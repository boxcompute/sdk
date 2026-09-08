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
export type ApiErrorBody = components["schemas"]["Error"];
export type CreateWorkspaceRequest = components["schemas"]["CreateWorkspaceRequest"];
export type CreateSandboxRequest = components["schemas"]["CreateSandboxRequest"];
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
