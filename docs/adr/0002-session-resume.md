# 0002: Event-sourced resumable sessions

## Status

Accepted

## Decision

New sessions persist a versioned `events.jsonl` stream. `session.json` is a rebuildable query projection. A `step_completed` event is the only durable workflow resume boundary, so an interrupted step always restarts at iteration 1 with a fresh agent process.

A session has one logical directory across attempts. Writers acquire an exclusive `active.lock`; lock ownership is included on workflow events. A lock invalidation event prevents later workflow progress from the invalidated owner becoming authoritative.

Agent iterations remain one-shot child processes. Resume starts a fresh process and never depends on a long-lived agent RPC session. The session executor owns child shutdown, event finalization, lock release, and terminal cleanup. Ctrl-C requests graceful shutdown through that owner instead of exiting from an input component.

The terminal UI is intended to use one application lifecycle for live runs and session navigation.

## Consequences

Completed steps are never rerun. Work after `step_started` but before `step_completed` can be repeated, including tool side effects. Existing unversioned session records remain history-only.
