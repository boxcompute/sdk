import { BoxCompute } from "@boxcompute/sdk";

const apiKey = process.env.BOXCOMPUTE_API_KEY;
if (!apiKey) throw new Error("BOXCOMPUTE_API_KEY is required");

const boxcompute = new BoxCompute({ apiKey });
const [existingWorkspace] = await boxcompute.workspaces.list();
const workspace = existingWorkspace ?? await boxcompute.workspaces.create({
  name: "SDK quickstart",
  idempotencyKey: "sdk-quickstart-workspace-v1",
});

const sandbox = await boxcompute.sandboxes.create({
  workspaceId: workspace.id,
  idempotencyKey: crypto.randomUUID(),
});
try {
  const result = await boxcompute.sandboxes.execute(sandbox.id, {
    argv: ["python3", "-c", "print('hello from BoxCompute')"],
  });
  process.stdout.write(result.stdout);
} finally {
  await boxcompute.sandboxes.delete(sandbox.id);
}
