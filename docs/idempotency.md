# Idempotency and retries

Creating a workspace and starting a durable operation require an idempotency
key. Sandbox creation accepts one and should use one in production.

Use a new UUID for each intended mutation. If the response is interrupted,
retry the identical request with the same key. Never reuse the key for a
different request; BoxCompute returns `IDEMPOTENCY_CONFLICT`.

The SDK does not automatically retry mutations. Applications may retry safe
reads after transient transport errors or `5xx` responses with bounded
exponential backoff.
