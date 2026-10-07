# API overview

Both SDKs expose the same public `/api/v2` capabilities through resource
groups. Python offers synchronous `BoxCompute` and asynchronous
`AsyncBoxCompute` clients.

| Resource | TypeScript | Python | Purpose |
| --- | --- | --- | --- |
| Authentication | `auth.revoke()` | `auth.revoke()` | Revoke the current API key |
| Identity | `me.get()` | `me.get()` | Show the account and API key a credential authenticates |
| Workspaces | `workspaces.list()` | `workspaces.list()` | List persistent workspaces |
| Workspaces | `workspaces.create()` | `workspaces.create()` | Create a workspace idempotently |
| Sandboxes | `sandboxes.list()` | `sandboxes.list()` | List Sandbox instances |
| Sandboxes | `sandboxes.create()` | `sandboxes.create()` | Create and start a Sandbox |
| Sandboxes | `sandboxes.inspect()` | `sandboxes.inspect()` | Read current Sandbox state |
| Sandboxes | `sandboxes.execute()` | `sandboxes.execute()` | Execute and wait for a command |
| Sandboxes | `sandboxes.logs()` | `sandboxes.logs()` | Read retained Sandbox logs |
| Sandboxes | `sandboxes.delete()` | `sandboxes.delete()` | Delete a Sandbox |
| Sandboxes | `sandboxes.analytics()` | `sandboxes.analytics()` | Read lifecycle, operation, and resource analytics |
| Sandboxes | `sandboxes.costs()` | `sandboxes.costs()` | List every charged run with a running estimate |
| Previews | `previews.create()` | `previews.create()` | Open a one-hour HTTP/WebSocket preview of a VM port |
| Previews | `previews.close()` | `previews.close()` | Close a preview before it expires |
| Deleted Sandboxes | `deletedSandboxes.list()` | `deleted_sandboxes.list()` | List deleted Sandboxes, newest first |
| Deleted Sandboxes | `deletedSandboxes.logs()` | `deleted_sandboxes.logs()` | Read a deleted Sandbox's retained logs |
| Deleted Sandboxes | `deletedSandboxes.costs()` | `deleted_sandboxes.costs()` | List a deleted Sandbox's charged runs |
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
| Costs | `costs.sandboxes()` | `costs.sandboxes()` | Compute cost per API key and per Sandbox |
| Audit log | `auditEvents.list()` | `audit_events.list()` | Page the account's API audit log, newest first |

Python spells the `from` query parameter as `from_`. Audit pages return
`nextCursor`; pass it as `before` to read the next page.

All file paths must be `/workspace` or a descendant. Identifiers are URL
encoded by the SDKs. Mutation retries must follow the rules in
[idempotency.md](idempotency.md).

## VM sandbox sizing

`sandboxes.create()` accepts VM-only runtime options. `vmSandbox` defaults to
`true` (VM runtime); `false` selects a gVisor container sandbox. `blockNetwork`
defaults to `false` (Internet) and `true` selects a sandbox without a NIC.

`size` selects the VM compute tier and defaults to `"small"`:

| `size` | vCPU | Memory | Workspace |
| --- | --- | --- | --- |
| `"small"` | 0.5 | 1024 MiB | 30 GiB |
| `"large"` | 1.5 | 3072 MiB | 30 GiB |

Both profiles use a 30 GiB thin-provisioned workspace. `size` is VM-only; gVisor
sandboxes ignore `"small"` and reject `"large"` with `INVALID_ARGUMENT`. Omit it
(or pass `"small"`) to use the default. `Sandbox.size` reports the immutable
profile; it is absent for historical replays, which are small.

```ts
await boxcompute.sandboxes.create({ workspaceId, size: "large", idempotencyKey });
```

```python
boxcompute.sandboxes.create(workspace_id=workspace_id, size="large", idempotency_key=key)
```
