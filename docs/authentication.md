# Authentication

Create an API key in the [BoxCompute app](https://app.boxcompute.ai/api-keys).
Grant only the scopes your application requires and copy the key immediately;
it is displayed once.

Use `BOXCOMPUTE_API_KEY` in local development and a managed secret in deployed
applications. The SDK sends it as a bearer token over HTTPS.

```bash
export BOXCOMPUTE_API_KEY='bc_live_REDACTED'
```

Do not commit keys, log them, pass them in URLs, or expose them to browser code.
If a key is disclosed, revoke it in the app and create a replacement.

Common scopes are:

- `sandbox:read`
- `sandbox:create`
- `sandbox:execute`
- `sandbox:delete`
- `workspace:create`
- `usage:read`
