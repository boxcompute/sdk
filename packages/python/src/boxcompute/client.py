from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import quote

import httpx

from ._generated.models import (
    EditFileResponse,
    ExecutionResult,
    FileList,
    FileStat,
    Operation,
    OperationOutputChunk,
    Sandbox,
    SandboxLogs,
    Usage,
    Workspace,
)
from .errors import BoxComputeTransportError, response_error

DEFAULT_BASE_URL = "https://api.boxcompute.ai"
DEFAULT_TIMEOUT = 180.0
ApiKey = str | Callable[[], str]
AsyncApiKey = str | Callable[[], str | Awaitable[str]]


@dataclass(frozen=True)
class FileRead:
    data: bytes
    offset: int
    next_offset: int
    file_size: int
    eof: bool
    next_cursor: str | None = None


def _headers(api_key: str, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    if not api_key.strip():
        raise ValueError("BoxCompute api_key must not be empty")
    headers = {"authorization": f"Bearer {api_key}", "accept": "application/json"}
    if extra:
        headers.update(extra)
    return headers


def _sandbox_path(sandbox_id: str, suffix: str = "") -> str:
    return f"/api/v2/sandboxes/{quote(sandbox_id, safe='')}{suffix}"


def _operation_path(sandbox_id: str, operation_id: str, suffix: str = "") -> str:
    return f"{_sandbox_path(sandbox_id, '/operations')}/{quote(operation_id, safe='')}{suffix}"


def _file_read(response: httpx.Response, requested_offset: int) -> FileRead:
    def integer_header(name: str, fallback: int) -> int:
        try:
            value = int(response.headers[name])
        except (KeyError, ValueError):
            return fallback
        return value if value >= 0 else fallback

    offset = integer_header("x-boxcompute-offset", requested_offset)
    next_offset = integer_header("x-boxcompute-next-offset", offset + len(response.content))
    return FileRead(
        data=response.content,
        offset=offset,
        next_offset=next_offset,
        file_size=integer_header("x-boxcompute-file-size", next_offset),
        eof=response.headers.get("x-boxcompute-eof") == "true",
        next_cursor=response.headers.get("x-boxcompute-next-cursor"),
    )


class _SyncTransport:
    def __init__(
        self,
        api_key: ApiKey,
        *,
        base_url: str,
        timeout: float,
        http_client: httpx.Client | None,
    ) -> None:
        self._api_key = api_key
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        key = self._api_key() if callable(self._api_key) else self._api_key
        headers = _headers(key, kwargs.pop("headers", None))
        try:
            response = self._client.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise BoxComputeTransportError("BoxCompute request failed") from error
        if not response.is_success:
            raise response_error(response)
        return response

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


class _AsyncTransport:
    def __init__(
        self,
        api_key: AsyncApiKey,
        *,
        base_url: str,
        timeout: float,
        http_client: httpx.AsyncClient | None,
    ) -> None:
        self._api_key = api_key
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"), timeout=timeout
        )

    async def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        key_or_awaitable = self._api_key() if callable(self._api_key) else self._api_key
        key = await key_or_awaitable if inspect.isawaitable(key_or_awaitable) else key_or_awaitable
        headers = _headers(key, kwargs.pop("headers", None))
        try:
            response = await self._client.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise BoxComputeTransportError("BoxCompute request failed") from error
        if not response.is_success:
            raise response_error(response)
        return response

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class Workspaces:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def list(self) -> list[Workspace]:
        data = self._transport.request("GET", "/api/v2/workspaces").json()
        return [Workspace.model_validate(value) for value in data["workspaces"]]

    def create(self, *, name: str, idempotency_key: str) -> Workspace:
        data = self._transport.request(
            "POST",
            "/api/v2/workspaces",
            headers={"idempotency-key": idempotency_key},
            json={"name": name},
        ).json()
        return Workspace.model_validate(data["workspace"])


class AsyncWorkspaces:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def list(self) -> list[Workspace]:
        data = (await self._transport.request("GET", "/api/v2/workspaces")).json()
        return [Workspace.model_validate(value) for value in data["workspaces"]]

    async def create(self, *, name: str, idempotency_key: str) -> Workspace:
        data = (
            await self._transport.request(
                "POST",
                "/api/v2/workspaces",
                headers={"idempotency-key": idempotency_key},
                json={"name": name},
            )
        ).json()
        return Workspace.model_validate(data["workspace"])


class Sandboxes:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def list(self) -> list[Sandbox]:
        data = self._transport.request("GET", "/api/v2/sandboxes").json()
        return [Sandbox.model_validate(value) for value in data["sandboxes"]]

    def create(
        self,
        *,
        workspace_id: str,
        name: str | None = None,
        idempotency_key: str | None = None,
    ) -> Sandbox:
        body = {"workspaceId": workspace_id, **({"name": name} if name is not None else {})}
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        data = self._transport.request(
            "POST", "/api/v2/sandboxes", headers=headers, json=body
        ).json()
        return Sandbox.model_validate(data["sandbox"])

    def inspect(self, sandbox_id: str) -> Sandbox:
        data = self._transport.request("GET", _sandbox_path(sandbox_id)).json()
        return Sandbox.model_validate(data["sandbox"])

    def delete(self, sandbox_id: str) -> None:
        self._transport.request("DELETE", _sandbox_path(sandbox_id))

    def execute(
        self,
        sandbox_id: str,
        *,
        argv: Sequence[str],
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int | None = None,
        max_output_bytes: int | None = None,
    ) -> ExecutionResult:
        body: dict[str, Any] = {"argv": list(argv)}
        if cwd is not None:
            body["cwd"] = cwd
        if env is not None:
            body["env"] = dict(env)
        if timeout_seconds is not None:
            body["timeoutSeconds"] = timeout_seconds
        if max_output_bytes is not None:
            body["maxOutputBytes"] = max_output_bytes
        data = self._transport.request(
            "POST", _sandbox_path(sandbox_id, "/execute"), json=body
        ).json()
        return ExecutionResult.model_validate(data["result"])

    def logs(
        self,
        sandbox_id: str,
        *,
        since: str | None = None,
        until: str | None = None,
        stream: Literal["stdout", "stderr"] | None = None,
        source: Literal["workload", "execute", "process"] | None = None,
        limit: int | None = None,
    ) -> SandboxLogs:
        params = {
            key: value
            for key, value in {
                "since": since,
                "until": until,
                "stream": stream,
                "source": source,
                "limit": limit,
            }.items()
            if value is not None
        }
        data = self._transport.request(
            "GET", _sandbox_path(sandbox_id, "/logs"), params=params
        ).json()
        return SandboxLogs.model_validate(data["logs"])


class AsyncSandboxes:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def list(self) -> list[Sandbox]:
        data = (await self._transport.request("GET", "/api/v2/sandboxes")).json()
        return [Sandbox.model_validate(value) for value in data["sandboxes"]]

    async def create(
        self,
        *,
        workspace_id: str,
        name: str | None = None,
        idempotency_key: str | None = None,
    ) -> Sandbox:
        body = {"workspaceId": workspace_id, **({"name": name} if name is not None else {})}
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        data = (
            await self._transport.request("POST", "/api/v2/sandboxes", headers=headers, json=body)
        ).json()
        return Sandbox.model_validate(data["sandbox"])

    async def inspect(self, sandbox_id: str) -> Sandbox:
        data = (await self._transport.request("GET", _sandbox_path(sandbox_id))).json()
        return Sandbox.model_validate(data["sandbox"])

    async def delete(self, sandbox_id: str) -> None:
        await self._transport.request("DELETE", _sandbox_path(sandbox_id))

    async def execute(
        self,
        sandbox_id: str,
        *,
        argv: Sequence[str],
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int | None = None,
        max_output_bytes: int | None = None,
    ) -> ExecutionResult:
        body: dict[str, Any] = {"argv": list(argv)}
        if cwd is not None:
            body["cwd"] = cwd
        if env is not None:
            body["env"] = dict(env)
        if timeout_seconds is not None:
            body["timeoutSeconds"] = timeout_seconds
        if max_output_bytes is not None:
            body["maxOutputBytes"] = max_output_bytes
        data = (
            await self._transport.request("POST", _sandbox_path(sandbox_id, "/execute"), json=body)
        ).json()
        return ExecutionResult.model_validate(data["result"])

    async def logs(
        self,
        sandbox_id: str,
        *,
        since: str | None = None,
        until: str | None = None,
        stream: Literal["stdout", "stderr"] | None = None,
        source: Literal["workload", "execute", "process"] | None = None,
        limit: int | None = None,
    ) -> SandboxLogs:
        params = {
            key: value
            for key, value in {
                "since": since,
                "until": until,
                "stream": stream,
                "source": source,
                "limit": limit,
            }.items()
            if value is not None
        }
        data = (
            await self._transport.request("GET", _sandbox_path(sandbox_id, "/logs"), params=params)
        ).json()
        return SandboxLogs.model_validate(data["logs"])


class Operations:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def start(
        self,
        sandbox_id: str,
        *,
        argv: Sequence[str],
        idempotency_key: str,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int | None = None,
        max_output_bytes: int | None = None,
    ) -> Operation:
        body: dict[str, Any] = {"argv": list(argv)}
        for key, value in {
            "cwd": cwd,
            "env": dict(env) if env is not None else None,
            "timeoutSeconds": timeout_seconds,
            "maxOutputBytes": max_output_bytes,
        }.items():
            if value is not None:
                body[key] = value
        data = self._transport.request(
            "POST",
            _sandbox_path(sandbox_id, "/operations"),
            headers={"idempotency-key": idempotency_key},
            json=body,
        ).json()
        return Operation.model_validate(data["operation"])

    def inspect(self, sandbox_id: str, operation_id: str) -> Operation:
        data = self._transport.request("GET", _operation_path(sandbox_id, operation_id)).json()
        return Operation.model_validate(data["operation"])

    def output(
        self,
        sandbox_id: str,
        operation_id: str,
        *,
        stream: Literal["stdout", "stderr"],
        offset: int,
        limit: int | None = None,
    ) -> OperationOutputChunk:
        params = {"stream": stream, "offset": offset}
        if limit is not None:
            params["limit"] = limit
        data = self._transport.request(
            "GET",
            _operation_path(sandbox_id, operation_id, "/output"),
            params=params,
        ).json()
        return OperationOutputChunk.model_validate(data)

    def wait(self, sandbox_id: str, operation_id: str, *, timeout_seconds: int = 30) -> Operation:
        data = self._transport.request(
            "POST",
            _operation_path(sandbox_id, operation_id, "/wait"),
            json={"timeoutSeconds": timeout_seconds},
        ).json()
        return Operation.model_validate(data["operation"])

    def cancel(self, sandbox_id: str, operation_id: str) -> Operation:
        data = self._transport.request(
            "POST", _operation_path(sandbox_id, operation_id, "/cancel")
        ).json()
        return Operation.model_validate(data["operation"])


class AsyncOperations:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def start(
        self,
        sandbox_id: str,
        *,
        argv: Sequence[str],
        idempotency_key: str,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout_seconds: int | None = None,
        max_output_bytes: int | None = None,
    ) -> Operation:
        body: dict[str, Any] = {"argv": list(argv)}
        for key, value in {
            "cwd": cwd,
            "env": dict(env) if env is not None else None,
            "timeoutSeconds": timeout_seconds,
            "maxOutputBytes": max_output_bytes,
        }.items():
            if value is not None:
                body[key] = value
        data = (
            await self._transport.request(
                "POST",
                _sandbox_path(sandbox_id, "/operations"),
                headers={"idempotency-key": idempotency_key},
                json=body,
            )
        ).json()
        return Operation.model_validate(data["operation"])

    async def inspect(self, sandbox_id: str, operation_id: str) -> Operation:
        data = (
            await self._transport.request("GET", _operation_path(sandbox_id, operation_id))
        ).json()
        return Operation.model_validate(data["operation"])

    async def output(
        self,
        sandbox_id: str,
        operation_id: str,
        *,
        stream: Literal["stdout", "stderr"],
        offset: int,
        limit: int | None = None,
    ) -> OperationOutputChunk:
        params = {"stream": stream, "offset": offset}
        if limit is not None:
            params["limit"] = limit
        data = (
            await self._transport.request(
                "GET",
                _operation_path(sandbox_id, operation_id, "/output"),
                params=params,
            )
        ).json()
        return OperationOutputChunk.model_validate(data)

    async def wait(
        self, sandbox_id: str, operation_id: str, *, timeout_seconds: int = 30
    ) -> Operation:
        data = (
            await self._transport.request(
                "POST",
                _operation_path(sandbox_id, operation_id, "/wait"),
                json={"timeoutSeconds": timeout_seconds},
            )
        ).json()
        return Operation.model_validate(data["operation"])

    async def cancel(self, sandbox_id: str, operation_id: str) -> Operation:
        data = (
            await self._transport.request(
                "POST", _operation_path(sandbox_id, operation_id, "/cancel")
            )
        ).json()
        return Operation.model_validate(data["operation"])


class Files:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def stat(self, sandbox_id: str, path: str) -> FileStat:
        data = self._transport.request(
            "GET", _sandbox_path(sandbox_id, "/files/stat"), params={"path": path}
        ).json()
        return FileStat.model_validate(data["file"])

    def read(
        self,
        sandbox_id: str,
        path: str,
        *,
        offset: int = 0,
        max_bytes: int | None = None,
        cursor: str | None = None,
    ) -> FileRead:
        params: dict[str, Any] = {"path": path, "offset": offset}
        if max_bytes is not None:
            params["maxBytes"] = max_bytes
        if cursor is not None:
            params["cursor"] = cursor
        response = self._transport.request(
            "GET", _sandbox_path(sandbox_id, "/files/content"), params=params
        )
        return _file_read(response, offset)

    def write(self, sandbox_id: str, path: str, data: bytes) -> None:
        self._transport.request(
            "PUT",
            _sandbox_path(sandbox_id, "/files/content"),
            params={"path": path},
            headers={"content-type": "application/octet-stream"},
            content=data,
        )

    def edit(
        self,
        sandbox_id: str,
        path: str,
        *,
        expected_sha256: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> EditFileResponse:
        data = self._transport.request(
            "PATCH",
            _sandbox_path(sandbox_id, "/files/content"),
            params={"path": path},
            json={
                "expectedSha256": expected_sha256,
                "oldText": old_text,
                "newText": new_text,
                "replaceAll": replace_all,
            },
        ).json()
        return EditFileResponse.model_validate(data)

    def list(
        self,
        sandbox_id: str,
        path: str,
        *,
        page_size: int | None = None,
        cursor: str | None = None,
    ) -> FileList:
        params: dict[str, Any] = {"path": path}
        if page_size is not None:
            params["pageSize"] = page_size
        if cursor is not None:
            params["cursor"] = cursor
        data = self._transport.request(
            "GET", _sandbox_path(sandbox_id, "/files/list"), params=params
        ).json()
        return FileList.model_validate(data)

    def mkdir(self, sandbox_id: str, path: str, *, recursive: bool = False) -> None:
        self._transport.request(
            "POST",
            _sandbox_path(sandbox_id, "/files/directory"),
            params={"path": path},
            json={"recursive": recursive},
        )

    def rename(
        self,
        sandbox_id: str,
        path: str,
        *,
        destination: str,
        overwrite: bool = False,
    ) -> None:
        self._transport.request(
            "POST",
            _sandbox_path(sandbox_id, "/files/rename"),
            params={"path": path},
            json={"destination": destination, "overwrite": overwrite},
        )

    def remove(
        self,
        sandbox_id: str,
        path: str,
        *,
        recursive: bool = False,
        force: bool = False,
    ) -> None:
        self._transport.request(
            "DELETE",
            _sandbox_path(sandbox_id, "/files"),
            params={"path": path, "recursive": str(recursive).lower(), "force": str(force).lower()},
        )


class AsyncFiles:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def stat(self, sandbox_id: str, path: str) -> FileStat:
        data = (
            await self._transport.request(
                "GET", _sandbox_path(sandbox_id, "/files/stat"), params={"path": path}
            )
        ).json()
        return FileStat.model_validate(data["file"])

    async def read(
        self,
        sandbox_id: str,
        path: str,
        *,
        offset: int = 0,
        max_bytes: int | None = None,
        cursor: str | None = None,
    ) -> FileRead:
        params: dict[str, Any] = {"path": path, "offset": offset}
        if max_bytes is not None:
            params["maxBytes"] = max_bytes
        if cursor is not None:
            params["cursor"] = cursor
        response = await self._transport.request(
            "GET", _sandbox_path(sandbox_id, "/files/content"), params=params
        )
        return _file_read(response, offset)

    async def write(self, sandbox_id: str, path: str, data: bytes) -> None:
        await self._transport.request(
            "PUT",
            _sandbox_path(sandbox_id, "/files/content"),
            params={"path": path},
            headers={"content-type": "application/octet-stream"},
            content=data,
        )

    async def edit(
        self,
        sandbox_id: str,
        path: str,
        *,
        expected_sha256: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> EditFileResponse:
        data = (
            await self._transport.request(
                "PATCH",
                _sandbox_path(sandbox_id, "/files/content"),
                params={"path": path},
                json={
                    "expectedSha256": expected_sha256,
                    "oldText": old_text,
                    "newText": new_text,
                    "replaceAll": replace_all,
                },
            )
        ).json()
        return EditFileResponse.model_validate(data)

    async def list(
        self,
        sandbox_id: str,
        path: str,
        *,
        page_size: int | None = None,
        cursor: str | None = None,
    ) -> FileList:
        params: dict[str, Any] = {"path": path}
        if page_size is not None:
            params["pageSize"] = page_size
        if cursor is not None:
            params["cursor"] = cursor
        data = (
            await self._transport.request(
                "GET", _sandbox_path(sandbox_id, "/files/list"), params=params
            )
        ).json()
        return FileList.model_validate(data)

    async def mkdir(self, sandbox_id: str, path: str, *, recursive: bool = False) -> None:
        await self._transport.request(
            "POST",
            _sandbox_path(sandbox_id, "/files/directory"),
            params={"path": path},
            json={"recursive": recursive},
        )

    async def rename(
        self,
        sandbox_id: str,
        path: str,
        *,
        destination: str,
        overwrite: bool = False,
    ) -> None:
        await self._transport.request(
            "POST",
            _sandbox_path(sandbox_id, "/files/rename"),
            params={"path": path},
            json={"destination": destination, "overwrite": overwrite},
        )

    async def remove(
        self,
        sandbox_id: str,
        path: str,
        *,
        recursive: bool = False,
        force: bool = False,
    ) -> None:
        await self._transport.request(
            "DELETE",
            _sandbox_path(sandbox_id, "/files"),
            params={"path": path, "recursive": str(recursive).lower(), "force": str(force).lower()},
        )


class UsageResource:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def get(self, *, days: int = 30) -> Usage:
        data = self._transport.request("GET", "/api/v2/usage", params={"days": days}).json()
        return Usage.model_validate(data["usage"])


class AsyncUsageResource:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def get(self, *, days: int = 30) -> Usage:
        data = (await self._transport.request("GET", "/api/v2/usage", params={"days": days})).json()
        return Usage.model_validate(data["usage"])


class Auth:
    def __init__(self, transport: _SyncTransport) -> None:
        self._transport = transport

    def revoke(self) -> None:
        self._transport.request("DELETE", "/api/v2/auth")


class AsyncAuth:
    def __init__(self, transport: _AsyncTransport) -> None:
        self._transport = transport

    async def revoke(self) -> None:
        await self._transport.request("DELETE", "/api/v2/auth")


class BoxCompute:
    def __init__(
        self,
        *,
        api_key: ApiKey,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._transport = _SyncTransport(
            api_key, base_url=base_url, timeout=timeout, http_client=http_client
        )
        self.auth = Auth(self._transport)
        self.workspaces = Workspaces(self._transport)
        self.sandboxes = Sandboxes(self._transport)
        self.operations = Operations(self._transport)
        self.files = Files(self._transport)
        self.usage = UsageResource(self._transport)

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> BoxCompute:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class AsyncBoxCompute:
    def __init__(
        self,
        *,
        api_key: AsyncApiKey,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._transport = _AsyncTransport(
            api_key, base_url=base_url, timeout=timeout, http_client=http_client
        )
        self.auth = AsyncAuth(self._transport)
        self.workspaces = AsyncWorkspaces(self._transport)
        self.sandboxes = AsyncSandboxes(self._transport)
        self.operations = AsyncOperations(self._transport)
        self.files = AsyncFiles(self._transport)
        self.usage = AsyncUsageResource(self._transport)

    async def close(self) -> None:
        await self._transport.close()

    async def __aenter__(self) -> AsyncBoxCompute:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
