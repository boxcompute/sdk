# `boxcompute`

Official Python SDK for the BoxCompute public API, with synchronous and
asynchronous clients.

```bash
pip install boxcompute
```

## Synchronous client

```python
import os
from boxcompute import BoxCompute

with BoxCompute(api_key=os.environ["BOXCOMPUTE_API_KEY"]) as boxcompute:
    workspaces = boxcompute.workspaces.list()
    workspace = (
        workspaces[0]
        if workspaces
        else boxcompute.workspaces.create(
            name="SDK quickstart",
            idempotency_key="sdk-quickstart-workspace-v1",
        )
    )
    sandbox = boxcompute.sandboxes.create(workspace_id=workspace.id)
    try:
        result = boxcompute.sandboxes.execute(
            sandbox.id,
            argv=["python3", "-c", "print('hello')"],
        )
        print(result.stdout, end="")
    finally:
        boxcompute.sandboxes.delete(sandbox.id)
```

## Asynchronous client

```python
import os
from boxcompute import AsyncBoxCompute

async with AsyncBoxCompute(api_key=os.environ["BOXCOMPUTE_API_KEY"]) as boxcompute:
    workspaces = await boxcompute.workspaces.list()
```

The SDK includes workspaces, Sandboxes, synchronous execution, durable
operations, logs, binary-safe file operations, usage, typed Pydantic models,
structured errors, configurable timeouts, and injectable `httpx` clients.

API keys are secrets. Use this package from trusted server-side code and never
include a `bc_live_...` key in a browser or mobile application.
