# AGENTS.md - Developer Guidelines for chzzk-follow

This file provides guidance for AI agents working in this repository.

## Project Overview

- **Project Name**: chzzk-follow
- **Type**: [Update: specify - e.g., Node.js CLI, Web App, Library]
- **Primary Language**: TypeScript/JavaScript
- **Package Manager**: npm

## Build, Lint, and Test Commands

```bash
npm install           # Install dependencies
npm run dev            # Start development server
npm start              # Start production build
npm run build          # Build for production
npm test               # Run all tests
npm test -- --watch   # Run tests in watch mode
npm test <pattern>    # Run tests matching pattern (e.g., "auth.test.ts")
npm run lint           # Run ESLint
npm run format         # Run Prettier
npm run typecheck      # Run TypeScript type checking
```

## Code Style Guidelines

### General Principles

- Write clean, readable, maintainable code
- Keep functions small and focused (single responsibility)
- Use meaningful variable and function names
- Comment _why_, not _what_

### TypeScript Conventions

- **Always** use TypeScript types - avoid `any`
- Use interfaces for object shapes, types for unions/tuples
- Use `unknown` when type is truly unknown, then narrow
- Prefer const objects over enums (tree-shakeable):

```typescript
const UserRole = { ADMIN: 'admin', USER: 'user' } as const;
type UserRole = (typeof UserRole)[keyof typeof UserRole];
```

- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Avoid loose equality (`==`, `!=`) - use strict equality (`===`, `!==`)

### Imports Order

1. External libraries (React, lodash, etc.)
2. Internal modules (paths relative to project root)
3. Type imports
4. Relative imports

```typescript
import React from 'react';
import axios from 'axios';
import { UserService } from '@/services/user';
import type { User } from '@/types';
import { formatDate } from '../utils/date';
```

### Naming Conventions

- **Files**: kebab-case (configs), PascalCase (components), camelCase (utilities)
- **Variables/Functions**: camelCase
- **Classes/Interfaces/Types**: PascalCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Booleans**: Use `is`, `has`, `should`, `can` prefixes (`isActive`, `hasPermission`)

### Error Handling

```typescript
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

try {
  await riskyOperation();
} catch (error) {
  if (error instanceof AppError) {
    console.error(`Error ${error.code}: ${error.message}`);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Async/Await

- Always handle errors in async functions
- Use `Promise.all()` for parallel operations when appropriate

```typescript
const [users, posts] = await Promise.all([fetchUsers(), fetchPosts()]);
```

### Testing Conventions

- Place tests alongside source files: `utils.ts` → `utils.test.ts`
- Use descriptive test names: `describe('UserService', () => { it('should create user', ...) })`
- Follow AAA pattern: Arrange, Act, Assert

## Project Structure (Example)

```
src/
├── components/     # React/UI components
├── services/       # Business logic, API clients
├── utils/          # Helper functions
├── types/          # TypeScript type definitions
├── hooks/          # Custom React hooks
├── contexts/       # React contexts
└── index.ts        # Entry point
```

## Configuration Files

Respect: `tsconfig.json`, `eslint.config.js`, `prettier.config.js`, `.editorconfig`

## Cursor/Copilot Rules

[None - add `.cursor/rules/` or `.github/copilot-instructions.md` as needed]

## Dependencies

[List key dependencies once project is initialized]

## Common Pitfalls

1. **Never use `any`** - Use `unknown` and narrow types
2. **Never use `@ts-ignore`** - Fix properly
3. **Never commit secrets** - Use `.env` files, add to `.gitignore`
4. **Never leave console.log in production** - Use proper logger
5. **Never skip error handling** - Always handle async errors

---

_Last updated: 2026-02-23_
