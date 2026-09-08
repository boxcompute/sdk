# `@boxcompute/sdk`

Official TypeScript SDK for the BoxCompute public API.

```bash
npm install @boxcompute/sdk
```

```ts
import { BoxCompute } from "@boxcompute/sdk";

const boxcompute = new BoxCompute({
  apiKey: process.env.BOXCOMPUTE_API_KEY!,
});

const [existingWorkspace] = await boxcompute.workspaces.list();
const workspace = existingWorkspace ?? await boxcompute.workspaces.create({
  name: "SDK quickstart",
  idempotencyKey: "sdk-quickstart-workspace-v1",
});
const sandbox = await boxcompute.sandboxes.create({
  workspaceId: workspace.id,
  idempotencyKey: crypto.randomUUID(),
});

const result = await boxcompute.sandboxes.execute(sandbox.id, {
  argv: ["python3", "-c", "print('hello')"],
});
console.log(result.stdout);

await boxcompute.sandboxes.delete(sandbox.id);
```

The SDK includes workspaces, Sandboxes, synchronous execution, durable
operations, logs, binary-safe file operations, usage, typed errors, request
timeouts, cancellation, and asynchronous API-key providers.

API keys are secrets. Use this package from trusted server-side code and never
include a `bc_live_...` key in a browser bundle.
