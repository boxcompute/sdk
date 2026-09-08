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
