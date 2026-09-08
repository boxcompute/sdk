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
      baseUrl: "https://example.test/",
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
});
