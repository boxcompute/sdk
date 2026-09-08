# Contributing

Thank you for improving the BoxCompute SDKs.

## Contract-first changes

The public `/api/v2` OpenAPI document is the source of truth. Do not add an SDK
method for an internal route or for behavior absent from the committed contract.

To update the snapshot from a local web-agent checkout:

```bash
BOXCOMPUTE_OPENAPI_SOURCE=../web-agent/apps/api/public/openapi.json \
  npm run sync:openapi
npm run generate
.venv/bin/python scripts/generate-python-models.py
```

Commit the contract and both generated outputs together. Add behavioral tests
for the TypeScript and Python clients whenever a new operation is exposed.

## Pull requests

- Keep TypeScript and Python behavior aligned where both languages expose an operation.
- Never add credentials, local environment files, or recorded authenticated responses.
- Bump only the package whose distributable contents changed.
- Run the checks documented in the root README before opening a pull request.
