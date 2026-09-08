# API overview

Both SDKs expose the same public `/api/v2` capabilities through resource
groups. Python offers synchronous `BoxCompute` and asynchronous
`AsyncBoxCompute` clients.

| Resource | TypeScript | Python | Purpose |
| --- | --- | --- | --- |
| Authentication | `auth.revoke()` | `auth.revoke()` | Revoke the current API key |
| Workspaces | `workspaces.list()` | `workspaces.list()` | List persistent workspaces |
| Workspaces | `workspaces.create()` | `workspaces.create()` | Create a workspace idempotently |
| Sandboxes | `sandboxes.list()` | `sandboxes.list()` | List Sandbox instances |
| Sandboxes | `sandboxes.create()` | `sandboxes.create()` | Create and start a Sandbox |
| Sandboxes | `sandboxes.inspect()` | `sandboxes.inspect()` | Read current Sandbox state |
| Sandboxes | `sandboxes.execute()` | `sandboxes.execute()` | Execute and wait for a command |
| Sandboxes | `sandboxes.logs()` | `sandboxes.logs()` | Read retained Sandbox logs |
| Sandboxes | `sandboxes.delete()` | `sandboxes.delete()` | Delete a Sandbox |
| Operations | `operations.start()` | `operations.start()` | Start an observable command |
| Operations | `operations.inspect()` | `operations.inspect()` | Read operation state |
| Operations | `operations.output()` | `operations.output()` | Page stdout or stderr |
| Operations | `operations.wait()` | `operations.wait()` | Long-poll operation state |
| Operations | `operations.cancel()` | `operations.cancel()` | Request cancellation |
| Files | `files.stat()` | `files.stat()` | Inspect a workspace path |
| Files | `files.read()` | `files.read()` | Read binary bytes with paging metadata |
| Files | `files.write()` | `files.write()` | Write binary bytes |
| Files | `files.edit()` | `files.edit()` | Conditionally edit UTF-8 text |
| Files | `files.list()` | `files.list()` | Page a directory listing |
| Files | `files.mkdir()` | `files.mkdir()` | Create a directory |
| Files | `files.rename()` | `files.rename()` | Atomically rename a path |
| Files | `files.remove()` | `files.remove()` | Remove a path |
| Usage | `usage.get()` | `usage.get()` | Read account usage |

All file paths must be `/workspace` or a descendant. Identifiers are URL
encoded by the SDKs. Mutation retries must follow the rules in
[idempotency.md](idempotency.md).
