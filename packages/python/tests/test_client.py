from __future__ import annotations

import httpx
import pytest

from boxcompute import AsyncBoxCompute, BoxCompute, BoxComputeError, BoxComputeTransportError


def test_authenticates_and_unwraps_workspaces() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer bc_live_test"
        assert request.url.path == "/api/v2/workspaces"
        return httpx.Response(
            200,
            json={"workspaces": [{"id": "ws_1", "name": "Main", "createdAt": 1}]},
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key=lambda: "bc_live_test", http_client=http)
    assert boxcompute.workspaces.list()[0].id == "ws_1"


def test_sends_idempotency_key_outside_json() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["idempotency-key"] == "create-main"
        assert request.read() == b'{"name":"Main"}'
        return httpx.Response(
            201,
            json={"workspace": {"id": "ws_1", "name": "Main", "createdAt": 1}},
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    assert boxcompute.workspaces.create(name="Main", idempotency_key="create-main").id == "ws_1"


def test_creates_vm_sandboxes_and_accepts_pending_responses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["idempotency-key"] == "vm-create-1"
        assert (
            request.read()
            == b'{"workspaceId":"ws_1","vmSandbox":true,"blockNetwork":true,"size":"large"}'
        )
        return httpx.Response(
            202,
            json={
                "sandbox": {
                    "id": "sbx_vm",
                    "workspaceId": "ws_1",
                    "name": "vm-qual",
                    "createdAt": 1,
                    "lastUsedAt": 1,
                    "state": "pending",
                    "vmSandbox": True,
                }
            },
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    sandbox = boxcompute.sandboxes.create(
        workspace_id="ws_1",
        vm_sandbox=True,
        block_network=True,
        size="large",
        idempotency_key="vm-create-1",
    )
    assert sandbox.id == "sbx_vm"
    assert sandbox.state.value == "pending"
    assert sandbox.vm_sandbox is True


def test_omits_runtime_fields_when_caller_uses_server_default() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.read() == b'{"workspaceId":"ws_1"}'
        return httpx.Response(
            202,
            json={
                "sandbox": {
                    "id": "sbx_default",
                    "workspaceId": "ws_1",
                    "name": "defaulted",
                    "createdAt": 1,
                    "lastUsedAt": 1,
                    "state": "pending",
                    "vmSandbox": True,
                }
            },
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    sandbox = boxcompute.sandboxes.create(workspace_id="ws_1")
    assert sandbox.vm_sandbox is True


def test_sends_explicit_small_size_selector() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.read() == b'{"workspaceId":"ws_1","size":"small"}'
        return httpx.Response(
            202,
            json={
                "sandbox": {
                    "id": "sbx_small",
                    "workspaceId": "ws_1",
                    "name": "small",
                    "createdAt": 1,
                    "lastUsedAt": 1,
                    "state": "pending",
                    "vmSandbox": True,
                }
            },
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    sandbox = boxcompute.sandboxes.create(workspace_id="ws_1", size="small")
    assert sandbox.id == "sbx_small"


def test_maps_api_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            headers={"x-request-id": "req_1"},
            json={"code": "INSUFFICIENT_SCOPE", "error": "Missing sandbox:read"},
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    with pytest.raises(BoxComputeError) as raised:
        boxcompute.sandboxes.list()
    assert raised.value.status == 403
    assert raised.value.code == "INSUFFICIENT_SCOPE"
    assert raised.value.request_id == "req_1"
    assert not raised.value.retryable


def test_returns_binary_file_metadata() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["path"] == "/workspace/data.bin"
        return httpx.Response(
            200,
            content=b"\x00\xff\x80",
            headers={
                "x-boxcompute-offset": "5",
                "x-boxcompute-next-offset": "8",
                "x-boxcompute-file-size": "10",
                "x-boxcompute-eof": "false",
                "x-boxcompute-next-cursor": "cursor_1",
            },
        )

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    result = BoxCompute(api_key="bc_live_test", http_client=http).files.read(
        "sbx_1", "/workspace/data.bin", offset=5
    )
    assert result.data == b"\x00\xff\x80"
    assert (result.offset, result.next_offset, result.file_size) == (5, 8, 10)
    assert not result.eof
    assert result.next_cursor == "cursor_1"


def test_encodes_resource_identifiers_and_paths() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v2/sandboxes/sbx/one/files/list"
        assert request.url.raw_path.startswith(b"/api/v2/sandboxes/sbx%2Fone/files/list")
        assert request.url.params["path"] == "/workspace/a b"
        return httpx.Response(200, json={"entries": [], "nextCursor": None})

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    result = boxcompute.files.list("sbx/one", "/workspace/a b")
    assert result.entries == []


def test_maps_transport_errors_without_retrying() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("network down")

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)
    with pytest.raises(BoxComputeTransportError):
        boxcompute.sandboxes.list()
    assert calls == 1


@pytest.mark.asyncio
async def test_async_client_supports_async_key_providers() -> None:
    async def api_key() -> str:
        return "bc_live_async"

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer bc_live_async"
        return httpx.Response(200, json={"sandboxes": []})

    http = httpx.AsyncClient(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = AsyncBoxCompute(api_key=api_key, http_client=http)
    assert await boxcompute.sandboxes.list() == []
    await http.aclose()


# Minimal contract-valid payloads for the account, cost, and preview routes.
ME = {
    "account": {"id": "x", "email": "x", "name": "x"},
    "apiKey": {"id": "x", "name": "x", "scopes": ["x"], "createdAt": 1, "lastUsedAt": 1},
}
AUDIT_PAGE = {
    "events": [
        {
            "id": "x",
            "type": "api.request",
            "createdAt": 1,
            "requestId": "x",
            "actor": {
                "type": "api_key",
                "apiKey": {"id": "x", "name": "x", "hint": "x"},
                "ipAddress": "x",
                "userAgent": "x",
            },
            "request": {"method": "x", "route": "x", "path": "x", "status": 1, "durationMs": 1},
            "resourceId": "x",
        }
    ],
    "nextCursor": "x",
}
DELETED_SANDBOX = {
    "id": "x",
    "sandboxId": "x",
    "name": "x",
    "workspaceId": "x",
    "workspaceName": "x",
    "vmSandbox": False,
    "size": "x",
    "runtimes": ["x"],
    "deletedVia": "console",
    "deletedByApiKeyId": "x",
    "createdAt": 1,
    "lastUsedAt": 1,
    "deletedAt": 1,
}
PREVIEW = {
    "previewId": "00000000000000000000000000000000",
    "sandboxId": "sbx_1",
    "port": 3000,
    "url": "https://p.bxcpreview.com",
    "expiresAt": "2026-10-07T13:00:00.000Z",
}
ANALYTICS = {
    "sandboxId": "x",
    "from": 1,
    "to": 1,
    "resolutionSeconds": 60,
    "retentionSeconds": 1,
    "generationsTruncated": False,
    "selectedGeneration": 1,
    "operationsTruncated": False,
    "generations": [
        {
            "generation": 1,
            "runtimeClass": "container",
            "startedAt": 1,
            "readyAt": 1,
            "stoppedAt": 1,
            "finalizedAt": 1,
            "startupDurationMs": 1,
            "runtimeDurationMs": 1,
        }
    ],
    "operations": [
        {
            "bucketStart": 1,
            "generation": 1,
            "operations": 1,
            "executions": 1,
            "durationMs": 1,
            "executionDurationMs": 1,
            "outputBytes": 1,
            "failures": 1,
        }
    ],
    "resources": {
        "status": "available",
        "coverage": "available",
        "retentionStart": 1,
        "series": [
            {
                "generation": 1,
                "metric": "cpu_usage_cores",
                "unit": "cores",
                "availability": "available",
                "points": [[1, 1]],
            }
        ],
    },
}
COST_REPORT = {
    "from": 1,
    "to": 1,
    "currency": "usd",
    "estimates": "available",
    "totals": {"runs": 1, "billableSeconds": 1, "settledMicros": 1, "estimatedMicros": 1},
    "apiKeys": [
        {
            "runs": 1,
            "billableSeconds": 1,
            "settledMicros": 1,
            "estimatedMicros": 1,
            "apiKey": {"id": "x", "name": "x", "hint": "x", "revoked": False},
            "sandboxes": 1,
        }
    ],
    "sandboxes": [
        {
            "runs": 1,
            "billableSeconds": 1,
            "settledMicros": 1,
            "estimatedMicros": 1,
            "id": "x",
            "sandboxId": "x",
            "name": "x",
            "deleted": False,
            "vmSandbox": False,
            "size": "x",
            "createdByApiKeyId": "x",
            "createdAt": 1,
            "deletedAt": 1,
            "firstStartedAt": 1,
            "lastEndedAt": 1,
        }
    ],
    "unattributed": {"runs": 1, "billableSeconds": 1, "settledMicros": 1, "estimatedMicros": 1},
}
COST_DETAIL = {
    "sandbox": {
        "runs": 1,
        "billableSeconds": 1,
        "settledMicros": 1,
        "estimatedMicros": 1,
        "id": "x",
        "sandboxId": "x",
        "name": "x",
        "deleted": False,
        "vmSandbox": False,
        "size": "x",
        "createdByApiKeyId": "x",
        "createdAt": 1,
        "deletedAt": 1,
        "firstStartedAt": 1,
        "lastEndedAt": 1,
    },
    "createdByApiKey": {"id": "x", "name": "x", "hint": "x", "revoked": False},
    "currency": "usd",
    "estimates": "available",
    "runs": [
        {
            "startedAt": 1,
            "endedAt": 1,
            "runtimeSeconds": 1,
            "billableSeconds": 1,
            "rateMicrosPerMinute": 1,
            "amountMicros": 1,
        }
    ],
    "running": [{"startedAt": 1, "billableSeconds": 1, "estimatedMicros": 1}],
    "truncated": False,
}
LOGS = {"sandboxId": "sbx_1", "entries": [], "truncated": False, "retention_seconds": 86400}


def _routes(request: httpx.Request) -> httpx.Response:
    routes = {
        ("GET", "/api/v2/me"): ME,
        ("GET", "/api/v2/audit-events"): AUDIT_PAGE,
        ("GET", "/api/v2/costs/sandboxes"): {"costs": COST_REPORT},
        ("GET", "/api/v2/sandboxes/sbx%2F1/costs"): {"costs": COST_DETAIL},
        ("GET", "/api/v2/sandboxes/sbx_1/analytics"): {"analytics": ANALYTICS},
        ("GET", "/api/v2/deleted-sandboxes"): {"deletedSandboxes": [DELETED_SANDBOX]},
        ("GET", "/api/v2/deleted-sandboxes/dsb_1/logs"): {"logs": LOGS},
        ("GET", "/api/v2/deleted-sandboxes/dsb_1/costs"): {"costs": COST_DETAIL},
        ("POST", "/api/v2/sandboxes/sbx_1/previews"): {"preview": PREVIEW},
    }
    key = (request.method, request.url.raw_path.decode().split("?")[0])
    if key == ("DELETE", f"/api/v2/sandboxes/sbx_1/previews/{PREVIEW['previewId']}"):
        return httpx.Response(204)
    return httpx.Response(201 if request.method == "POST" else 200, json=routes[key])


def test_reads_identity_audit_cost_and_analytics_routes() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _routes(request)

    http = httpx.Client(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    boxcompute = BoxCompute(api_key="bc_live_test", http_client=http)

    assert boxcompute.me.get().account.id == ME["account"]["id"]
    page = boxcompute.audit_events.list(type="api.request", outcome="error", before="c/1", limit=20)
    assert page.next_cursor == AUDIT_PAGE["nextCursor"]
    assert boxcompute.costs.sandboxes(api_key_id="none", from_="2026-10-01T00:00:00Z").currency
    assert boxcompute.sandboxes.costs("sbx/1").truncated is False
    assert boxcompute.sandboxes.analytics("sbx_1", resolution_seconds=60, generation=2).sandbox_id

    assert [dict(request.url.params) for request in seen] == [
        {},
        {"type": "api.request", "outcome": "error", "before": "c/1", "limit": "20"},
        {"from": "2026-10-01T00:00:00Z", "apiKeyId": "none"},
        {},
        {"resolutionSeconds": "60", "generation": "2"},
    ]


@pytest.mark.asyncio
async def test_async_deleted_sandboxes_and_previews() -> None:
    bodies: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(request.read())
        return _routes(request)

    http = httpx.AsyncClient(
        base_url="https://api.boxcompute.ai", transport=httpx.MockTransport(handler)
    )
    async with AsyncBoxCompute(api_key="bc_live_test", http_client=http) as boxcompute:
        deleted = await boxcompute.deleted_sandboxes.list()
        assert deleted[0].sandbox_id == DELETED_SANDBOX["sandboxId"]
        logs = await boxcompute.deleted_sandboxes.logs("dsb_1", runtime="rt_1", stream="stderr")
        assert logs.sandbox_id == "sbx_1"
        assert (await boxcompute.deleted_sandboxes.costs("dsb_1")).currency
        preview = await boxcompute.previews.create("sbx_1", port=3000)
        assert preview.port == 3000
        assert await boxcompute.previews.close("sbx_1", preview.preview_id) is None

    assert bodies[3] == b'{"port":3000}'
