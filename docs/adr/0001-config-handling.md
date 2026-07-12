# ADR 0001: Configuration handling

Date: 2026-05-19

## Status

Accepted

## Context

Loop needs user and project configuration before adding more agent integrations. The immediate driver is allowing users to make `pi` the default agent while keeping `claude` as the built-in default. Configuration will also carry small normalized agent settings and raw agent args.

Config affects execution behavior, so invalid or misspelled config must not be ignored silently.

## Decision

### Format

Use TOML for config files.

Parse TOML with `smol-toml`, then validate with `zod` schemas.

Reasons:

- TOML is readable for user-edited config.
- `smol-toml` is small and Node-compatible.
- `zod` gives typed, strict runtime validation and good error reporting.

### Locations

Load user config from platform-aware, XDG-compatible paths:

1. If `LOOP_CONFIG_HOME` is set: `$LOOP_CONFIG_HOME/config.toml`
2. Else if `XDG_CONFIG_HOME` is set: `$XDG_CONFIG_HOME/loop/config.toml`
3. Else use the platform default:
   - Linux: `~/.config/loop/config.toml`
   - macOS: `~/Library/Application Support/loop/config/config.toml`
   - Windows: `%APPDATA%\\loop\\config.toml`

Runtime state is separate from configuration. Sessions use `LOOP_STATE_HOME`, then `$XDG_STATE_HOME/loop`, then the platform state default.

Load project config by walking upward from the current working directory and using the nearest:

```text
.loop/config.toml
```

Do not merge multiple project configs.

### Precedence

Merge configuration in this order:

```text
built-in defaults < user config < nearest project config < env vars < CLI flags
```

CLI flags always win. User config is the intended way to set personal defaults, such as making `pi` the default agent. Project config can override user defaults for a repository.

### Schema

Only support known agents in v1:

```ts
type AgentName = "claude" | "pi";
```

Reject unknown agents.

Minimal normalized config:

```toml
agent = "pi"

[agents.pi]
command = "pi"
model = "sonnet"
args = ["--thinking", "high", "--profile", "fast"]
env = { PI_OFFLINE = "1" }

[agents.claude]
command = "claude"
model = "sonnet"
args = []
env = {}
```

Supported fields:

- `agent`: selected default agent, `"claude"` or `"pi"`
- `agents.<name>.command`: executable name or path
- `agents.<name>.model`: normalized model setting, mapped by adapters when supported
- `agents.<name>.args`: raw agent-specific args
- `agents.<name>.env`: environment variables overlaid for that agent

Do not include `thinking` as a normalized field. It is not supported uniformly across agents and should be passed through `args`, for example:

```toml
[agents.pi]
args = ["--thinking", "high"]
```

### Environment variables

Support simple env overrides in v1:

- `LOOP_AGENT`
- `LOOP_PI_COMMAND`
- `LOOP_PI_MODEL`
- `LOOP_CLAUDE_COMMAND`
- `LOOP_CLAUDE_MODEL`

Do not support `LOOP_*_ARGS` in v1. Shell splitting is error-prone. Use TOML `args` or CLI passthrough instead.

Configured agent env is merged as:

```text
process.env < config env < per-spawn env
```

Environment values are literal strings. Do not expand `~` or `$VAR` inside values.

### CLI passthrough args

Support a standalone `--` terminator at the end of the Loop command. Everything after it is appended to the selected agent's args.

Examples:

```bash
loop --agent pi "Fix tests" -- --profile fast --thinking high
loop --agent pi [ "Write code" "Review" ] --repeat 3 -- --profile fast
```

Rules:

- `--` must appear after all Loop tasks and Loop flags.
- Passthrough args apply to whichever agent is selected.
- Final agent args are: config args, then CLI passthrough args.

### Strict validation

Fail hard on:

- invalid TOML
- schema validation errors
- unknown top-level keys
- unknown keys under `agents.<name>`
- unknown agent names

Do not warn and continue.

Reason: config controls agent execution. Silently ignoring errors could run the wrong agent, wrong model, or miss safety-critical args.

Error messages should include the config path and field path.

Example:

```text
Invalid Loop config: /home/me/.config/loop/config.toml

agents.pi.args: Expected array of strings
agent: Expected "claude" or "pi"
```

## Consequences

- Config loading should live in a dedicated module with a generic, testable implementation.
- The parser should separate Loop args from agent passthrough args before normal Loop task parsing.
- Adding new agents later requires extending the schema intentionally.
- Agent-specific options stay out of the normalized schema unless they are truly portable across supported agents.
