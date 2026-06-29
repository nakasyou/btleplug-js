# AGENTS.md

## Project Direction

- The entry npm package is `btleplug-js`; keep only the entry package unscoped.
- Use Bun for package management and scripts.
- Use Vite for the JavaScript library build and Biome for formatting/linting.
- Keep TypeScript style semicolon-free with single quotes.
- Do not introduce exported classes. Prefer factory functions returning plain objects.
- Prefer `interface` for public TypeScript shapes when practical.
- Keep native optional packages scoped, for example `@nakasyou/btleplug-js-linux-x64-gnu`.

## Useful Commands

```sh
bun install
bun run format
bun run lint
bun run typecheck
bun run test
```

On Linux, btleplug needs DBus development files. In CI this is handled with `pkg-config libdbus-1-dev`.
