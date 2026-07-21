# Backlog

## Live language intelligence for dirty INTERLIS documents

The current editor integrations deliberately compile only on save or through
the manual compile command. Opening and typing update the in-memory buffer but
do not parse, analyze, or compile it. Output, Problems, diagrams, and
documentation keep the last compilation snapshot and identify it as outdated.

Before live checking is reintroduced, implement and measure:

- incremental, or otherwise sufficiently fast, parser snapshots;
- cancellable worker-based analysis for the direct Web IDE;
- live diagnostics with an explicit, measurable latency budget;
- performance improvements for semantic and syntax snapshot construction;
- completion and on-type features that are safe for dirty documents;
- one compiler-owned grammar and semantic implementation—never a second client
  grammar or reconstructed compiler semantics.

Acceptance requires representative large models, cancellation under sustained
typing, stable source ranges, and proof that live work cannot delay an explicit
save or manual compilation.
