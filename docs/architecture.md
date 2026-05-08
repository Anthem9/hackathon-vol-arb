# Architecture

The Version 1 demo is a monorepo with clear boundaries:

```text
apps/web -> apps/api -> packages/adapters -> packages/core
```

`apps/web` consumes JSON from `apps/api`. React components do not import mock fixtures directly. `packages/core` owns deterministic calculations, while `packages/adapters` owns market-shaped data and future venue integration boundaries.
