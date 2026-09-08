# BoxCompute SDKs

Official TypeScript and Python clients for the public BoxCompute API.

Both SDKs use API keys and the customer-facing `https://api.boxcompute.ai/api/v2`
contract. They never connect to BoxCompute's private sandbox control plane.

Hosted BoxCompute is currently invite-only. [Book a 15-minute call with
Farhan](https://cal.com/muhammad-farhan-helmy-bin-roslan-d7spi3/15min) to
request an invite, then create an API key in the
[BoxCompute app](https://app.boxcompute.ai/api-keys).

## TypeScript

```bash
npm install @boxcompute/sdk
```

```ts
import { BoxCompute } from "@boxcompute/sdk";

const boxcompute = new BoxCompute({ apiKey: process.env.BOXCOMPUTE_API_KEY! });
const [existingWorkspace] = await boxcompute.workspaces.list();
const workspace = existingWorkspace ?? await boxcompute.workspaces.create({
  name: "SDK quickstart",
  idempotencyKey: "sdk-quickstart-workspace-v1",
});
const sandbox = await boxcompute.sandboxes.create({ workspaceId: workspace.id });

try {
  const result = await boxcompute.sandboxes.execute(sandbox.id, {
    argv: ["python3", "-c", "print(sum(range(100000)))"],
  });
  console.log(result.stdout);
} finally {
  await boxcompute.sandboxes.delete(sandbox.id);
}
```

See the [TypeScript package guide](packages/typescript/README.md).

## Python

```bash
pip install boxcompute
```

```python
import os
from boxcompute import BoxCompute

with BoxCompute(api_key=os.environ["BOXCOMPUTE_API_KEY"]) as boxcompute:
    workspaces = boxcompute.workspaces.list()
    workspace = workspaces[0] if workspaces else boxcompute.workspaces.create(
        name="SDK quickstart",
        idempotency_key="sdk-quickstart-workspace-v1",
    )
    sandbox = boxcompute.sandboxes.create(workspace_id=workspace.id)
    try:
        result = boxcompute.sandboxes.execute(
            sandbox.id,
            argv=["python3", "-c", "print(sum(range(100000)))"],
        )
        print(result.stdout, end="")
    finally:
        boxcompute.sandboxes.delete(sandbox.id)
```

See the [Python package guide](packages/python/README.md).

See the [API overview](docs/api-reference.md) for the complete cross-language
surface, plus the guides for [authentication](docs/authentication.md) and
[idempotent retries](docs/idempotency.md).

## Contract and releases

`openapi/boxcompute-v2.json` is the versioned SDK contract. TypeScript types and
Python models are generated from this snapshot. CI rejects generated-code drift.

The npm and PyPI packages have independent versions and trusted-publishing
workflows. Releases are immutable and can only be published from `main` through
their protected GitHub environments.

Repository and registry administrators should follow the
[release setup](docs/releasing.md) before publishing the first versions.

## Development

```bash
npm ci
npm run generate
npm run check:openapi
npm run typecheck
npm test

python -m venv .venv
.venv/bin/pip install -e 'packages/python[test]'
.venv/bin/python scripts/generate-python-models.py
.venv/bin/ruff format --check packages/python/src packages/python/tests scripts/generate-python-models.py
.venv/bin/ruff check packages/python
.venv/bin/mypy packages/python/src
.venv/bin/pytest packages/python/tests
```

Set `BOXCOMPUTE_OPENAPI_SOURCE` to a local OpenAPI file when syncing from a
web-agent checkout; otherwise `npm run sync:openapi` downloads the deployed
contract.

## Security

Keep API keys in a secret manager or environment variable and use these SDKs
from trusted server-side code. Do not embed `bc_live_...` keys in browser or
mobile application bundles. See [SECURITY.md](SECURITY.md) for reporting.
