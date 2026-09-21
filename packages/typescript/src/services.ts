import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomUUID, type KeyObject } from "node:crypto";
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ApiKeyProvider } from "./client.js";
import { BoxComputeTransportError } from "./errors.js";

export interface ServiceMapping { local: number; remote: number }
export interface ServiceAccessRequest { operation_id: string; requested_at: number; client_key: string; recipient_key: string; ports: number[] }
export interface ServiceAccessResponse { generation_id: string; expires_at: number; sealed: string }
export interface ServiceAccessApi {
  createServiceAccess(request: ServiceAccessRequest): Promise<ServiceAccessResponse>;
  lookupServiceAccess(request: ServiceAccessRequest): Promise<ServiceAccessResponse>;
  revokeServiceAccess(generation: string): Promise<void>;
}

const unavailable = () => new Error("Service access unavailable; no mutation retry was attempted. Unconfirmed access expires at its original deadline.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function nativeMessage(child: ChildProcessByStdio<Writable, Readable, null>, message: object, stop: () => void) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffered = "";
    const cleanup = () => { clearTimeout(timer); child.off("close", failed); child.stdout.off("data", data); };
    const failed = () => { cleanup(); reject(unavailable()); };
    const timer = setTimeout(() => { stop(); failed(); }, 10000);
    const data = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (Buffer.byteLength(buffered) > 4096) { stop(); failed(); return; }
      if (!buffered.includes("\n")) return;
      cleanup();
      try {
        const value: unknown = JSON.parse(buffered);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
        resolve(value as Record<string, unknown>);
      } catch { stop(); reject(unavailable()); }
    };
    child.once("close", failed);
    child.stdout.on("data", data);
    child.stdin.write(JSON.stringify(message) + "\n");
  });
}

export function unsealServices(value: ServiceAccessResponse, recipient: KeyObject, request: ServiceAccessRequest) {
  try {
    const now = Date.now()/1000;
    if (!value || Object.keys(value).sort().join(",") !== "expires_at,generation_id,sealed" || !uuid.test(value.generation_id)
      || value.expires_at !== request.requested_at+3600 || value.expires_at <= now || value.expires_at > now+3630
      || typeof value.sealed !== "string" || value.sealed.length < 80 || value.sealed.length > 16000) throw unavailable();
    const bytes = Buffer.from(value.sealed,"base64");
    if (bytes.toString("base64") !== value.sealed) throw unavailable();
    const shared = diffieHellman({ privateKey:recipient, publicKey:createPublicKey({ format:"der",type:"spki",
      key:Buffer.concat([Buffer.from("302a300506032b656e032100","hex"),bytes.subarray(0,32)]) }) });
    const secret = Buffer.from(hkdfSync("sha256",shared,Buffer.alloc(0),"boxcompute-connection-v1",32));
    let clear: Buffer;
    try {
      const cipher = createDecipheriv("aes-256-gcm",secret,bytes.subarray(32,44));
      cipher.setAAD(Buffer.from(value.generation_id)); cipher.setAuthTag(bytes.subarray(-16));
      clear=Buffer.concat([cipher.update(bytes.subarray(44,-16)),cipher.final()]);
    } finally { shared.fill(0); secret.fill(0); }
    try {
      const text=new TextDecoder("utf-8",{fatal:true}).decode(clear);
      const inner=JSON.parse(text) as {address:unknown;expires_at:unknown;ports:unknown};
      if (text!==JSON.stringify({address:inner.address,expires_at:inner.expires_at,ports:inner.ports})
        || inner.expires_at!==value.expires_at || JSON.stringify(inner.ports)!==JSON.stringify(request.ports)
        || typeof inner.address!=="string" || inner.address.length>4096 || !/^[A-Za-z0-9_+/:=.-]+$/.test(inner.address)) throw unavailable();
      return {address:inner.address,expires_at:value.expires_at};
    } finally {clear.fill(0);}
  } catch {throw unavailable();}
}

/**
 * The native `service-client` binary is never bundled with this package: it is
 * published as digest-pinned release assets on the public `boxcompute/sdk`
 * GitHub repository (owner decision, 2026-09-21: GitHub, not npm, for
 * binaries). `SERVICE_CLIENT_RELEASE` is the pin table — publishing an asset
 * for a platform is a one-line change that fills the matching `null` entry
 * with its download URL and sha256 digest.
 */
export type ServiceClientAssetKey = "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";
export interface ServiceClientAssetPin { url: string; sha256: string }
export interface ServiceClientRelease {
  tag: string;
  /** One entry per supported platform-arch; `null` until the release asset is published. */
  assets: Record<ServiceClientAssetKey, ServiceClientAssetPin | null>;
}
export const SERVICE_CLIENT_RELEASE: ServiceClientRelease = {
  tag: "service-client-v0",
  assets: {
    "linux-x64": null,
    "linux-arm64": null,
    "darwin-x64": null,
    "darwin-arm64": null,
  },
};

/** Per-user cache root for downloaded release assets. The assets are public
 * and unauthenticated, so no secret material is cached; `os.tmpdir()` keeps the
 * cache writable without installation privileges and out of the package tree. */
export function serviceClientCacheDir(): string {
  return path.join(tmpdir(), ".boxcompute", "service-client");
}

export interface ResolveServiceClientBinaryOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  cacheDir?: string;
  /** Override the published pin table (defaults to SERVICE_CLIENT_RELEASE). */
  release?: ServiceClientRelease;
}

/** Resolve the native `service-client` binary for this process.
 *
 * Order: the `BOXCOMPUTE_SERVICE_CLIENT` environment variable (absolute path
 * to an existing executable file, used directly), then the pinned release
 * asset downloaded into the per-user cache, sha256-verified before it is made
 * executable and atomically renamed into place. Unverified bytes are never
 * executed. Configuration failures surface their actionable message directly
 * instead of the generic service-unavailable error.
 */
export async function resolveServiceClientBinary(options: ResolveServiceClientBinaryOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const key = `${platform}-${arch}` as ServiceClientAssetKey;
  const override = (options.env ?? process.env).BOXCOMPUTE_SERVICE_CLIENT;
  if (override) {
    if (!path.isAbsolute(override)) throw new Error(`BOXCOMPUTE_SERVICE_CLIENT must be an absolute path to an existing executable file; got "${override}".`);
    const info = await stat(override).catch(() => undefined);
    if (!info?.isFile() || !(info.mode & 0o111)) throw new Error(`BOXCOMPUTE_SERVICE_CLIENT must be an absolute path to an existing executable file; "${override}" is not executable.`);
    return override;
  }
  if (!(["linux", "darwin"].includes(platform) && ["x64", "arm64"].includes(arch)))
    throw new Error(`Service client release assets are published for linux/darwin x64/arm64 only; none exists for ${key}. Set BOXCOMPUTE_SERVICE_CLIENT to the absolute path of an existing boxcompute-proxy binary.`);
  const release = options.release ?? SERVICE_CLIENT_RELEASE;
  const pin = release.assets[key];
  if (!pin)
    throw new Error(`The service client release asset for ${key} is not published yet. Set BOXCOMPUTE_SERVICE_CLIENT to the absolute path of an existing boxcompute-proxy binary.`);
  const cacheDir = path.join(options.cacheDir ?? serviceClientCacheDir(), release.tag);
  const name = `boxcompute-proxy-${platform}-${arch}`;
  const binary = path.join(cacheDir, name);
  const cached = await stat(binary).catch(() => undefined);
  if (cached?.isFile() && cached.mode & 0o111) return binary;
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(pin.url);
  if (!response.ok) throw new Error(`Failed to download the service client for ${key} from ${pin.url} (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256)
    throw new Error(`The downloaded service client for ${key} does not match the pinned sha256 digest (${pin.sha256}); refusing to execute unverified bytes.`);
  await mkdir(cacheDir, { recursive: true });
  const staging = path.join(cacheDir, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(staging, bytes, { mode: 0o600 });
  await chmod(staging, 0o755);
  await rename(staging, binary); // Atomic within the cache directory.
  return binary;
}

export interface OpenServicesOptions extends ResolveServiceClientBinaryOptions {
  /** Use this binary directly instead of the env/pinned-release resolution. */
  binaryPath?: string;
}

/** Bind every local IPv4-loopback port before issuing one grant. Retain a
 * single native process/client for the complete session; never renew or retry
 * create. API credentials and recipient private keys never enter the child.
 */
export async function openServices(api: ServiceAccessApi, mappings: readonly ServiceMapping[], signal?: AbortSignal, options?: OpenServicesOptions) {
  if (signal?.aborted || !(["linux", "darwin"].includes(process.platform) && ["x64", "arm64"].includes(process.arch))
    || mappings.length<1 || mappings.length>8 || mappings.some(m=>Object.keys(m).sort().join(",")!=="local,remote"
      || !Number.isInteger(m.local) || m.local<1 || m.local>65535 || !Number.isInteger(m.remote) || m.remote<1 || m.remote>65535)
    || new Set(mappings.map(m=>m.local)).size!==mappings.length || new Set(mappings.map(m=>m.remote)).size!==mappings.length) throw unavailable();
  // Resolved before the session try block so configuration failures (missing
  // binary, digest mismatch) surface their actionable message directly.
  const binary = options?.binaryPath ?? await resolveServiceClientBinary(options);
  const selected=mappings.map(m=>({...m}));
  const child=spawn(binary,["service-client"],{stdio:["pipe","pipe","ignore"],
    env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
  let exited=false, stopping=false, generation:string|undefined, revocation:Promise<void>|undefined;
  let killTimer:NodeJS.Timeout|undefined;
  const stop=()=>{
    if(stopping || exited) return;
    stopping=true; child.stdin.destroy(); child.kill("SIGTERM");
    killTimer=setTimeout(()=>child.kill("SIGKILL"),6000);
  };
  const closed=new Promise<number|null>(resolve=>child.once("close",code=>{
    exited=true;clearTimeout(killTimer);signal?.removeEventListener("abort",stop);resolve(code);
  }));
  child.on("error",()=>{});
  child.stdin.on("error",stop);
  signal?.addEventListener("abort",stop,{once:true});
  const revoke=()=>revocation??=(generation?api.revokeServiceAccess(generation):Promise.resolve());
  try {
    const bootstrap=await nativeMessage(child,{mappings:selected},stop);
    const clientKey=bootstrap.client_key;
    if(Object.keys(bootstrap).join(",")!=="client_key" || typeof clientKey!=="string" || !/^nodekey:[0-9a-f]{64}$/.test(clientKey) || /^nodekey:0+$/.test(clientKey))throw unavailable();
    if(exited || stopping || signal?.aborted)throw unavailable();
    const recipient=generateKeyPairSync("x25519");
    const request:ServiceAccessRequest={operation_id:randomUUID(),requested_at:Math.floor(Date.now()/1000),client_key:clientKey,
      recipient_key:recipient.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64"),ports:selected.map(m=>m.remote).sort((a,b)=>a-b)};
    const result=await api.createServiceAccess(request);
    if(result && typeof result.generation_id==="string" && uuid.test(result.generation_id)) generation=result.generation_id;
    const configuration=unsealServices(result,recipient.privateKey,request);
    if(exited || stopping || signal?.aborted)throw unavailable();
    const ready=await nativeMessage(child,configuration,stop);
    if(Object.keys(ready).join(",")!=="ready" || ready.ready!==true || exited || stopping)throw unavailable();
    const completion=closed.then(async code=>{await revoke();if(code!==0 && !stopping)throw unavailable();});
    // Consumers may observe completion later; still avoid an unhandled rejection.
    void completion.catch(()=>{});
    return {generationId:result.generation_id,expiresAt:result.expires_at,closed:completion,
      close:async()=>{stop();await completion;}};
  } catch {
    stop();await closed;
    try {await revoke();} catch { /* Report fixed unconfirmed-access error. */ }
    throw unavailable();
  }
}

/** Public slot IDs and public bearer credentials only; never provisions or
 * substitutes an internal runtime. Local forwarding retains one native client. */
export interface PublicServiceClientOptions {
  apiKey: ApiKeyProvider;
  baseUrl: string;
  fetch?: typeof fetch;
}

export class BoxComputePublicServiceClient {
  private readonly config: PublicServiceClientOptions;
  constructor(config: PublicServiceClientOptions) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !config.apiKey)
      throw new TypeError("Public service API requires HTTPS origin and public token provider");
    this.config = { ...config, baseUrl: url.origin + "/" };
  }
  openServices(slotId: string, mappings: readonly ServiceMapping[], signal?: AbortSignal, options?: OpenServicesOptions) {
    return openServices({
      createServiceAccess: request => this.createServiceAccess(slotId, request),
      lookupServiceAccess: request => this.lookupServiceAccess(slotId, request),
      revokeServiceAccess: generation => this.revokeServiceAccess(slotId, generation),
    }, mappings, signal, options);
  }
  private async call(slotId: string, action: "create" | "lookup" | "revoke", request?: ServiceAccessRequest, generation?: string): Promise<ServiceAccessResponse> {
    try {
      if (!/^sbx_[a-zA-Z0-9_-]+$/.test(slotId)) throw new Error();
      if (action === "revoke") {
        if (!uuid.test(generation ?? "")) throw new Error();
      } else {
        const now = Math.floor(Date.now() / 1000);
        if (!request || Object.keys(request).sort().join() !== "client_key,operation_id,ports,recipient_key,requested_at"
          || !uuid.test(request.operation_id) || !Number.isSafeInteger(request.requested_at) || request.requested_at <= 0
          || request.requested_at > now || now - request.requested_at >= 3600
          || !/^nodekey:(?!0{64}$)[a-f0-9]{64}$/.test(request.client_key)
          || Buffer.from(request.recipient_key, "base64").length !== 32
          || Buffer.from(request.recipient_key, "base64").toString("base64") !== request.recipient_key
          || !Array.isArray(request.ports) || request.ports.length < 1 || request.ports.length > 8
          || request.ports.some((p, i) => !Number.isInteger(p) || p < 1 || p > 65535 || (i > 0 && p <= request.ports[i - 1]!))) throw new Error();
      }
      const signal = AbortSignal.timeout(action === "create" ? 45_000 : 25_000);
      const provider = this.config.apiKey;
      const token = typeof provider === "string" ? provider : await provider();
      signal.throwIfAborted();
      if (!token) throw new Error();
      const path = `api/v2/sandboxes/${encodeURIComponent(slotId)}/services`;
      const { operation_id, ...body } = request ?? {};
      let abort!: () => void;
      const timeout = new Promise<never>((_, reject) => {
        abort = () => reject(new Error());
        signal.addEventListener("abort", abort, { once: true });
      });
      const fetchImpl = this.config.fetch ?? fetch;
      let response: Response;
      try {
        response = await Promise.race([timeout, fetchImpl(`${this.config.baseUrl}${
          action === "create" ? path : action === "lookup" ? `${path}/lookup` : `${path}/${encodeURIComponent(generation!)}`
        }`, {
          method: action === "revoke" ? "DELETE" : "POST", signal, redirect: "error",
          ...(request ? { headers: { "authorization": `Bearer ${token}`, "content-type": "application/json", "idempotency-key": operation_id! }, body: JSON.stringify(body) } : {}),
        })]);
      } finally { signal.removeEventListener("abort", abort); }
      if (!response.ok) throw new Error();
      const result = await response.json() as ServiceAccessResponse & { cleanup?: string };
      if (action === "revoke") {
        if (!result || Object.keys(result).sort().join() !== "cleanup,generation_id" || result.generation_id !== generation || result.cleanup !== "guardian-confirmed") throw new Error();
      } else if (!result || Object.keys(result).sort().join() !== "expires_at,generation_id,sealed" || !uuid.test(result.generation_id)
        || result.expires_at !== request!.requested_at + 3600 || result.expires_at <= Math.floor(Date.now() / 1000)
        || typeof result.sealed !== "string" || result.sealed.length < 80 || result.sealed.length > 16000
        || Buffer.from(result.sealed, "base64").toString("base64") !== result.sealed) throw new Error();
      return result;
    } catch { throw new BoxComputeTransportError("Public service access unavailable; cleanup may be unconfirmed"); }
  }
  createServiceAccess(slotId: string, request: ServiceAccessRequest) { return this.call(slotId, "create", request); }
  lookupServiceAccess(slotId: string, request: ServiceAccessRequest) { return this.call(slotId, "lookup", request); }
  async revokeServiceAccess(slotId: string, generation: string): Promise<void> { await this.call(slotId, "revoke", undefined, generation); }
}
