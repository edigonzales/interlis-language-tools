# P7 language-service boundaries

The language-service package now exposes explicit component boundaries for
source precedence, syntax/editor snapshots, semantic freshness, compilation
scheduling, repository ownership, event publication and worker protocol.

Implemented modules:

- `source/source-registry.ts`
- `syntax/syntax-snapshot-store.ts`
- `editor/editor-snapshot-store.ts` and `editor/editor-analysis-controller.ts`
- `semantic/semantic-snapshot-store.ts`
- `compilation/compilation-scheduler.ts`
- `repository/repository-model-controller.ts`
- `events/language-service-event-hub.ts`
- `workers/worker-protocol.ts`

`LanguageService` uses `LanguageServiceEventHub` for listener lifecycle and
event publication. The other components are contract-tested independently and
are the migration seams for the remaining legacy state maps and compilation
queue.
