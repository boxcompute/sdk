# OpenAPI contract snapshot

`boxcompute-v2.json` is copied from the public contract served at
`https://api.boxcompute.ai/api/v2/openapi.json`. SDK generation uses the
committed snapshot so builds remain reproducible.

Update it with:

```bash
npm run sync:openapi
npm run generate
.venv/bin/python scripts/generate-python-models.py
```

For an unreleased web-agent change, set `BOXCOMPUTE_OPENAPI_SOURCE` to its local
generated `apps/api/public/openapi.json` file.
