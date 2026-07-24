#!/bin/sh

passed=0
failed=0
errors=""

run() {
  label="$1"
  shift
  if output=$("$@" 2>&1); then
    printf "  \033[32m✓\033[0m %s\n" "$label"
    passed=$((passed + 1))
  else
    printf "  \033[31m✗\033[0m %s\n" "$label"
    errors="$errors\n\033[31m── $label ──\033[0m\n$output\n"
    failed=$((failed + 1))
  fi
}

run "installed deps" npm ls --depth=0
run "biome"         bun run --silent check:biome
run "typecheck"     bun run --silent check:types
run "dependencies"  bun run --silent check:deps
run "test"          bun run --silent check:test
run "knip"          bun run --silent check:knip
run "build"         bun run --silent build
run "CLI smoke"     bun scripts/smoke-cli.ts

echo ""
if [ "$failed" -gt 0 ]; then
  printf "\033[31m%d failed\033[0m, %d passed\n" "$failed" "$passed"
  printf "%b" "$errors"
  exit 1
else
  printf "\033[32mAll %d checks passed\033[0m\n" "$passed"
fi
