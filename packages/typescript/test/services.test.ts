import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoxComputePublicServiceClient,
  SERVICE_CLIENT_RELEASE,
  openServices,
  resolveServiceClientBinary,
  serviceClientCacheDir,
  unsealServices,
  type ServiceAccessRequest,
} from "../src/services.js";
import { BoxComputeTransportError } from "../src/errors.js";

afterEach(() => { vi.restoreAllMocks(); });

const id = "11234567-89ab-4cde-8fab-0123456789ab";

function seal(request: ServiceAccessRequest, change: Record<string, unknown> = {}) {
  const sender = generateKeyPairSync("x25519");
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(request.recipient_key, "base64")]), format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey: sender.privateKey, publicKey });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), "boxcompute-connection-v1", 32)), nonce);
  cipher.setAAD(Buffer.from(id));
  const body = { address: "tc-test-address", expires_at: request.requested_at + 3600, ports: request.ports, ...change };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body)), cipher.final()]);
  return { generation_id: id, expires_at: request.requested_at + 3600, sealed: Buffer.concat([
    sender.publicKey.export({ format: "der", type: "spki" }).subarray(-32), nonce, ciphertext, cipher.getAuthTag(),
  ]).toString("base64") };
}

/** A real fixture binary standing in for the native `service-client`: it logs
 * every stdin line to a JSONL file and answers the handshake in order. */
async function fixture(options: { conflict?: boolean; dieAfterReady?: boolean } = {}) {
  const conflict = options.conflict ?? false;
  const dieAfterReady = options.dieAfterReady ?? false;
  const dir = await mkdtemp(path.join(tmpdir(), "service-client-fixture-"));
  const log = path.join(dir, "messages.jsonl");
  const binary = path.join(dir, "boxcompute-proxy-fixture");
  await writeFile(binary, `#!/usr/bin/env node
const fs = require("node:fs");
const log = ${JSON.stringify(log)};
let count = 0, buffered = "";
fs.writeFileSync(log, "");
process.stdin.on("data", chunk => {
  buffered += chunk.toString("utf8");
  let index;
  while ((index = buffered.indexOf("\\n")) >= 0) {
    const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
    count += 1;
    fs.appendFileSync(log, line + "\\n");
    ${conflict ? "process.exit(1);" : dieAfterReady
      ? `process.stdout.write((count === 1 ? JSON.stringify({ client_key: "nodekey:" + "1".repeat(64) }) : JSON.stringify({ ready: true })) + "\\n");
    if (count === 2) setTimeout(() => process.exit(1), 50);`
      : `process.stdout.write((count === 1 ? JSON.stringify({ client_key: "nodekey:" + "1".repeat(64) }) : JSON.stringify({ ready: true })) + "\\n");`}
  }
});
`, { mode: 0o755 });
  const messages = async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown);
  return { binary, messages };
}

function api() {
  return {
    createServiceAccess: vi.fn(async (request: ServiceAccessRequest) => seal(request)),
    lookupServiceAccess: vi.fn(async (request: ServiceAccessRequest) => seal(request)),
    revokeServiceAccess: vi.fn(async (_generation: string) => {}),
  };
}

it("retains one child for multiple mappings, sends secrets only on stdin, and revokes once on close", async () => {
  const f = await fixture();
  const a = api();
  const session = await openServices(a, [{ local: 18080, remote: 8080 }, { local: 13000, remote: 3000 }], undefined, { binaryPath: f.binary });
  expect(a.createServiceAccess).toHaveBeenCalledTimes(1);
  expect(a.createServiceAccess.mock.calls[0]![0].ports).toEqual([3000, 8080]);
  expect(session.generationId).toBe(id);
  expect(session.expiresAt).toBe(a.createServiceAccess.mock.calls[0]![0].requested_at + 3600);
  expect(await f.messages()).toEqual([{ mappings: [{ local: 18080, remote: 8080 }, { local: 13000, remote: 3000 }] },
    { address: "tc-test-address", expires_at: session.expiresAt }]);
  await Promise.all([session.close(), session.close()]);
  expect(a.revokeServiceAccess).toHaveBeenCalledExactlyOnceWith(id);
  expect(a.lookupServiceAccess).not.toHaveBeenCalled();
});

it("rejects invalid mappings without spawning the client or calling the API", async () => {
  const f = await fixture();
  const a = api();
  for (const mappings of [
    [],
    Array.from({ length: 9 }, (_, i) => ({ local: i + 1, remote: i + 1 })),
    [{ local: 8080, remote: 8080 }, { local: 8080, remote: 3000 }],
    [{ local: 0, remote: 8080 }],
  ]) {
    await expect(openServices(a, mappings, undefined, { binaryPath: f.binary })).rejects.toThrow("Service access unavailable");
  }
  expect(a.createServiceAccess).not.toHaveBeenCalled();
});

it("does not issue a grant after a native local-port conflict", async () => {
  const f = await fixture({ conflict: true });
  const a = api();
  await expect(openServices(a, [{ local: 8080, remote: 8080 }], undefined, { binaryPath: f.binary })).rejects.toThrow("Service access unavailable");
  expect(a.createServiceAccess).not.toHaveBeenCalled();
  expect(a.revokeServiceAccess).not.toHaveBeenCalled();
});

it("does not retry an ambiguous create and never masks an unexpected child exit as success", async () => {
  const f = await fixture();
  const a = api();
  a.createServiceAccess.mockRejectedValueOnce(new Error("private transport failure"));
  await expect(openServices(a, [{ local: 8080, remote: 8080 }], undefined, { binaryPath: f.binary })).rejects.toThrow("Service access unavailable");
  expect(a.createServiceAccess).toHaveBeenCalledTimes(1);
  const next = await fixture({ dieAfterReady: true });
  const nextApi = api();
  const session = await openServices(nextApi, [{ local: 8080, remote: 8080 }], undefined, { binaryPath: next.binary });
  await expect(session.closed).rejects.toThrow("Service access unavailable");
  expect(nextApi.revokeServiceAccess).toHaveBeenCalledExactlyOnceWith(id);
});

it("reports an unexpected child exit after readiness as a failed session", async () => {
  const f = await fixture({ dieAfterReady: true });
  const a = api();
  const session = await openServices(a, [{ local: 8080, remote: 8080 }], undefined, { binaryPath: f.binary });
  await expect(session.closed).rejects.toThrow("Service access unavailable");
  expect(a.revokeServiceAccess).toHaveBeenCalledExactlyOnceWith(id);
});

it("binds authenticated inner ports, exact expiry and generation before forwarding", () => {
  const recipient = generateKeyPairSync("x25519");
  const request: ServiceAccessRequest = { operation_id: id, requested_at: Math.floor(Date.now() / 1000), ports: [3000, 8080], client_key: "nodekey:" + "1".repeat(64),
    recipient_key: recipient.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
  const good = seal(request);
  expect(unsealServices(good, recipient.privateKey, request)).toEqual({ address: "tc-test-address", expires_at: request.requested_at + 3600 });
});

it("rejects unseal drift on ports, expiry, generation and sealed bytes", () => {
  const recipient = generateKeyPairSync("x25519");
  const request: ServiceAccessRequest = { operation_id: id, requested_at: Math.floor(Date.now() / 1000), ports: [3000, 8080], client_key: "nodekey:" + "1".repeat(64),
    recipient_key: recipient.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
  const good = seal(request);
  for (const bad of [
    seal(request, { ports: [3000, 9090] }),
    seal(request, { expires_at: request.requested_at + 3599 }),
    seal(request, { address: "tc\0injection" }),
    { ...good, expires_at: good.expires_at + 1 },
    { ...good, generation_id: "21234567-89ab-4cde-8fab-0123456789ab" },
    { ...good, sealed: good.sealed.slice(0, -4) + "AAAA" },
  ]) {
    expect(() => unsealServices(bad, recipient.privateKey, request)).toThrow("Service access unavailable");
  }
});

it("uses the public HTTPS contract with an operation-scoped idempotency key and no operation_id in the body", async () => {
  const request: ServiceAccessRequest = { operation_id: id, requested_at: Math.floor(Date.now() / 1000) - 27,
    client_key: "nodekey:" + "1".repeat(64), recipient_key: Buffer.alloc(32, 2).toString("base64"), ports: [3000, 8080] };
  const response = { generation_id: id, expires_at: request.requested_at + 3600, sealed: Buffer.alloc(96).toString("base64") };
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    new Response(JSON.stringify(init?.method === "DELETE" ? { generation_id: id, cleanup: "guardian-confirmed" } : response), { status: 200 }));
  const client = new BoxComputePublicServiceClient({ baseUrl: "https://public.example/", apiKey: () => "fixture-token", fetch: fetcher as unknown as typeof fetch });
  expect(await client.createServiceAccess("sbx_public", request)).toEqual(response);
  expect(await client.lookupServiceAccess("sbx_public", request)).toEqual(response);
  await client.revokeServiceAccess("sbx_public", id);
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/api/v2/sandboxes/sbx_public/services", "/api/v2/sandboxes/sbx_public/services/lookup",
    `/api/v2/sandboxes/sbx_public/services/${id}`,
  ]);
  const { operation_id, ...body } = request;
  for (const [, init] of fetcher.mock.calls.slice(0, 2)) {
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(operation_id);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-token");
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(init?.redirect).toBe("error");
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("composes the retained client with public slot forwarding and never sends internal paths", async () => {
  const f = await fixture();
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json({ generation_id: id, cleanup: "guardian-confirmed" });
    return Response.json(seal({ ...JSON.parse(String(init?.body)), operation_id: new Headers(init?.headers).get("idempotency-key") as string }));
  });
  const client = new BoxComputePublicServiceClient({ baseUrl: "https://public.example", apiKey: "public-fixture-token", fetch: fetcher as unknown as typeof fetch });
  const session = await client.openServices("sbx_public", [{ local: 13000, remote: 3000 }, { local: 18080, remote: 8080 }], undefined, { binaryPath: f.binary });
  await session.close();
  expect(await f.messages()).toEqual([{ mappings: [{ local: 13000, remote: 3000 }, { local: 18080, remote: 8080 }] },
    { address: "tc-test-address", expires_at: session.expiresAt }]);
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "https://public.example/api/v2/sandboxes/sbx_public/services",
    `https://public.example/api/v2/sandboxes/sbx_public/services/${id}`,
  ]);
  const init = fetcher.mock.calls[0]![1]!;
  expect(JSON.parse(String(init.body))).not.toHaveProperty("operation_id");
  expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^[a-f0-9-]{36}$/);
  expect(init.redirect).toBe("error");
});

it("rejects public target/input drift and uncertain responses without retry", async () => {
  const request: ServiceAccessRequest = { operation_id: id, requested_at: Math.floor(Date.now() / 1000) - 11,
    client_key: "nodekey:" + "1".repeat(64), recipient_key: Buffer.alloc(32, 2).toString("base64"), ports: [3000, 8080] };
  const fetcher = vi.fn(async (_url: string | URL | Request) =>
    Response.json({ generation_id: id, expires_at: request.requested_at + 301, sealed: Buffer.alloc(96).toString("base64") }));
  const config = { baseUrl: "https://public.example", apiKey: "fixture" as const, fetch: fetcher as unknown as typeof fetch };
  for (const baseUrl of ["http://public.example", "https://public.example/internal", "https://user:pass@public.example", "https://public.example/?x=1"])
    expect(() => new BoxComputePublicServiceClient({ ...config, baseUrl })).toThrow("Public service API requires HTTPS origin and public token provider");
  const client = new BoxComputePublicServiceClient(config);
  await expect(client.createServiceAccess("sb-internal", request)).rejects.toThrow("Public service access unavailable; cleanup may be unconfirmed");
  await expect(client.createServiceAccess("sbx_public", { ...request, ports: [8080, 3000] })).rejects.toThrow("Public service access unavailable");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.lookupServiceAccess("sbx_public", request)).rejects.toBeInstanceOf(BoxComputeTransportError);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain("/services/lookup");
});

describe("service client binary resolution", () => {
  it("uses the BOXCOMPUTE_SERVICE_CLIENT override directly when it is an absolute executable file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "service-client-override-"));
    const binary = path.join(dir, "boxcompute-proxy-fixture");
    await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
    await expect(resolveServiceClientBinary({ env: { BOXCOMPUTE_SERVICE_CLIENT: binary } })).resolves.toBe(binary);
    await expect(resolveServiceClientBinary({ env: { BOXCOMPUTE_SERVICE_CLIENT: "relative/binary" } })).rejects.toThrow("BOXCOMPUTE_SERVICE_CLIENT must be an absolute path to an existing executable file");
    await expect(resolveServiceClientBinary({ env: { BOXCOMPUTE_SERVICE_CLIENT: path.join(dir, "missing") } })).rejects.toThrow("BOXCOMPUTE_SERVICE_CLIENT must be an absolute path to an existing executable file");
    await chmod(binary, 0o644);
    await expect(resolveServiceClientBinary({ env: { BOXCOMPUTE_SERVICE_CLIENT: binary } })).rejects.toThrow("is not executable");
  });

  it("fails with an actionable message while the release asset pin is null", async () => {
    await expect(resolveServiceClientBinary({ env: {} })).rejects.toThrow("Set BOXCOMPUTE_SERVICE_CLIENT to the absolute path of an existing boxcompute-proxy binary");
    await expect(resolveServiceClientBinary({ env: {}, platform: "win32", arch: "x64" })).rejects.toThrow("linux/darwin x64/arm64 only");
  });

  it("downloads a pinned asset, verifies the digest before executing, and caches it executably", async () => {
    const release = await mkdtemp(path.join(tmpdir(), "service-client-release-"));
    const cache = await mkdtemp(path.join(tmpdir(), "service-client-cache-"));
    const bytes = Buffer.from("#!/bin/sh\necho service-client-fixture\n");
    const asset = path.join(release, "boxcompute-proxy-linux-x64");
    await writeFile(asset, bytes);
    const pin = { url: pathToFileURL(asset).toString(), sha256: createHash("sha256").update(bytes).digest("hex") };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(pin.url);
      return new Response(await readFile(asset));
    });
    const resolved = await resolveServiceClientBinary({
      env: {}, fetch: fetcher as unknown as typeof fetch, platform: "linux", arch: "x64",
      cacheDir: path.join(cache, "custom"),
      release: { tag: "service-client-v0", assets: { ...SERVICE_CLIENT_RELEASE.assets, "linux-x64": pin } },
    });
    expect(resolved).toBe(path.join(path.join(cache, "custom"), SERVICE_CLIENT_RELEASE.tag, "boxcompute-proxy-linux-x64"));
    expect(serviceClientCacheDir()).toMatch(/\.boxcompute[/\\]service-client$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const info = await stat(resolved);
    expect(info.isFile()).toBe(true);
    expect(info.mode & 0o777).toBe(0o755);
    // A second resolution serves the cached binary without another download.
    await expect(resolveServiceClientBinary({
      env: {}, fetch: fetcher as unknown as typeof fetch, platform: "linux", arch: "x64",
      cacheDir: path.join(cache, "custom"),
      release: { tag: "service-client-v0", assets: { ...SERVICE_CLIENT_RELEASE.assets, "linux-x64": pin } },
    })).resolves.toBe(resolved);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache or execute bytes whose digest does not match the pin", async () => {
    const release = await mkdtemp(path.join(tmpdir(), "service-client-release-"));
    const cache = await mkdtemp(path.join(tmpdir(), "service-client-cache-"));
    const asset = path.join(release, "boxcompute-proxy-darwin-arm64");
    const bytes = Buffer.from("#!/bin/sh\nevil\n");
    await writeFile(asset, bytes);
    const fetcher = vi.fn(async () => new Response(await readFile(asset)));
    await expect(resolveServiceClientBinary({
      env: {}, fetch: fetcher as unknown as typeof fetch, platform: "darwin", arch: "arm64",
      cacheDir: cache,
      release: { tag: "service-client-v0", assets: { ...SERVICE_CLIENT_RELEASE.assets, "darwin-arm64": { url: pathToFileURL(asset).toString(), sha256: "0".repeat(64) } } },
    })).rejects.toThrow("does not match the pinned sha256 digest");
    const entries = await stat(path.join(cache, SERVICE_CLIENT_RELEASE.tag)).catch(() => undefined);
    expect(entries).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await chmod(asset, 0o755);
  });
});
