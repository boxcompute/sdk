import os
import uuid

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

    sandbox = boxcompute.sandboxes.create(
        workspace_id=workspace.id,
        idempotency_key=str(uuid.uuid4()),
    )
    try:
        result = boxcompute.sandboxes.execute(
            sandbox.id,
            argv=["python3", "-c", "print('hello from BoxCompute')"],
        )
        print(result.stdout, end="")
    finally:
        boxcompute.sandboxes.delete(sandbox.id)
