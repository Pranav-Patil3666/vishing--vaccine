# Dependency record

Direct application and tooling dependencies are version-pinned in the workspace manifests. License identifiers below are recorded from the installed package metadata and should be rechecked when versions change.

| Package | Version | License | Purpose | Replacement if removed |
|---|---:|---|---|---|
| React / React DOM | 19.2.4 | MIT | Minimal React development shell | Replace the shell with another explicitly approved client framework |
| Vite | 6.4.2 | MIT | Web development server and production bundler | A maintained bundler/dev server with TypeScript and React support |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React JSX and refresh integration for Vite | Equivalent maintained React Vite integration |
| Zod | 3.25.76 | MIT | Runtime validation for shared contracts, scenarios, and environment boundaries | Another maintained runtime-schema validator |
| TypeScript | 5.9.3 | Apache-2.0 | Strict static type checking and package builds | A compatible TypeScript compiler |
| `tsx` | 4.23.15 | MIT | Run TypeScript tests and development API without a runtime transpilation setup | Compile first, then use Node directly |
| ESLint | 10.0.3 | MIT | Static lint checks | Another maintained lint tool with TypeScript support |
| `@eslint/js` | 10.0.1 | MIT | Base JavaScript lint rules | ESLint core rules configured directly |
| `typescript-eslint` | 8.58.1 | MIT | TypeScript parser and recommended ESLint rules | Configure a compatible TypeScript ESLint parser/plugin |
| `globals` | 16.4.0 | MIT | Accurate Node/browser global definitions in ESLint config | Maintain the small global allowlists locally |
| `@types/node` | 22.19.17 | MIT | Node.js API declarations | Compatible Node type declarations |
| `@types/react` | 19.2.14 | MIT | React component and JSX declarations | Compatible React type declarations |
| `@types/react-dom` | 19.2.3 | MIT | React DOM declarations | Compatible React DOM type declarations |

No provider SDK, audio library, database client, or HTTP framework is included in Phase 1. The API uses Node's built-in HTTP server; the router, credit guard, cache key, and session state use small local modules because they are deterministic, provider-neutral foundations.
