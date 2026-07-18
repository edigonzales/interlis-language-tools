# INTERLIS Language Tools

Java-free INTERLIS language tooling shared by VS Code, VS Code Web, Theia and
browser-based Monaco editors.

The repository is a pnpm workspace. Its packages are intentionally split at
host boundaries: the language service contains business logic, while LSP and
Monaco packages only translate host APIs.

## Development

```sh
corepack pnpm install
corepack pnpm check
```

See [the architecture decision](docs/adr/0001-repository-and-runtime-boundaries.md)
and [the capability matrix](docs/capability-matrix.md).
