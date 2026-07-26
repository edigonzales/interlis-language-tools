export interface LiveAnalysisGoldenCase {
  readonly name: string;
  readonly text: string;
  readonly expectedCodes: readonly string[];
}

export const liveAnalysisGoldenCatalog: readonly LiveAnalysisGoldenCase[] = [
  {
    name: "2.4 END name and completed attribute",
    text: `INTERLIS 2.4;
MODEL Golden =
  CLASS Item =
    value: TEXT
  END Wrong;
END Golden.
`,
    expectedCodes: ["ILIC-LIVE-END-NAME", "ILIC-LIVE-MISSING-SEMICOLON"],
  },
  {
    name: "2.3 duplicate declaration",
    text: `INTERLIS 2.3;
MODEL Golden =
  CLASS Item =
  END Item;
  CLASS Item =
  END Item;
END Golden.
`,
    expectedCodes: ["ILIC-LIVE-DUPLICATE"],
  },
  {
    name: "forward local type reference",
    text: `INTERLIS 2.4;
MODEL Golden =
  CLASS Item =
    value: Later;
  END Item;
  STRUCTURE Later =
  END Later;
END Golden.
`,
    expectedCodes: ["ILIC-LIVE-FORWARD-REFERENCE"],
  },
  {
    name: "completed unknown type reference",
    text: `INTERLIS 2.4;
MODEL Golden =
  CLASS Item =
    value: Missing;
  END Item;
END Golden.
`,
    expectedCodes: ["ILIC-LIVE-UNKNOWN-REFERENCE"],
  },
  {
    name: "terminated unused import",
    text: `INTERLIS 2.4;
MODEL Golden =
  IMPORTS Unused;
END Golden.
`,
    expectedCodes: ["ILIC-LINT-UNUSED-IMPORT"],
  },
  {
    name: "unfinished identifier stays quiet",
    text: `INTERLIS 2.4;
MODEL Golden =
  CLASS Item =
    value: Miss
`,
    expectedCodes: [],
  },
  {
    name: "active EXTENDS snippet header stays quiet",
    text: `INTERLIS 2.4;
MODEL Golden =
  CLASS Item EXTENDS Miss =

  END Item;
END Golden.
`,
    expectedCodes: [],
  },
  {
    name: "comments and strings do not create editor findings",
    text: `INTERLIS 2.4;
MODEL Golden =
  !! CLASS Wrong = END Other;
  CLASS Item =
    value: TEXT = "END Wrong;";
  END Item;
END Golden.
`,
    expectedCodes: [],
  },
] as const;
