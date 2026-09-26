# AGENTS.md

## Purpose

This file provides instructions for AI coding agents working in the MonoTerminal repository.

MonoTerminal is a local-first desktop and browser-capable terminal application combining:

- Local shell access
- SSH terminal sessions
- SFTP and local file management
- xterm.js terminal rendering
- AI-assisted troubleshooting
- Plan → Execute → Verify agent workflows
- Local credential encryption
- Command safety / guardrails
- Electron desktop packaging

When modifying this repository, prioritize **correctness, security, compatibility, and minimal changes** over architectural novelty.

Do not rewrite existing working code unless the task requires it.

---

# 1. Repository Architecture

The repository is organized into several major layers:

```text
MonoTerminal/
├── src/                 # React + Tailwind + xterm.js frontend
├── shared/              # Frontend/backend shared contracts and security rules
├── server/              # Node.js backend
│   ├── agent/           # Agent planner, runtime, verifiers, tools, model adapters
│   ├── application/     # Application/session/security services
│   ├── domain/          # Domain models and provider contracts
│   ├── infrastructure/  # Local, SSH, and mock providers
│   └── ws/              # WebSocket routing and handlers
├── electron/            # Electron desktop shell
├── scripts/             # Diagnostics and packaging verification
├── docs/                # Documentation
└── tests/               # Vitest tests
```

The main runtime architecture is:

```text
React / xterm.js
        │
        ├── REST
        └── WebSocket
                │
                ▼
       Local authentication
                │
                ▼
        Express / WS handlers
          │       │       │
          │       │       └── AI providers
          │       │
          │       └──────── File / SFTP
          │
          └──────────────── Terminal / PTY
                    │
                    ▼
             Local or SSH host
```

The frontend and backend communicate through REST and WebSocket protocols.

Shared protocol definitions and security rules must remain centralized in `shared/`.

---

# 2. Technology Stack

The current project uses:

- Node.js 20+
- TypeScript
- React 18
- Vite
- Tailwind CSS
- xterm.js
- Express
- WebSocket (`ws`)
- `ssh2`
- `node-pty`
- Electron
- esbuild
- Vitest
- ESLint
- Prettier
- electron-builder

Use the existing dependency versions and project conventions.

Do not introduce a new framework or replacement library for an existing capability unless explicitly requested.

---

# 3. Development Commands

Install dependencies:

```bash
npm install
```

Start frontend development server:

```bash
npm run dev
```

Start backend development server:

```bash
npm run server
```

Run the complete local service:

```bash
npm run serve
```

Build frontend:

```bash
npm run build
```

Build backend:

```bash
npm run build:server
```

Build frontend and backend:

```bash
npm run build:all
```

Run tests:

```bash
npm test
```

Run a specific test:

```bash
npx vitest run tests/<file>.test.ts
```

Type checking:

```bash
npm run typecheck
```

Lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```

Check formatting:

```bash
npm run format:check
```

Source verification:

```bash
npm run verify:source
```

Runtime diagnostics:

```bash
npm run doctor
```

For changes affecting packaging:

```bash
npm run verify:packaged
```

---

# 4. Required Validation

Before considering a non-trivial change complete, run the smallest relevant validation first.

For changes affecting TypeScript:

```bash
npm run typecheck
```

For changes affecting application logic:

```bash
npm test
```

For changes affecting lint-sensitive code:

```bash
npm run lint
```

For changes affecting build behavior:

```bash
npm run build:all
```

For changes affecting authentication, WebSocket behavior, ports, origin checks, or source-level security invariants:

```bash
npm run verify:source
```

For packaging changes:

```bash
npm run verify:packaged
```

When practical, run the complete validation set:

```bash
npm run typecheck
npm run lint
npm test
npm run build:all
npm run verify:source
```

Do not claim tests passed unless they were actually executed.

If a validation command cannot be executed, state that explicitly.

---

# 5. General Coding Rules

## 5.1 Prefer Minimal Changes

Make the smallest change that correctly solves the problem.

Do not:

- Rewrite unrelated modules.
- Rename large groups of files unnecessarily.
- Introduce abstractions without a concrete need.
- Upgrade dependencies as part of an unrelated feature.
- Reformat unrelated files.
- Change public behavior accidentally.

Preserve existing behavior unless the task explicitly requires a behavior change.

---

## 5.2 Understand Before Editing

Before modifying code:

1. Locate the relevant implementation.
2. Read the surrounding code.
3. Identify related shared types and protocols.
4. Check existing tests.
5. Check whether the behavior is duplicated elsewhere.
6. Make the smallest coherent change.

For security-sensitive code, inspect both frontend and backend implementations before changing behavior.

---

## 5.3 Follow Existing Patterns

Prefer existing project patterns over introducing new patterns.

If a service, utility, protocol type, guardrail, or storage mechanism already exists, extend it rather than creating a parallel implementation.

---

# 6. TypeScript Rules

TypeScript is configured with strict mode.

Do not weaken TypeScript strictness to make a change compile.

Do not introduce:

```ts
// @ts-ignore
```

or broad type casts merely to bypass type errors.

Avoid:

```ts
as any
```

unless there is a strong technical reason and the boundary is clearly documented.

Prefer precise types.

When `any` is unavoidable, keep its scope narrow.

Follow the existing Prettier configuration:

```text
semi: true
singleQuote: true
trailingComma: none
printWidth: 100
tabWidth: 2
arrowParens: avoid
```

---

# 7. Frontend Rules

Frontend code lives primarily under:

```text
src/
```

The frontend uses React and xterm.js.

## React

Follow normal React Hooks rules.

Do not suppress `react-hooks` warnings merely to silence lint.

When changing component state or effects, consider:

- stale closures
- unnecessary rerenders
- event listener cleanup
- WebSocket lifecycle
- terminal session lifecycle

Avoid putting business logic directly into large UI components.

Prefer existing hooks, services, contexts, and utility modules.

---

# 8. Terminal Rules

The terminal is a core part of MonoTerminal.

Terminal behavior involves:

- xterm.js
- node-pty
- local shells
- SSH sessions
- ANSI escape sequences
- OSC 133 / OSC 7 shell integration
- command lifecycle tracking
- terminal output processing

Do not assume terminal output is plain text.

Be careful when changing:

- escape sequence parsing
- terminal input handling
- output sanitization
- command boundaries
- exit-code detection
- current working directory tracking
- terminal resize behavior

Changes to shell integration must preserve graceful behavior when the remote shell does not emit OSC 133 / OSC 7 sequences.

---

# 9. WebSocket Protocol

The WebSocket protocol is a shared contract between frontend and backend.

Protocol definitions belong in:

```text
shared/wsProtocol.ts
```

When adding or changing a WebSocket message:

1. Update the shared type definition.
2. Update runtime validation.
3. Update the server handler.
4. Update the frontend consumer.
5. Add or update tests.

Do not define incompatible private protocol types separately in the frontend and backend.

Never trust incoming WebSocket data merely because it originated from the application frontend.

Validate message shape at the protocol boundary.

Malformed or unsupported messages must be rejected safely.

---

# 10. Security Invariants

Security is a first-class architectural requirement of MonoTerminal.

AI agents must treat the following as **invariants**, not optional implementation details.

---

## 10.1 Guardrail Single Source of Truth

Dangerous command rules must have a single source of truth:

```text
shared/guardrail.ts
```

Frontend and backend guardrail modules should consume or re-export the shared rules.

Do not independently add dangerous-command rules to:

```text
src/utils/guardrail.ts
server/guardrail.ts
```

without also updating the shared implementation.

The frontend and backend must not disagree about whether a command is dangerous.

---

## 10.2 Dangerous Command Protection

MonoTerminal intentionally protects users from destructive commands.

Examples include operations involving:

- recursive deletion
- filesystem formatting
- raw disk writes
- destructive system operations

When changing command execution:

- Never bypass guardrail checks.
- Never remove confirmation requirements merely to simplify UX.
- Never allow a new execution path to bypass existing guardrails.
- Review all alternate execution paths, including AI-generated commands.

AI-generated commands must be treated as untrusted input.

---

## 10.3 AI Command Execution

AI output must never be treated as trusted executable code.

When changing AI command execution, verify:

1. The command passes through the normal safety analysis.
2. Sensitive commands require the appropriate confirmation.
3. The user can distinguish generated commands from commands they typed.
4. `Enter` execution and `Tab` insertion preserve their different safety semantics.
5. Alternative execution paths cannot bypass guardrails.

Never introduce an AI execution shortcut that directly invokes a shell without passing through the existing safety mechanisms.

---

# 11. Credential and Secret Handling

MonoTerminal is local-first.

Credentials include:

- SSH passwords
- SSH private-key credentials
- private-key passphrases
- API keys
- sudo credentials
- other authentication material

These must never be:

- committed to Git
- written to source files
- logged
- included in normal error messages
- returned to the frontend unnecessarily
- displayed in terminal output

Credential storage uses the existing local encrypted storage mechanism.

Preserve:

```text
AES-256-GCM
```

and the existing machine-derived / password-protected key handling.

Do not replace cryptographic operations with custom encryption.

Do not downgrade encryption to plaintext or reversible encoding.

Do not add logging around encryption/decryption that exposes plaintext secrets.

---

# 12. Sudo and Sensitive Input

Sudo handling is security-sensitive.

Sensitive password input must use the existing terminal authentication flow.

Do not pass sudo passwords as normal shell arguments.

Do not echo passwords into the terminal.

Do not store sudo passwords in ordinary application state longer than necessary.

For multi-line scripts and heredocs, preserve the existing pre-validation / `sudo -v` protection.

When modifying terminal authentication, inspect:

```text
src/services/
```

and the corresponding backend authentication logic together.

---

# 13. File System and SFTP Rules

MonoTerminal can modify both local and remote files.

Changes involving file operations must consider:

- path traversal
- permissions
- symlinks
- partial writes
- large files
- connection failures
- interrupted transfers
- remote filesystem behavior

The project currently uses a 10 MB size guard for local/SFTP file operations.

Do not remove or silently increase this limit.

---

## Atomic File Writes

Local file saves should preserve the existing atomic-write behavior:

```text
temporary file
      ↓
write
      ↓
flush / close
      ↓
atomic rename
```

Do not replace atomic writes with direct destructive overwrites without a strong reason.

The objective is to avoid leaving user files truncated or corrupted after process interruption.

---

# 14. Storage and Configuration

Configuration files such as host and settings data must be treated as potentially corrupted.

When modifying storage code:

- Validate JSON.
- Validate expected object shape.
- Handle malformed configuration safely.
- Avoid replacing valid configuration with an empty object because of a read/parse failure.
- Preserve existing user configuration whenever possible.

Do not silently discard configuration data.

Storage changes should include regression tests.

---

# 15. IDs

Use the project's shared ID generator:

```text
shared/id.ts
```

Use:

```ts
generateId()
```

Do not introduce ad-hoc identifiers such as:

```ts
Math.random().toString(36)
```

for application IDs.

---

# 16. AI Agent Architecture

The agent subsystem lives primarily under:

```text
server/agent/
```

It includes concepts such as:

- planning
- execution
- verification
- tools
- model adapters
- runtime state
- agent events

Treat the agent as a stateful execution system, not simply a chat completion wrapper.

When changing agent behavior, consider:

- plan lifecycle
- step state
- retries
- failure handling
- verification
- user approval
- cancellation
- resume behavior
- command/file/tool side effects
- event ordering

A plan should not be considered successful merely because a tool invocation returned without throwing.

Verification is part of the intended agent workflow.

---

# 17. AI Provider Integration

Supported model integrations include:

- DeepSeek
- Qwen
- Ollama
- OpenAI-compatible endpoints

Provider-specific behavior should remain isolated from the core agent logic where possible.

Do not hard-code provider-specific assumptions into unrelated components.

API keys must never appear in logs, frontend-visible error messages, tests, fixtures, or committed configuration.

---

# 18. Error Handling

Do not silently swallow errors unless best-effort cleanup is intentional.

When handling an error:

- Preserve useful context.
- Avoid leaking credentials or sensitive data.
- Distinguish expected operational failures from programming errors.
- Do not expose internal stack traces unnecessarily to remote clients.

An error returned to the frontend should contain enough information for the user to understand the failure without exposing secrets or internal security details.

---

# 19. Resource Lifecycle

This application contains long-lived resources:

- PTY processes
- SSH connections
- SFTP channels
- WebSocket connections
- timers
- event listeners
- file handles
- agent execution state

When adding or modifying resource ownership, explicitly consider cleanup.

Check for:

- process leaks
- socket leaks
- event listener accumulation
- unclosed SSH connections
- timers surviving session shutdown
- stale WebSocket subscriptions

A feature is not complete if its normal cleanup path is missing.

---

# 20. Concurrency

Be particularly careful with:

- terminal sessions
- WebSocket events
- SSH reconnects
- SFTP transfers
- agent execution
- file saves
- cancellation
- retries

Do not assume events arrive in a convenient order.

When multiple asynchronous operations can modify the same state, establish clear ownership and lifecycle rules.

---

# 21. Testing Requirements

New behavior should normally include tests.

Bug fixes should include a regression test when practical.

Tests are located under:

```text
tests/
```

Use Vitest.

High-priority areas requiring tests include:

- guardrails
- WebSocket protocol validation
- shell integration
- terminal authentication
- encrypted storage
- configuration validation
- agent planning
- agent execution
- command safety
- file persistence
- security boundaries

Do not weaken or delete tests merely because the implementation fails them.

If an existing test encodes an outdated behavior and the behavior is intentionally changing, update the test together with the implementation and explain the behavior change.

---

# 22. Code Review Priorities

When reviewing a change, prioritize findings in this order.

## P0 — Critical

Report immediately:

- Credential leakage
- Authentication bypass
- Guardrail bypass
- Arbitrary unintended command execution
- Remote code execution introduced by the change
- Destructive filesystem behavior
- Encryption/security downgrade
- WebSocket trust-boundary bypass
- Severe data corruption

---

## P1 — High

Report:

- Incorrect business behavior
- Broken terminal/session lifecycle
- SSH/SFTP security problems
- Agent execution that bypasses approval or verification
- Race conditions
- Resource leaks
- Configuration data loss
- Breaking protocol changes
- Missing validation on untrusted input
- Significant regression in core terminal behavior

---

## P2 — Medium

Report:

- Missing important regression tests
- Incorrect error handling
- Significant performance regressions
- Maintainability problems likely to cause future defects
- Inconsistent frontend/backend protocol behavior

---

## P3 — Low

Mention only when useful:

- Minor refactoring opportunities
- Naming improvements
- Small readability issues
- Non-critical duplication

Do not flood reviews with cosmetic comments.

---

# 23. Code Review Rules for AI Agents

When performing a code review:

1. Review the actual changed code first.
2. Understand surrounding code before reporting a problem.
3. Trace security-sensitive behavior across frontend, backend, and shared code.
4. Prefer concrete bugs over subjective style opinions.
5. Do not report hypothetical problems without a plausible execution path.
6. Do not assume undocumented behavior is a bug without evidence.
7. Check existing tests before claiming behavior is untested.
8. Distinguish regressions introduced by the change from pre-existing issues.
9. Do not recommend large refactors when a small fix is sufficient.
10. Give findings with enough context for the developer to reproduce and fix them.

A review finding should ideally include:

```text
Problem
↓
Why it is incorrect/dangerous
↓
Concrete execution path
↓
Suggested direction
```

Avoid vague comments such as:

> "This could potentially be improved."

Prefer:

> "When the WebSocket receives X, the new handler bypasses Y validation and reaches Z. A client can therefore send an invalid message shape that the existing protocol boundary is intended to reject."

---

# 24. Security Review Checklist

For changes touching terminal execution, SSH, SFTP, files, WebSocket, AI, authentication, or storage, explicitly check:

### Authentication

- Is the request authenticated?
- Can authentication be bypassed?
- Is authentication state scoped to the correct session?

### Authorization

- Can a client access another session?
- Can a WebSocket operate on resources it does not own?

### Command execution

- Can untrusted input reach a shell?
- Are guardrails applied?
- Can AI-generated commands bypass confirmation?

### Credentials

- Can secrets appear in logs?
- Can secrets reach the renderer unnecessarily?
- Are credentials persisted using the existing encrypted storage?

### File system

- Is path traversal possible?
- Can arbitrary local files be read or overwritten?
- Can remote paths escape the intended SFTP scope?
- Is atomic persistence preserved?

### WebSocket

- Is message shape validated?
- Is the message associated with the correct session?
- Are malformed messages rejected?

### AI

- Is model output treated as untrusted?
- Are tool invocations constrained?
- Are dangerous operations subject to existing approval rules?
- Is verification performed where required?

---

# 25. Performance Review Checklist

For performance-sensitive changes, inspect:

- terminal output processing
- WebSocket message frequency
- large terminal buffers
- file transfers
- SFTP operations
- React rerenders
- event listener registration
- repeated parsing
- unnecessary serialization
- agent tool loops
- model request frequency

Avoid premature optimization.

Do not sacrifice security or correctness for small performance gains.

---

# 26. Dependency Changes

Do not add a dependency when the existing platform or project dependency can reasonably solve the problem.

Before adding a dependency, consider:

- bundle size
- security implications
- native module requirements
- Electron compatibility
- Node.js compatibility
- browser compatibility
- maintenance status
- whether the functionality can be implemented locally with existing dependencies

Do not upgrade unrelated dependencies as part of a feature or bug fix.

---

# 27. Electron Rules

Electron-specific code lives under:

```text
electron/
```

Changes must consider the boundary between:

```text
Electron main process
        │
        ▼
local backend
        │
        ▼
renderer
```

Do not unnecessarily expose Node.js capabilities to the renderer.

Do not introduce new IPC or preload capabilities without checking the security implications.

Packaging changes must preserve:

- `asar`
- `dist`
- `dist-server`
- native `node-pty`
- Windows x64 packaging

When changing packaging configuration, run the appropriate packaging verification commands.

---

# 28. Browser / Desktop Compatibility

MonoTerminal supports both browser/local-service operation and Electron desktop operation.

Do not make a change that works only in Electron when the affected functionality is expected to work in browser mode.

Likewise, do not assume browser APIs exist in Node/Electron main-process code.

Respect the existing frontend/backend boundary.

---

# 29. Generated and Build Artifacts

Do not commit generated build output unless the repository explicitly requires it.

In particular, do not casually modify:

```text
dist/
dist-server/
release/
node_modules/
```

Generated artifacts should normally be produced by the build process.

---

# 30. Documentation

When changing externally visible behavior, update relevant documentation when appropriate.

Documentation should describe actual behavior, not intended future behavior.

Do not update documentation merely to make a failing implementation appear correct.

---

# 31. Pull Request Expectations

A good pull request should clearly communicate:

- Motivation
- What changed
- Important design decisions
- Security implications
- Tests performed
- Known limitations

Prefer focused PRs.

Avoid mixing:

- unrelated refactors
- dependency upgrades
- formatting changes
- feature work

in a single change.

---

# 32. Final Agent Checklist

Before completing a coding task, verify:

### Correctness

- [ ] The requested behavior is implemented.
- [ ] Existing behavior is preserved where required.
- [ ] Edge cases were considered.

### Architecture

- [ ] Existing project patterns are followed.
- [ ] Shared contracts remain centralized.
- [ ] No unnecessary abstraction was introduced.

### Security

- [ ] No credentials or secrets are exposed.
- [ ] Guardrails are not bypassed.
- [ ] Authentication boundaries remain intact.
- [ ] WebSocket inputs are validated.
- [ ] File access remains constrained.
- [ ] AI output is treated as untrusted.

### Reliability

- [ ] Resources are cleaned up.
- [ ] Errors are handled.
- [ ] Configuration cannot be accidentally destroyed.
- [ ] Atomic writes remain atomic where required.

### Testing

- [ ] Relevant tests were added or updated.
- [ ] `npm run typecheck` passes when applicable.
- [ ] `npm run lint` passes when applicable.
- [ ] `npm test` passes when applicable.
- [ ] `npm run build:all` passes when applicable.
- [ ] `npm run verify:source` passes for security/protocol changes.

### Review Quality

- [ ] No unrelated files were changed.
- [ ] No unnecessary dependency was added.
- [ ] No speculative refactor was introduced.
- [ ] The final change is as small as reasonably possible.

---

# 33. Important Principle

When rules conflict, prefer:

```text
Security
    >
Correctness
    >
Data integrity
    >
Compatibility
    >
Maintainability
    >
Performance
    >
Convenience
    >
Cosmetic improvements
```

The primary objective is to keep MonoTerminal a **safe, local-first terminal and AI operations environment** while making focused, reviewable changes.

When uncertain about a security-sensitive architectural change, do not silently bypass an existing invariant. Preserve the invariant and investigate the surrounding design before proceeding.