from __future__ import annotations

from typing import Any

import httpx


class BoxComputeError(Exception):
    """A structured error returned by the BoxCompute API."""

    def __init__(
        self,
        *,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id
        self.retryable = status == 429 or status >= 500


class BoxComputeTransportError(Exception):
    """The request did not produce an HTTP response."""


def response_error(response: httpx.Response) -> BoxComputeError:
    try:
        body: Any = response.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return BoxComputeError(
        status=response.status_code,
        code=body.get("code") if isinstance(body.get("code"), str) else "HTTP_ERROR",
        message=(
            body.get("error")
            if isinstance(body.get("error"), str)
            else f"BoxCompute returned HTTP {response.status_code}"
        ),
        request_id=response.headers.get("x-request-id") or response.headers.get("trace-id"),
    )
