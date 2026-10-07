import { describe, expect, it } from "vitest";
import { BoxCompute, BoxComputeError, BoxComputeTransportError } from "../src/index.js";

const json = (value: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("BoxCompute", () => {
  it("authenticates and unwraps workspace responses", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new BoxCompute({
      apiKey: async () => "bc_live_test",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return json({ workspaces: [{ id: "ws_1", name: "Main", createdAt: 1 }] });
      },
    });

    await expect(client.workspaces.list()).resolves.toEqual([
      { id: "ws_1", name: "Main", createdAt: 1 },
    ]);
    expect(calls[0]?.url).toBe("https://api.boxcompute.ai/api/v2/workspaces");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer bc_live_test",
    );
  });

  it("sends idempotency keys without including them in JSON", async () => {
    let request: RequestInit | undefined;
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (_input, init) => {
        request = init;
        return json({ workspace: { id: "ws_1", name: "Main", createdAt: 1 } }, 201);
      },
    });

    await client.workspaces.create({ name: "Main", idempotencyKey: "create-main" });
    expect(new Headers(request?.headers).get("idempotency-key")).toBe("create-main");
    expect(JSON.parse(String(request?.body))).toEqual({ name: "Main" });
  });

  it("maps structured API failures", async () => {
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async () => json(
        { code: "INSUFFICIENT_SCOPE", error: "Missing sandbox:read" },
        403,
        { "x-request-id": "req_1" },
      ),
    });

    const error = await client.sandboxes.list().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BoxComputeError);
    expect(error).toMatchObject({
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      requestId: "req_1",
      retryable: false,
    });
  });

  it("returns binary file bytes and pagination metadata", async () => {
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async () => new Response(new Uint8Array([0, 255, 128]), {
        headers: {
          "content-type": "application/octet-stream",
          "x-boxcompute-offset": "5",
          "x-boxcompute-next-offset": "8",
          "x-boxcompute-file-size": "10",
          "x-boxcompute-eof": "false",
          "x-boxcompute-next-cursor": "cursor_1",
        },
      }),
    });

    const result = await client.files.read("sbx_1", "/workspace/data.bin", { offset: 5 });
    expect([...result.data]).toEqual([0, 255, 128]);
    expect(result).toMatchObject({
      offset: 5,
      nextOffset: 8,
      fileSize: 10,
      eof: false,
      nextCursor: "cursor_1",
    });
  });

  it("encodes path and query inputs", async () => {
    let requested = "";
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      baseUrl: "https://example.test///",
      fetch: async (input) => {
        requested = String(input);
        return json({ entries: [], nextCursor: null });
      },
    });

    await client.files.list("sbx/one", "/workspace/a b", { pageSize: 25 });
    expect(requested).toBe(
      "https://example.test/api/v2/sandboxes/sbx%2Fone/files/list?path=%2Fworkspace%2Fa+b&pageSize=25",
    );
  });

  it("normalizes base URLs without regex backtracking", async () => {
    const baseUrl = `https://example.test/${"/".repeat(50_000)}resource`;
    let requested = "";
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      baseUrl,
      fetch: async (input) => {
        requested = String(input);
        return json({ workspaces: [] });
      },
    });

    await client.workspaces.list();
    expect(requested).toBe(`${baseUrl}/api/v2/workspaces`);
  });

  it("does not retry or hide transport failures", async () => {
    let calls = 0;
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async () => {
        calls += 1;
        throw new TypeError("network down");
      },
    });

    await expect(client.sandboxes.list()).rejects.toBeInstanceOf(BoxComputeTransportError);
    expect(calls).toBe(1);
  });

  it("applies ergonomic defaults required by the wire contract", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/wait")) return json({ operation: { operationId: "op_1" } });
        if (init?.method === "PATCH") return json({ sha256: "a".repeat(64) });
        return new Response(null, { status: 204 });
      },
    });

    await client.operations.wait("sbx_1", "op_1");
    await client.files.edit("sbx_1", "/workspace/a.txt", {
      expectedSha256: "a".repeat(64),
      oldText: "old",
      newText: "new",
    });
    await client.files.rename("sbx_1", "/workspace/a.txt", {
      destination: "/workspace/b.txt",
    });

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({});
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({ replaceAll: false });
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      destination: "/workspace/b.txt",
      overwrite: false,
    });
  });

  it("creates VM sandboxes with runtime fields and accepts pending responses", async () => {
    const requests: Array<{ init: RequestInit | undefined }> = [];
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (_input, init) => {
        requests.push({ init });
        return json(
          { sandbox: { id: "sbx_vm", workspaceId: "ws_1", state: "pending", vmSandbox: true } },
          202,
        );
      },
    });

    const sandbox = await client.sandboxes.create({
      workspaceId: "ws_1",
      vmSandbox: true,
      blockNetwork: true,
      size: "large",
      idempotencyKey: "vm-create-1",
    });
    expect(sandbox).toMatchObject({ id: "sbx_vm", state: "pending", vmSandbox: true });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      workspaceId: "ws_1",
      vmSandbox: true,
      blockNetwork: true,
      size: "large",
    });
    expect(new Headers(requests[0]?.init?.headers).get("idempotency-key")).toBe("vm-create-1");
  });

  it("omits the runtime and size fields when the caller relies on the server default", async () => {
    let body: unknown;
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return json({ sandbox: { id: "sbx_default", workspaceId: "ws_1", state: "pending", vmSandbox: true } }, 202);
      },
    });

    await client.sandboxes.create({ workspaceId: "ws_1" });
    expect(body).toEqual({ workspaceId: "ws_1" });
  });

  it("sends an explicit small size selector", async () => {
    let body: unknown;
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return json({ sandbox: { id: "sbx_small", workspaceId: "ws_1", state: "pending", vmSandbox: true } }, 202);
      },
    });

    await client.sandboxes.create({ workspaceId: "ws_1", size: "small" });
    expect(body).toEqual({ workspaceId: "ws_1", size: "small" });
  });
  it("reads identity, audit, cost, and analytics routes with encoded filters", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const responses: unknown[] = [
      { account: { id: "acct_1" }, apiKey: { id: "key_1" } },
      { events: [{ id: "evt_1" }], nextCursor: "cur_2" },
      { costs: { currency: "USD", sandboxes: [] } },
      { costs: { runs: [], running: [], truncated: false } },
      { analytics: { sandboxId: "sbx_1", operations: [] } },
    ];
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (input, init) => {
        calls.push({ url: String(input), method: init?.method });
        return json(responses.shift());
      },
    });

    await expect(client.me.get()).resolves.toEqual({
      account: { id: "acct_1" },
      apiKey: { id: "key_1" },
    });
    await expect(client.auditEvents.list({
      type: "api.request",
      outcome: "error",
      before: "cur/1",
      limit: 20,
    })).resolves.toEqual({ events: [{ id: "evt_1" }], nextCursor: "cur_2" });
    await expect(client.costs.sandboxes({ apiKeyId: "none", from: "2026-10-01T00:00:00Z" }))
      .resolves.toEqual({ currency: "USD", sandboxes: [] });
    await expect(client.sandboxes.costs("sbx/1")).resolves.toEqual({
      runs: [],
      running: [],
      truncated: false,
    });
    await expect(client.sandboxes.analytics("sbx_1", { resolutionSeconds: 60, generation: 2 }))
      .resolves.toEqual({ sandboxId: "sbx_1", operations: [] });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.boxcompute.ai/api/v2/me",
      "https://api.boxcompute.ai/api/v2/audit-events?type=api.request&outcome=error&before=cur%2F1&limit=20",
      "https://api.boxcompute.ai/api/v2/costs/sandboxes?apiKeyId=none&from=2026-10-01T00%3A00%3A00Z",
      "https://api.boxcompute.ai/api/v2/sandboxes/sbx%2F1/costs",
      "https://api.boxcompute.ai/api/v2/sandboxes/sbx_1/analytics?resolutionSeconds=60&generation=2",
    ]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("lists deleted sandboxes and reads their retained logs and costs", async () => {
    const urls: string[] = [];
    const responses: unknown[] = [
      { deletedSandboxes: [{ id: "dsb_1", sandboxId: "sbx_1" }] },
      { logs: { sandboxId: "sbx_1", entries: [] } },
      { costs: { runs: [{ id: "run_1" }], running: [], truncated: false } },
    ];
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (input) => {
        urls.push(String(input));
        return json(responses.shift());
      },
    });

    await expect(client.deletedSandboxes.list()).resolves.toEqual([
      { id: "dsb_1", sandboxId: "sbx_1" },
    ]);
    await expect(client.deletedSandboxes.logs("dsb_1", { runtime: "rt_1", stream: "stderr" }))
      .resolves.toEqual({ sandboxId: "sbx_1", entries: [] });
    await expect(client.deletedSandboxes.costs("dsb_1")).resolves.toEqual({
      runs: [{ id: "run_1" }],
      running: [],
      truncated: false,
    });
    expect(urls).toEqual([
      "https://api.boxcompute.ai/api/v2/deleted-sandboxes",
      "https://api.boxcompute.ai/api/v2/deleted-sandboxes/dsb_1/logs?runtime=rt_1&stream=stderr",
      "https://api.boxcompute.ai/api/v2/deleted-sandboxes/dsb_1/costs",
    ]);
  });

  it("creates and closes browser previews", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const preview = {
      previewId: "prv_1",
      sandboxId: "sbx_1",
      port: 3000,
      url: "https://prv-1.bxcpreview.com",
      expiresAt: "2026-10-07T13:00:00.000Z",
    };
    const client = new BoxCompute({
      apiKey: "bc_live_test",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ preview }, 201);
      },
    });

    await expect(client.previews.create("sbx_1", { port: 3000 })).resolves.toEqual(preview);
    await expect(client.previews.close("sbx_1", "prv_1")).resolves.toBeUndefined();
    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ["POST", "https://api.boxcompute.ai/api/v2/sandboxes/sbx_1/previews"],
      ["DELETE", "https://api.boxcompute.ai/api/v2/sandboxes/sbx_1/previews/prv_1"],
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ port: 3000 });
  });
});
