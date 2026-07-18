# ADR 0001: Repository and runtime boundaries

Status: accepted

## Decision

`ilic-fork` owns the native compiler, WASM bindings and repository primitives.
This repository owns all host-neutral language intelligence plus its LSP,
Monaco, diagram, DOCX and VS Code adapters. The separately deployed
`interlis-web-ide` consumes the public packages from this repository.

The language service is the architecture boundary. LSP is a protocol adapter,
not the location of language business logic. Monaco invokes the same service
directly inside a worker.

The live diagram uses Sprotty with elkjs. It does not use a GLSP server or a
WebSocket because the diagram is a read-only projection of a semantic
snapshot.

## Consequences

- Unsaved documents are first-class inputs in every host.
- Node and browser builds differ only in transport, filesystem and cache
  adapters.
- Cross-repository development uses generated package tarballs; no copied
  source or Git submodules are allowed.
