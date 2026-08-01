import type { CompletionSlot } from "./completion.js";
import type { CompletionItem } from "./features.js";

export const javaCompletionBaselineCommit =
  "a7878913b479150f9832d8bf4bd5c210d9db0a28";

export interface CompletionGoldenItem {
  readonly label: string;
  readonly kind?: CompletionItem["kind"];
  readonly newText?: string;
  readonly sortText?: string;
}

export interface CompletionGoldenCase {
  readonly id: string;
  readonly source: string;
  readonly iliVersion: "2.3" | "2.4";
  readonly slot: CompletionSlot;
  readonly replaceText: string;
  readonly expectedItems: readonly CompletionGoldenItem[];
  readonly absentLabels?: readonly string[];
}

export const completionGoldenCatalog: readonly CompletionGoldenCase[] = [
  {
    id: "document-root",
    source: "MO│",
    iliVersion: "2.4",
    slot: "top-level-root",
    replaceText: "MO",
    expectedItems: [
      { label: "MODEL", kind: "keyword", newText: "MODEL" },
      {
        label: "MODEL Name (lang) AT ... VERSION ... = ... END Name.",
        kind: "snippet",
      },
    ],
  },
  {
    id: "model-body",
    source: "MODEL M =\n  TO│\nEND M.",
    iliVersion: "2.4",
    slot: "container-body-root",
    replaceText: "TO",
    expectedItems: [{ label: "TOPIC", kind: "keyword" }],
  },
  {
    id: "topic-body",
    source: "MODEL M =\n  TOPIC T =\n    ASSO│\n  END T;\nEND M.",
    iliVersion: "2.4",
    slot: "container-body-root",
    replaceText: "ASSO",
    expectedItems: [{ label: "ASSOCIATION", kind: "keyword" }],
  },
  {
    id: "header-after-name",
    source: "MODEL M =\n  CLASS C │\nEND M.",
    iliVersion: "2.4",
    slot: "declaration-header-after-name",
    replaceText: "",
    expectedItems: [
      { label: "(ABSTRACT)", kind: "keyword", newText: "(ABSTRACT) " },
      { label: "EXTENDS", kind: "keyword", newText: "EXTENDS " },
      { label: "=", kind: "keyword", newText: "= " },
    ],
  },
  {
    id: "multiline-header-modifier",
    source: "MODEL M =\n  CLASS C\n    (EXT│\nEND M.",
    iliVersion: "2.4",
    slot: "declaration-header-modifier-value",
    replaceText: "EXT",
    expectedItems: [{ label: "EXTENDED", kind: "keyword" }],
  },
  {
    id: "header-modifier-close",
    source: "MODEL M =\n  CLASS C (ABSTRACT│\nEND M.",
    iliVersion: "2.4",
    slot: "declaration-header-modifier-close",
    replaceText: "",
    expectedItems: [{ label: ")", kind: "keyword" }],
  },
  {
    id: "header-after-modifier",
    source: "MODEL M =\n  DOMAIN D (GENERIC) │\nEND M.",
    iliVersion: "2.4",
    slot: "declaration-header-after-modifier",
    replaceText: "",
    expectedItems: [
      { label: "EXTENDS", kind: "keyword" },
      { label: "=", kind: "keyword" },
    ],
  },
  {
    id: "header-extends-target-multiline",
    source:
      "MODEL M =\n  CLASS Base =\n  END Base;\n  CLASS Child\n    EXTENDS Ba│\nEND M.",
    iliVersion: "2.4",
    slot: "extends-target",
    replaceText: "Ba",
    expectedItems: [{ label: "Base", kind: "class" }],
  },
  {
    id: "header-extends-model-namespace",
    source: "MODEL M =\n  IMPORTS External;\n  CLASS Child EXTENDS Ex│\nEND M.",
    iliVersion: "2.4",
    slot: "extends-target",
    replaceText: "Ex",
    expectedItems: [{ label: "External", kind: "module" }],
  },
  {
    id: "header-after-extends",
    source:
      "MODEL M =\n  CLASS Base =\n  END Base;\n  CLASS Child EXTENDS Base │\nEND M.",
    iliVersion: "2.4",
    slot: "declaration-header-after-extends",
    replaceText: "",
    expectedItems: [{ label: "=", kind: "keyword" }],
  },
  {
    id: "attribute-root",
    source: "MODEL M =\n  CLASS C =\n    value: TE│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "attribute-type-root",
    replaceText: "TE",
    expectedItems: [{ label: "TEXT", kind: "keyword" }],
  },
  {
    id: "attribute-model-namespace",
    source:
      "MODEL M =\n  IMPORTS External;\n  CLASS C =\n    value: Ex│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "attribute-type-root",
    replaceText: "Ex",
    expectedItems: [{ label: "External", kind: "module" }],
    absentLabels: ["Unimported"],
  },
  {
    id: "qualified-model-namespace-member",
    source:
      "MODEL M =\n  IMPORTS External;\n  CLASS C =\n    value: External.Co│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "qualified-member",
    replaceText: "Co",
    expectedItems: [{ label: "Code", kind: "value" }],
  },
  {
    id: "domain-root-23",
    source: "MODEL M =\n  DOMAIN D = DA│\nEND M.",
    iliVersion: "2.3",
    slot: "domain-type-root",
    replaceText: "DA",
    expectedItems: [],
    absentLabels: ["DATE"],
  },
  {
    id: "domain-root-24",
    source: "MODEL M =\n  DOMAIN D = DA│\nEND M.",
    iliVersion: "2.4",
    slot: "domain-type-root",
    replaceText: "DA",
    expectedItems: [{ label: "DATE", kind: "keyword" }],
  },
  {
    id: "unit-root",
    source: "MODEL M =\n  UNIT U = │\nEND M.",
    iliVersion: "2.4",
    slot: "unit-type-root",
    replaceText: "",
    expectedItems: [{ label: "[BaseUnit]", kind: "snippet" }],
  },
  {
    id: "unit-bracket-target",
    source: "MODEL M =\n  UNIT Meter = [INTERLIS.m];\n  UNIT U = [Me│\nEND M.",
    iliVersion: "2.4",
    slot: "unit-bracket-target",
    replaceText: "Me",
    expectedItems: [{ label: "Meter", kind: "value" }],
  },
  {
    id: "unit-model-namespace",
    source: "MODEL M =\n  IMPORTS External;\n  UNIT U = [Ex│\nEND M.",
    iliVersion: "2.4",
    slot: "unit-bracket-target",
    replaceText: "Ex",
    expectedItems: [{ label: "External", kind: "module" }],
  },
  {
    id: "unit-composed-target",
    source: "MODEL M =\n  UNIT Meter = [INTERLIS.m];\n  UNIT U = (Me│)\nEND M.",
    iliVersion: "2.4",
    slot: "unit-composed-target",
    replaceText: "Me",
    expectedItems: [{ label: "Meter", kind: "value" }],
  },
  {
    id: "unit-composed-operator",
    source:
      "MODEL M =\n  UNIT Meter = [INTERLIS.m];\n  UNIT U = (Meter │)\nEND M.",
    iliVersion: "2.4",
    slot: "unit-composed-operator",
    replaceText: "",
    expectedItems: [{ label: "/", kind: "keyword" }],
  },
  {
    id: "text-length-tail",
    source: "MODEL M =\n  DOMAIN D = TEXT│\nEND M.",
    iliVersion: "2.4",
    slot: "text-length-tail",
    replaceText: "",
    expectedItems: [{ label: "* <length>", kind: "snippet" }],
  },
  {
    id: "text-length-value",
    source: "MODEL M =\n  DOMAIN D = TEXT*│\nEND M.",
    iliVersion: "2.4",
    slot: "text-length-value-tail",
    replaceText: "",
    expectedItems: [{ label: "<length>", kind: "snippet" }],
  },
  {
    id: "numeric-range-tail",
    source: "MODEL M =\n  DOMAIN D = 1│\nEND M.",
    iliVersion: "2.4",
    slot: "inline-numeric-range-tail",
    replaceText: "",
    expectedItems: [{ label: "..", kind: "keyword", newText: ".. " }],
  },
  {
    id: "numeric-upper-bound",
    source: "MODEL M =\n  DOMAIN D = 1 .. │\nEND M.",
    iliVersion: "2.4",
    slot: "inline-numeric-upper-bound-tail",
    replaceText: "",
    expectedItems: [{ label: "<upper>", kind: "snippet" }],
  },
  {
    id: "format-target",
    source: "MODEL M =\n  DOMAIN D = FORMAT INTERLIS.XMLD│\nEND M.",
    iliVersion: "2.4",
    slot: "format-type-target",
    replaceText: "XMLD",
    expectedItems: [{ label: "XMLDate", kind: "keyword" }],
  },
  {
    id: "format-bounds",
    source: "MODEL M =\n  DOMAIN D = FORMAT INTERLIS.XMLDate │\nEND M.",
    iliVersion: "2.4",
    slot: "format-bounds-tail",
    replaceText: "",
    expectedItems: [{ label: "<min> .. <max>", kind: "snippet" }],
  },
  {
    id: "collection-post-keyword-multiline",
    source:
      "MODEL M =\n  CLASS C =\n    values:\n      LIST │\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "collection-post-keyword",
    replaceText: "",
    expectedItems: [{ label: "OF", kind: "keyword" }],
  },
  {
    id: "collection-target-24",
    source:
      "MODEL M =\n  STRUCTURE S =\n  END S;\n  DOMAIN D = TEXT;\n  CLASS C =\n    values: LIST OF │\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "collection-target",
    replaceText: "",
    expectedItems: [
      { label: "S", kind: "class" },
      { label: "D", kind: "value" },
    ],
  },
  {
    id: "collection-model-namespace",
    source:
      "MODEL M =\n  IMPORTS External;\n  CLASS C =\n    values: LIST OF Ex│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "collection-target",
    replaceText: "Ex",
    expectedItems: [{ label: "External", kind: "module" }],
  },
  {
    id: "reference-post-keyword",
    source: "MODEL M =\n  CLASS C =\n    owner: REFERENCE T│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "reference-post-keyword",
    replaceText: "T",
    expectedItems: [{ label: "TO", kind: "keyword", newText: "TO " }],
  },
  {
    id: "reference-target",
    source:
      "MODEL M =\n  CLASS Target =\n  END Target;\n  CLASS C =\n    owner: REFERENCE TO Tar│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "reference-target",
    replaceText: "Tar",
    expectedItems: [{ label: "Target", kind: "class" }],
  },
  {
    id: "reference-model-namespace",
    source:
      "MODEL M =\n  IMPORTS External;\n  CLASS C =\n    owner: REFERENCE TO Ex│\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "reference-target",
    replaceText: "Ex",
    expectedItems: [{ label: "External", kind: "module" }],
  },
  {
    id: "meta-type-tail",
    source: "MODEL M =\n  CLASS C =\n    kind: ATTRIBUTE │\n  END C;\nEND M.",
    iliVersion: "2.4",
    slot: "meta-type-tail",
    replaceText: "",
    expectedItems: [{ label: "OF", kind: "keyword" }],
  },
  {
    id: "deep-qualified-path",
    source:
      "MODEL M =\n  TOPIC Types =\n    STRUCTURE S =\n    END S;\n  END Types;\n  TOPIC Use =\n    CLASS C =\n      values: LIST OF M.Types.│\n    END C;\n  END Use;\nEND M.",
    iliVersion: "2.4",
    slot: "collection-target",
    replaceText: "",
    expectedItems: [{ label: "S", kind: "class" }],
  },
  {
    id: "imports-multiline",
    source: "MODEL Prior =\nEND Prior.\nMODEL M =\n  IMPORTS\n    Pr│;\nEND M.",
    iliVersion: "2.4",
    slot: "import-model",
    replaceText: "Pr",
    expectedItems: [{ label: "Prior", kind: "module" }],
  },
  {
    id: "end-name",
    source: "MODEL M =\nEND M│.",
    iliVersion: "2.4",
    slot: "end-name",
    replaceText: "M",
    expectedItems: [{ label: "M", kind: "value" }],
  },
  {
    id: "metaattribute-root",
    source: "MODEL M =\n  !!@ ilivalid.t│\n  value: TEXT;\nEND M.",
    iliVersion: "2.4",
    slot: "metaattribute-root",
    replaceText: "ilivalid.t",
    expectedItems: [
      { label: "ilivalid.type=on", kind: "snippet" },
      { label: "ilivalid.type=warning", kind: "snippet" },
      { label: "ilivalid.type=off", kind: "snippet" },
    ],
  },
  {
    id: "metaattribute-value",
    source:
      "MODEL M =\n  !!@ ili2db.mapping=Mu│\n  STRUCTURE S =\n  END S;\nEND M.",
    iliVersion: "2.4",
    slot: "metaattribute-value",
    replaceText: "Mu",
    expectedItems: [{ label: "MultiSurface", kind: "keyword" }],
    absentLabels: ["ARRAY"],
  },
] as const;
