# Contributing to PromptQueue

Thank you for considering contributing to PromptQueue! This document outlines the process for contributing code, documentation, and provider adapters.

## Getting Started

1. **Fork the repository** and clone your fork.
2. **Install dependencies** using pnpm (the project uses pnpm workspaces):

```bash
pnpm install
```

3. **Build all packages:**

```bash
pnpm build
```

4. **Run tests:**

```bash
pnpm test
```

All tests should pass before making changes. Write tests first (TDD) when adding new functionality.

## Pull Request Process

1. **Create a branch** from `main` with a descriptive name:
   - `feat/add-redis-storage` for new features
   - `fix/worker-claim-race-condition` for bug fixes
   - `docs/update-readme` for documentation

2. **Make your changes** following the code style guidelines below.

3. **Ensure all tests pass:**

```bash
pnpm build && pnpm test
```

4. **Run the linter:**

```bash
pnpm lint
```

5. **Submit a pull request** against the `main` branch. Include a clear description of what the PR does and why.

## Code Style

- **TypeScript strict mode** is enabled across all packages. Do not use `any`, `as` casts, or `@ts-ignore`.
- **Immutable patterns** -- create new objects instead of mutating existing ones. Prefer `const` and readonly types.
- **No console.log** in production code -- use structured logging if needed.
- **Async/await** over raw promises or callbacks.
- **Early returns** to avoid deep nesting (max 4 levels).
- **Small functions** -- keep functions under 50 lines. Extract utilities from large modules.

## Commit Format

Use conventional commits:

```
feat: add Redis storage adapter
fix: correct task claim transaction isolation
refactor: extract retry logic into separate module
docs: update API endpoint documentation
test: add worker concurrency tests
chore: update dependencies
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Adding a Provider

PromptQueue uses a provider-adapter pattern. To add support for a new AI provider:

1. Create a new file in `packages/server/src/providers/` (e.g., `cohere.ts`).
2. Implement the `ProviderAdapter` interface:

```typescript
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderHealth } from '@promptqueue/core';

export class CohereProvider implements ProviderAdapter {
  name = 'cohere';
  models = ['command-r', 'command-r-plus'];

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    // Map ProviderRequest to provider SDK, execute, return ProviderResponse
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Return provider status, latency, and optional details
  }
}
```

3. Register the provider in `packages/server/src/providers/registry.ts`.
4. Add pricing to `packages/server/src/providers/pricing.ts`.
5. Write unit tests with mocked SDK responses and integration tests.
6. Update the config schema in `@promptqueue/core` if the provider has unique options.

## Adding a Routing Strategy

To add a new routing strategy:

1. Create a new file in `packages/server/src/routing/` (e.g., `latency.ts`).
2. Implement the `Router` interface:

```typescript
import type { Router, Task, ProviderAdapter } from '@promptqueue/core';

export class LatencyRouter implements Router {
  resolve(task: Task, providers: ProviderAdapter[]): ProviderAdapter {
    // Select the provider with the lowest recent latency
  }
}
```

3. Add the strategy to the `RoutingStrategy` type in `@promptqueue/core`.
4. Register the router in the server's routing module.
5. Write tests covering the routing logic.

## Reporting Issues

Use GitHub Issues to report bugs or request features. Include:

- A clear, descriptive title
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Node.js version and operating system
- Relevant logs or error messages

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
