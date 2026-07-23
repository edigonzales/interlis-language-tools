import * as vscode from "vscode";
import {
  DiagramController,
  captureViewport,
  defaultDiagramSettings,
  layoutAndRenderDiagram,
  renderSvg,
  restoreViewport,
  sourceLocationForNode,
} from "@ilic/diagram";
import type {
  AnchoredViewport,
  DiagramSettings,
  LayoutDiagram,
  Viewport,
} from "@ilic/diagram";
import { InterlisProtocol } from "@ilic/language-server/protocol";
import type {
  CompileParams,
  DiagramSnapshotParams,
  DiagramSnapshotResult,
  SemanticSnapshotChangedParams,
} from "@ilic/language-server/protocol";
import type { CompilationResult } from "@ilic/language-service";
import type { LanguageClientFacade } from "./common.js";

interface ViewState {
  readonly source: vscode.Uri;
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly controller: DiagramController;
  snapshot: DiagramSnapshotResult | null;
  layout: LayoutDiagram | null;
  viewport: AnchoredViewport | null;
  visibleViewport: Viewport | null;
  svg: string;
  refreshRequest: number;
  disposed: boolean;
}

export interface DiagramWorkflows {
  readonly open: (source?: vscode.Uri) => Promise<void>;
}

export type StartupDocument = Pick<vscode.TextDocument, "languageId" | "uri">;

export const DIAGRAM_EDITOR_VIEW_TYPE = "interlisLanguageTools.diagramEditor";

function settings(): DiagramSettings {
  const configuration = vscode.workspace.getConfiguration(
    "interlisLanguageTools",
  );
  return {
    ...defaultDiagramSettings,
    nodePlacement: configuration.get<DiagramSettings["nodePlacement"]>(
      "diagram.layout.nodePlacement",
      "BRANDES_KOEPF",
    ),
    edgeRouting: configuration.get<DiagramSettings["edgeRouting"]>(
      "diagram.layout.edgeRouting",
      "ORTHOGONAL",
    ),
    edgeCrossingStyle: configuration.get<DiagramSettings["edgeCrossingStyle"]>(
      "diagram.rendering.edgeCrossings",
      "GAPS",
    ),
    attributeMode: configuration.get<DiagramSettings["attributeMode"]>(
      "uml.attributeMode",
      "OWN",
    ),
    deemphasizeAbstractTypes: configuration.get(
      "uml.deemphasizeAbstractTypes",
      true,
    ),
    showAssociationNames: configuration.get("uml.showAssociationNames", true),
    showRoleCardinalities: configuration.get("uml.showRoleCardinalities", true),
    showLocalEnumerationValues: configuration.get(
      "uml.showLocalEnumerationValues",
      true,
    ),
  };
}

function html(state: ViewState, svg: string, initial: Viewport | null): string {
  const status = state.controller.state;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;font-family:var(--vscode-font-family)}
    header{height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--vscode-panel-border)}
    #status{flex:1;color:${status.status === "stale" || status.status === "error" ? "var(--vscode-editorWarning-foreground)" : "var(--vscode-descriptionForeground)"}}
    #viewport{height:calc(100% - 37px);overflow:auto;background:#fff;overscroll-behavior:contain}
    #surface{position:relative;min-width:100%;min-height:100%}
    #surface svg{display:block;min-width:0;min-height:0;user-select:none}
    #viewport.is-panning{cursor:grabbing}
    button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:4px 9px}
    .ili-node{cursor:pointer}.ili-title{font-weight:600}.ili-members text,.ili-edge-label{font-size:12px}
  </style></head><body><header><span id="status">${status.message}</span><button id="refresh">Refresh / Auto-layout</button><button id="fit">Fit</button><button id="export-full">Export SVG</button><button id="export-visible">Export visible SVG</button></header><div id="viewport"><div id="surface">${svg}</div></div><script>
    const vscode=acquireVsCodeApi();
    const viewport=document.getElementById('viewport');
    const surface=document.getElementById('surface');
    const diagram=surface?.querySelector('svg');
    const MIN_ZOOM=0.25; const MAX_ZOOM=3; const ZOOM_FACTOR=1.1;
    let zoom=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,${initial?.zoom ?? 1}));
    const initialScrollX=${initial?.scrollX ?? 0};
    const initialScrollY=${initial?.scrollY ?? 0};
    const viewBox=diagram?.viewBox?.baseVal;
    const baseWidth=viewBox?.width || diagram?.getBoundingClientRect().width || 1;
    const baseHeight=viewBox?.height || diagram?.getBoundingClientRect().height || 1;
    const clampZoom=(value)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,value));
    let diagramOffsetX=0; let diagramOffsetY=0;
    const currentViewport=()=>({zoom,scrollX:(viewport.scrollLeft-diagramOffsetX)/zoom,scrollY:(viewport.scrollTop-diagramOffsetY)/zoom,width:viewport.clientWidth,height:viewport.clientHeight});
    const sendViewport=()=>{clearTimeout(sendViewport.timer);sendViewport.timer=setTimeout(()=>vscode.postMessage({type:'viewport',value:currentViewport()}),50)};
    const syncSurface=()=>{if(!diagram||!surface)return;const scaledWidth=baseWidth*zoom;const scaledHeight=baseHeight*zoom;diagramOffsetX=Math.max(0,(viewport.clientWidth-scaledWidth)/2);diagramOffsetY=Math.max(0,(viewport.clientHeight-scaledHeight)/2);diagram.style.position='absolute';diagram.style.left=diagramOffsetX+'px';diagram.style.top=diagramOffsetY+'px';diagram.style.width=scaledWidth+'px';diagram.style.height=scaledHeight+'px';surface.style.width=Math.max(scaledWidth,viewport.clientWidth)+'px';surface.style.height=Math.max(scaledHeight,viewport.clientHeight)+'px'};
    const setZoom=(next,cursorX=viewport.clientWidth/2,cursorY=viewport.clientHeight/2)=>{const target=clampZoom(next);if(target===zoom)return;const worldX=(viewport.scrollLeft+cursorX-diagramOffsetX)/zoom;const worldY=(viewport.scrollTop+cursorY-diagramOffsetY)/zoom;zoom=target;syncSurface();viewport.scrollLeft=worldX*zoom+diagramOffsetX-cursorX;viewport.scrollTop=worldY*zoom+diagramOffsetY-cursorY;sendViewport()};
    document.getElementById('refresh').onclick=()=>vscode.postMessage({type:'refresh'});
    document.getElementById('fit').onclick=()=>{const padding=32;zoom=clampZoom(Math.min((viewport.clientWidth-padding)/baseWidth,(viewport.clientHeight-padding)/baseHeight));syncSurface();viewport.scrollLeft=0;viewport.scrollTop=0;sendViewport()};
    document.getElementById('export-full').onclick=()=>vscode.postMessage({type:'exportFull'});
    document.getElementById('export-visible').onclick=()=>{sendViewport();vscode.postMessage({type:'exportVisible',value:currentViewport()})};
    viewport.ondblclick=(event)=>{const node=event.target.closest('[data-symbol-id]');if(node)vscode.postMessage({type:'navigate',id:node.dataset.symbolId});};
    viewport.addEventListener('scroll',sendViewport);
    viewport.addEventListener('wheel',(event)=>{event.preventDefault();if(event.deltaY===0)return;const bounds=viewport.getBoundingClientRect();setZoom(zoom*(event.deltaY<0?ZOOM_FACTOR:1/ZOOM_FACTOR),event.clientX-bounds.left,event.clientY-bounds.top)},{passive:false});
    let panPointer=-1; let panStartX=0; let panStartY=0; let panScrollX=0; let panScrollY=0;
    viewport.addEventListener('pointerdown',(event)=>{if(event.button!==1)return;event.preventDefault();panPointer=event.pointerId;panStartX=event.clientX;panStartY=event.clientY;panScrollX=viewport.scrollLeft;panScrollY=viewport.scrollTop;viewport.classList.add('is-panning');viewport.setPointerCapture?.(event.pointerId)});
    viewport.addEventListener('pointermove',(event)=>{if(event.pointerId!==panPointer)return;event.preventDefault();viewport.scrollLeft=panScrollX-(event.clientX-panStartX);viewport.scrollTop=panScrollY-(event.clientY-panStartY)});
    const stopPan=(event)=>{if(event.pointerId!==panPointer)return;const pointer=panPointer;panPointer=-1;viewport.classList.remove('is-panning');if(event.type!=='lostpointercapture'&&viewport.hasPointerCapture?.(pointer))viewport.releasePointerCapture(pointer);sendViewport()};
    viewport.addEventListener('pointerup',stopPan); viewport.addEventListener('pointercancel',stopPan); viewport.addEventListener('lostpointercapture',stopPan);
    viewport.addEventListener('auxclick',(event)=>{if(event.button===1)event.preventDefault()});
    syncSurface(); viewport.scrollTo(initialScrollX*zoom+diagramOffsetX,initialScrollY*zoom+diagramOffsetY); sendViewport();
  </script></body></html>`;
}

function restoredViewport(state: ViewState): Viewport | null {
  return state.layout && state.viewport
    ? restoreViewport(state.layout, state.viewport, {
        width: 900,
        height: 700,
      })
    : null;
}

function renderCurrent(state: ViewState): void {
  if (!state.disposed)
    state.panel.webview.html = html(state, state.svg, restoredViewport(state));
}

function markStale(state: ViewState, message?: string): void {
  state.refreshRequest++;
  state.controller.stale(message);
  renderCurrent(state);
}

async function refresh(
  client: LanguageClientFacade,
  state: ViewState,
  onMissingSnapshot: (
    state: ViewState,
  ) => Promise<DiagramSnapshotResult | null>,
): Promise<void> {
  const request = ++state.refreshRequest;
  state.controller.loading();
  renderCurrent(state);
  try {
    let result = await client.sendRequest<DiagramSnapshotResult | null>(
      InterlisProtocol.diagramSnapshot,
      { uri: state.source.toString() } satisfies DiagramSnapshotParams,
    );
    if (!result) result = await onMissingSnapshot(state);
    if (!result)
      throw new Error(
        state.document.isDirty
          ? "Save the INTERLIS file to create its diagram."
          : "No semantic snapshot is available yet.",
      );
    if (
      state.disposed ||
      request !== state.refreshRequest ||
      (state.snapshot && result.generation < state.snapshot.generation)
    )
      return;
    if (!result.snapshot.success) {
      state.controller.publish(result.snapshot, "stale");
      renderCurrent(state);
      return;
    }
    if (result.freshness !== "fresh") {
      state.controller.stale();
      renderCurrent(state);
      return;
    }
    const rendered = await layoutAndRenderDiagram(
      result.snapshot.diagram,
      settings(),
    );
    if (state.disposed || request !== state.refreshRequest) return;
    state.controller.publish(result.snapshot, "fresh");
    state.snapshot = result;
    state.layout = rendered.layout;
    state.svg = rendered.svg;
    renderCurrent(state);
  } catch (error) {
    if (state.disposed || request !== state.refreshRequest) return;
    state.controller.fail(
      error instanceof Error ? error.message : String(error),
    );
    renderCurrent(state);
  }
}

async function relayoutCurrent(state: ViewState): Promise<void> {
  const snapshot = state.snapshot?.snapshot ?? state.controller.state.snapshot;
  if (!snapshot?.success) return;
  const request = ++state.refreshRequest;
  state.controller.loading();
  renderCurrent(state);
  try {
    const rendered = await layoutAndRenderDiagram(snapshot.diagram, settings());
    if (state.disposed || request !== state.refreshRequest) return;
    state.layout = rendered.layout;
    state.svg = rendered.svg;
    renderCurrent(state);
  } catch (error) {
    if (state.disposed || request !== state.refreshRequest) return;
    state.controller.fail(
      error instanceof Error ? error.message : String(error),
    );
    renderCurrent(state);
  }
}

async function navigate(state: ViewState, nodeId: string): Promise<void> {
  const snapshot = state.controller.state.snapshot;
  const range = snapshot ? sourceLocationForNode(snapshot, nodeId) : null;
  if (!range) return;
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(range.uri),
  );
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
  });
  const selection = new vscode.Selection(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
  editor.selection = selection;
  editor.revealRange(
    selection,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

function exportDefaultUri(
  state: ViewState,
  suffix: "diagram" | "visible",
): vscode.Uri {
  const filename = state.source.path.split("/").at(-1) ?? "diagram.ili";
  const basename = filename.replace(/\.ili$/i, "") || "diagram";
  return state.source.with({
    path: state.source.path.replace(/[^/]*$/, `${basename}-${suffix}.svg`),
  });
}

async function exportDiagram(
  state: ViewState | undefined,
  visible: boolean,
): Promise<void> {
  if (!state?.layout) {
    void vscode.window.showInformationMessage(
      "Open a rendered INTERLIS diagram before exporting it.",
    );
    return;
  }
  const viewport = visible ? state.visibleViewport : null;
  if (visible && !viewport) {
    void vscode.window.showInformationMessage(
      "The visible diagram viewport is not available yet.",
    );
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: exportDefaultUri(state, visible ? "visible" : "diagram"),
    filters: { SVG: ["svg"] },
    saveLabel: "Export INTERLIS diagram",
  });
  if (!target) return;
  const content = renderSvg(state.layout, settings(), viewport ?? undefined);
  await vscode.workspace.fs.writeFile(
    target,
    new TextEncoder().encode(content),
  );
  void vscode.window.showInformationMessage(
    `INTERLIS diagram exported to ${target.toString()}.`,
  );
}

export function registerDiagramWorkflows(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  options: { readonly startupReady?: Promise<void> } = {},
): DiagramWorkflows {
  const startupReady = options.startupReady ?? Promise.resolve();
  const views = new Map<string, ViewState>();
  const dependencyCompilations = new Set<string>();
  const initialCompilations = new Map<string, Promise<void>>();

  const dependsOn = (state: ViewState, uri: string): boolean =>
    state.source.toString() === uri ||
    Boolean(state.snapshot?.snapshot.documentVersions?.[uri]);

  const requestSnapshot = (state: ViewState) =>
    client.sendRequest<DiagramSnapshotResult | null>(
      InterlisProtocol.diagramSnapshot,
      { uri: state.source.toString() } satisfies DiagramSnapshotParams,
    );

  const compileMissingSnapshot = async (
    state: ViewState,
  ): Promise<DiagramSnapshotResult | null> => {
    if (state.document.isDirty || !state.document.getText().trim()) return null;
    const key = state.source.toString();
    let pending = initialCompilations.get(key);
    if (!pending) {
      pending = client
        .sendRequest<CompilationResult>(InterlisProtocol.compile, {
          uri: key,
          trigger: "diagram",
        } satisfies CompileParams)
        .then(() => undefined);
      initialCompilations.set(key, pending);
    }
    try {
      await pending;
    } finally {
      if (initialCompilations.get(key) === pending)
        initialCompilations.delete(key);
    }
    if (state.disposed) return null;
    return requestSnapshot(state);
  };

  const refreshState = (state: ViewState): Promise<void> =>
    refresh(client, state, compileMissingSnapshot);

  const compileDependency = (
    state: ViewState,
    event: SemanticSnapshotChangedParams,
  ): void => {
    const rootUri = state.source.toString();
    const key = `${rootUri}\n${event.rootUri}\n${event.generation}`;
    if (dependencyCompilations.has(key)) return;
    dependencyCompilations.add(key);
    markStale(state, "Updating diagram after a dependency changed…");
    const request = state.refreshRequest;
    void client
      .sendRequest<CompilationResult>(InterlisProtocol.compile, {
        uri: rootUri,
        trigger: "dependency",
      } satisfies CompileParams)
      .catch((error: unknown) => {
        if (state.disposed || request !== state.refreshRequest) return;
        state.controller.fail(
          error instanceof Error ? error.message : String(error),
        );
        renderCurrent(state);
      })
      .finally(() => dependencyCompilations.delete(key));
  };

  const open = async (source?: vscode.Uri): Promise<void> => {
    const uri = source ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    const sourceEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === uri.toString(),
    );
    const document =
      sourceEditor?.document ?? (await vscode.workspace.openTextDocument(uri));
    if (!document.getText().trim()) {
      void vscode.window.showInformationMessage(
        "The INTERLIS file is empty. Add a model before opening a diagram.",
      );
      return;
    }
    const key = uri.toString();
    const existing = views.get(key);
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      DIAGRAM_EDITOR_VIEW_TYPE,
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      } satisfies vscode.TextDocumentShowOptions,
    );
    if (existing && !existing.disposed) await refreshState(existing);
  };

  const provider: vscode.CustomTextEditorProvider = {
    async resolveCustomTextEditor(document, panel, token): Promise<void> {
      if (token.isCancellationRequested) return;
      const key = document.uri.toString();
      const replaced = views.get(key);
      if (replaced && replaced.panel !== panel) {
        replaced.disposed = true;
        replaced.refreshRequest++;
      }
      panel.title = `INTERLIS Diagram: ${
        document.uri.path.split("/").at(-1) ?? "model"
      }`;
      panel.webview.options = { enableScripts: true };
      const state: ViewState = {
        source: document.uri,
        document,
        panel,
        controller: replaced?.controller ?? new DiagramController(),
        snapshot: replaced?.snapshot ?? null,
        layout: replaced?.layout ?? null,
        viewport: replaced?.viewport ?? null,
        visibleViewport: replaced?.visibleViewport ?? null,
        svg: replaced?.svg ?? "",
        refreshRequest: 0,
        disposed: false,
      };
      views.set(key, state);
      panel.onDidDispose(
        () => {
          state.disposed = true;
          state.refreshRequest++;
          if (views.get(key) === state) views.delete(key);
        },
        null,
        context.subscriptions,
      );
      panel.webview.onDidReceiveMessage(
        (message: { type?: string; id?: string; value?: Viewport }) => {
          if (message.type === "refresh") void refreshState(state);
          if (message.type === "navigate" && message.id)
            void navigate(state, message.id);
          if (message.type === "exportFull") void exportDiagram(state, false);
          if (message.type === "exportVisible") {
            if (message.value) state.visibleViewport = message.value;
            void exportDiagram(state, true);
          }
          if (message.type === "viewport" && message.value && state.layout) {
            state.visibleViewport = message.value;
            state.viewport = captureViewport(state.layout, message.value);
          }
        },
        null,
        context.subscriptions,
      );
      if (!token.isCancellationRequested) await refreshState(state);
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DIAGRAM_EDITOR_VIEW_TYPE,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("interlisLanguageTools.diagram.show", open),
    vscode.commands.registerCommand(
      "interlisLanguageTools.diagram.refresh",
      async () => {
        for (const state of views.values())
          if (state.panel.active) await refreshState(state);
      },
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.diagram.exportSvg",
      () =>
        exportDiagram(
          [...views.values()].find((state) => state.panel.active),
          false,
        ),
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.diagram.exportVisibleSvg",
      () =>
        exportDiagram(
          [...views.values()].find((state) => state.panel.active),
          true,
        ),
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === "interlis")
        void startupReady.then(() => {
          if (
            !vscode.workspace
              .getConfiguration("interlisLanguageTools")
              .get("diagram.autoOpenBeside", true)
          )
            return;
          return open(editor.document.uri);
        });
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== "interlis") return;
      const uri = event.document.uri.toString();
      for (const state of views.values())
        if (dependsOn(state, uri))
          markStale(
            state,
            "Showing the last valid diagram; save to update it.",
          );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !event.affectsConfiguration("interlisLanguageTools.diagram") &&
        !event.affectsConfiguration("interlisLanguageTools.uml")
      )
        return;
      for (const state of views.values())
        if (state.snapshot?.snapshot.success) void relayoutCurrent(state);
        else void refreshState(state);
    }),
    client.onNotification(
      InterlisProtocol.semanticSnapshotChanged,
      (params) => {
        const event = params as SemanticSnapshotChangedParams;
        for (const state of views.values()) {
          if (!dependsOn(state, event.rootUri)) continue;
          const direct = state.source.toString() === event.rootUri;
          if (event.freshness !== "fresh" || !event.success) {
            markStale(
              state,
              "Showing the last valid diagram; the current model contains errors.",
            );
            continue;
          }
          if (direct) {
            void refreshState(state);
            continue;
          }
          if (event.trigger === "save") compileDependency(state, event);
        }
      },
    ),
  );

  return { open };
}

export async function openDiagramOnStartup(
  workflows: DiagramWorkflows,
  document: StartupDocument | undefined,
  startupReady: Promise<void>,
): Promise<void> {
  await startupReady;
  if (!document || document.languageId !== "interlis") return;
  if (
    !vscode.workspace
      .getConfiguration("interlisLanguageTools")
      .get("diagram.autoOpenBeside", true)
  )
    return;
  const active = vscode.window.activeTextEditor?.document;
  if (!active || active.uri.toString() !== document.uri.toString()) return;
  await workflows.open(document.uri);
}
