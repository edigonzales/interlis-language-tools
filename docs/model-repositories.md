# Model repositories

INTERLIS Language Tools resolves INTERLIS 2.3 and 2.4 imports in the host, not
inside the synchronous WASM compiler. `@ilic/language-service` exposes the
runtime-neutral `ModelRepository` contract; Node and browser hosts implement it
with `RepositoryManager` from `@ilic/tools`.

## Resolution order and source layers

The effective compiler session contains three layers, in this order:

1. an open editor buffer;
2. a saved `.ili` source from `%ILI_DIR`;
3. a downloaded repository source.

Closing an editor removes only its overlay, so the saved workspace or cached
repository source becomes visible again. Repository order in
`interlisLanguageTools.modelRepositories` is significant. Entries marked
`browseOnly` are neither resolved nor offered by completion.

The default setting is:

```text
%ILI_DIR;https://models.interlis.ch
```

`%ILI_DIR` enables all `.ili` files in the current workspace. `%JAR_DIR` is a
legacy Java-extension setting; it is ignored and produces one migration
warning. HTTP(S) entries are handed to `@ilic/tools`. One unavailable catalog
does not discard models obtained from another configured repository.

When compilation reports missing models, the language service groups them by
the INTERLIS version of the importing document, obtains the complete dependency
closure and performs a final compile-and-analyze run. Only that final run is
published. A final failure is reported at the exact model name
in `IMPORTS`. Cached metadata and model files remain usable when their origin is
temporarily unavailable.

## Navigation and cache

VS Code Desktop stores the `@ilic/tools` cache below the extension's global
storage and materializes navigable, read-only files below:

```text
repository-models/<ili-version>/<model>/<version>/<filename>.ili
```

VS Code Web uses `BrowserCache` and virtual read-only URIs beginning with
`interlis-repository:`. The extension retrieves their content through the
`interlis/repositorySource` protocol request. Repository declarations can be
opened with Ctrl-click, but Save and Rename never modify them.

## Temporary browser mirrors

Until the canonical servers support cross-origin browser requests, browser
hosts apply these isolated aliases:

- `https://models.interlis.ch` becomes both
  `https://geo.so.ch/models/mirror/interlis.ch/` and
  `https://geo.so.ch/models/mirror/geoadmin/`;
- `http(s)://models.geo.admin.ch` becomes
  `https://geo.so.ch/models/mirror/geoadmin/`.

Aliases are deduplicated and `ilisite.xml` links are not followed for browser
mirrors. Node/CLI consumers continue to use canonical URLs. Additional browser
repositories must support CORS explicitly. Remove the alias mapping from the
browser adapters once the original services expose suitable CORS headers.

INTERLIS 1 compilation and syntax diagnostics remain available, but semantic
repository editor features for INTERLIS 1 are intentionally outside this
implementation. Mermaid, PlantUML, GraphML and HTML generation remain excluded.
