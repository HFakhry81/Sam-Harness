# Local TLS material (not committed)

`server.key` and `server.crt` are **gitignored**. Never commit private keys.

Generate local self-signed material for development experiments:

```bash
pnpm run certs:generate
```

Force regenerate:

```bash
SAM_CERTS_FORCE=1 pnpm run certs:generate
```

Notes:

- Control Plane currently listens over HTTP; these files are for local TLS experiments only.
- CI rejects any git-tracked PEM private key (`pnpm run secrets:check`).
- A public GitHub history may still contain previously committed key blobs even after deletion from `HEAD`; do not reuse those keys for any real deployment.
