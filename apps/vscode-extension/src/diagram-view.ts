import * as vscode from "vscode";
import {
  DiagramController,
  captureViewport,
  defaultDiagramSettings,
  layoutAndRenderDiagram,
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
  DiagramSnapshotParams,
  DiagramSnapshotResult,
} from "@ilic/language-server/protocol";
import type { LanguageClientFacade } from "./common.js";

interface ViewState {
  readonly source: vscode.Uri;
  readonly panel: vscode.WebviewPanel;
  readonly controller: DiagramController;
  snapshot: DiagramSnapshotResult | null;
  layout: LayoutDiagram | null;
  viewport: AnchoredViewport | null;
}

export interface DiagramWorkflows {
  readonly open: (source?: vscode.Uri) => Promise<void>;
}

export type StartupDocument = Pick<vscode.TextDocument, "languageId" | "uri">;

const views = new Map<string, ViewState>();

function settings(): DiagramSettings {
  const configuration = vscode.workspace.getConfiguration(
    "interlisLanguageTools",
  );
  return {
    ...defaultDiagramSettings,
    edgeRouting: configuration.get<DiagramSettings["edgeRouting"]>(
      "diagram.layout.edgeRouting",
      "POLYLINE",
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
    #viewport{height:calc(100% - 37px);overflow:auto;background:#fff} svg{min-width:100%;min-height:100%}
    button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:4px 9px}
    .ili-node{cursor:pointer}.ili-title{font-weight:600}.ili-members text,.ili-edge-label{font-size:12px}
  </style></head><body><header><span id="status">${status.message}</span><button id="refresh">Refresh / Auto-layout</button><button id="fit">Fit</button></header><div id="viewport">${svg}</div><script>
    const vscode=acquireVsCodeApi(); const viewport=document.getElementById('viewport');
    document.getElementById('refresh').onclick=()=>vscode.postMessage({type:'refresh'});
    document.getElementById('fit').onclick=()=>viewport.scrollTo(0,0);
    viewport.ondblclick=(event)=>{const node=event.target.closest('[data-symbol-id]');if(node)vscode.postMessage({type:'navigate',id:node.dataset.symbolId});};
    let timer; const sendViewport=()=>{clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'viewport',value:{zoom:1,scrollX:viewport.scrollLeft,scrollY:viewport.scrollTop,width:viewport.clientWidth,height:viewport.clientHeight}}),50)};
    viewport.addEventListener('scroll',sendViewport); viewport.addEventListener('wheel',sendViewport);
    viewport.scrollTo(${initial?.scrollX ?? 0},${initial?.scrollY ?? 0});
  </script></body></html>`;
}

async function refresh(
  client: LanguageClientFacade,
  state: ViewState,
): Promise<void> {
  state.controller.loading();
  state.panel.webview.html = html(state, "", null);
  try {
    const result = await client.sendRequest<DiagramSnapshotResult | null>(
      InterlisProtocol.diagramSnapshot,
      { uri: state.source.toString() } satisfies DiagramSnapshotParams,
    );
    if (!result) throw new Error("No semantic snapshot is available yet.");
    state.snapshot = result;
    state.controller.publish(
      result.snapshot,
      result.freshness === "fresh" ? "fresh" : "stale",
    );
    const visible = state.controller.state.snapshot;
    if (!visible) throw new Error(state.controller.state.message);
    const rendered = await layoutAndRenderDiagram(visible.diagram, settings());
    state.layout = rendered.layout;
    const restored = state.viewport
      ? restoreViewport(rendered.layout, state.viewport, {
          width: 900,
          height: 700,
        })
      : null;
    state.panel.webview.html = html(state, rendered.svg, restored);
  } catch (error) {
    state.controller.fail(
      error instanceof Error ? error.message : String(error),
    );
    state.panel.webview.html = html(state, "", null);
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

export function registerDiagramWorkflows(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  options: { readonly startupReady?: Promise<void> } = {},
): DiagramWorkflows {
  const startupReady = options.startupReady ?? Promise.resolve();
  const open = async (source?: vscode.Uri): Promise<void> => {
    const uri = source ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    const sourceEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === uri.toString(),
    );
    if (sourceEditor && !sourceEditor.document.getText().trim()) {
      void vscode.window.showInformationMessage(
        "The INTERLIS file is empty. Add a model before opening a diagram.",
      );
      return;
    }
    const key = uri.toString();
    const existing = views.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      await refresh(client, existing);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "interlisLanguageTools.diagram",
      `INTERLIS Diagram: ${uri.path.split("/").at(-1) ?? "model"}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const state: ViewState = {
      source: uri,
      panel,
      controller: new DiagramController(),
      snapshot: null,
      layout: null,
      viewport: null,
    };
    views.set(key, state);
    panel.onDidDispose(() => views.delete(key), null, context.subscriptions);
    panel.webview.onDidReceiveMessage(
      (message: { type?: string; id?: string; value?: Viewport }) => {
        if (message.type === "refresh") void refresh(client, state);
        if (message.type === "navigate" && message.id)
          void navigate(state, message.id);
        if (message.type === "viewport" && message.value && state.layout)
          state.viewport = captureViewport(state.layout, message.value);
      },
      null,
      context.subscriptions,
    );
    await refresh(client, state);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("interlisLanguageTools.diagram.show", open),
    vscode.commands.registerCommand(
      "interlisLanguageTools.diagram.refresh",
      async () => {
        for (const state of views.values())
          if (state.panel.active) await refresh(client, state);
      },
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
