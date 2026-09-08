import { readFile } from "node:fs/promises";

const input = new URL("../openapi/boxcompute-v2.json", import.meta.url);
const contract = JSON.parse(await readFile(input, "utf8"));
const requiredOperations = new Set([
  "revokeCurrentApiKey",
  "listWorkspaces",
  "createWorkspace",
  "listSandboxes",
  "createSandbox",
  "inspectSandbox",
  "deleteSandbox",
  "listSandboxLogs",
  "executeCommand",
  "startSandboxOperation",
  "inspectSandboxOperation",
  "readSandboxOperationOutput",
  "waitForSandboxOperation",
  "cancelSandboxOperation",
  "statSandboxFile",
  "readSandboxFile",
  "writeSandboxFile",
  "editSandboxFile",
  "listSandboxFiles",
  "createSandboxDirectory",
  "renameSandboxFile",
  "removeSandboxFile",
  "getUsage",
]);

if (contract.openapi !== "3.1.0") throw new Error("Expected OpenAPI 3.1.0");
if (contract.info?.version !== "2.0.0") throw new Error("Expected public API v2 contract");
if (contract.servers?.[0]?.url !== "https://api.boxcompute.ai") {
  throw new Error("Unexpected public API server");
}

const operations = new Set();
for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
  if (!path.startsWith("/api/v2/")) throw new Error(`Private or legacy path: ${path}`);
  for (const operation of Object.values(pathItem)) {
    if (operation?.operationId) operations.add(operation.operationId);
  }
}
for (const operation of requiredOperations) {
  if (!operations.has(operation)) throw new Error(`Missing operation: ${operation}`);
}
console.log(`Validated ${operations.size} public API operations`);
