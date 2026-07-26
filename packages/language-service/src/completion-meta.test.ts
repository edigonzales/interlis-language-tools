import { describe, expect, it } from "vitest";
import type { SyntaxSnapshot } from "@ilic/compiler-wasm";
import { completionItemsAt } from "./completion.js";

const uri = "memory:///Meta.ili";

function complete(source: string): readonly string[] {
  const marker = source.indexOf("│");
  const before = source.slice(0, marker);
  const text = `${before}${source.slice(marker + 1)}`;
  const syntax: SyntaxSnapshot = {
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "meta-test",
    kind: "syntax",
    success: false,
    uri,
    documentVersion: 1,
    iliVersion: "2.4",
    tokens: [],
    nodes: [],
    contexts: [],
    imports: [],
    diagnostics: [],
  };
  return completionItemsAt(syntax, text, null, {
    line: before.split("\n").length - 1,
    character: before.length - (before.lastIndexOf("\n") + 1),
  }).map((item) => item.label);
}

describe("Java-baseline metaattribute matrix", () => {
  it.each([
    [
      "structure",
      "MODEL M =\n!!@ │\nSTRUCTURE S =\nEND S;\nEND M.",
      ["ili2db.mapping=MultiSurface", 'ili2db.dispName="..."'],
      ["ili2db.oid=INTERLIS.UUIDOID", "ilivalid.type=on"],
    ],
    [
      "class",
      "MODEL M =\n!!@ │\nCLASS C =\nEND C;\nEND M.",
      [
        'ili2db.dispName="..."',
        "ili2db.oid=INTERLIS.UUIDOID",
        'ilivalid.keymsg="..."',
        'ilivalid.keymsg_<lang>="..."',
      ],
      ["ili2db.mapping=MultiSurface", "ilivalid.type=on"],
    ],
    [
      "plain attribute",
      "MODEL M =\nCLASS C =\n!!@ │\nvalue: TEXT;\nEND C;\nEND M.",
      [
        'ili2db.dispName="..."',
        "ilivalid.type=on",
        "ilivalid.type=warning",
        "ilivalid.type=off",
        "ilivalid.multiplicity=on",
      ],
      ["ili2db.mapping=ARRAY", "ilivalid.requiredIn=bid1"],
    ],
    [
      "structure collection attribute",
      "MODEL M =\nSTRUCTURE S =\nEND S;\nCLASS C =\n!!@ │\nvalues: LIST OF S;\nEND C;\nEND M.",
      [
        "ili2db.mapping=ARRAY",
        "ili2db.mapping=JSON",
        "ili2db.mapping=EXPAND",
        "ilivalid.requiredIn=bid1",
      ],
      ["ili2db.mapping=MultiSurface"],
    ],
    [
      "reference attribute",
      "MODEL M =\nCLASS C =\n!!@ │\nowner: REFERENCE TO C;\nEND C;\nEND M.",
      ["ilivalid.requiredIn=bid1", "ilivalid.type=on"],
      ["ili2db.mapping=ARRAY"],
    ],
    [
      "role",
      "MODEL M =\nASSOCIATION A =\n!!@ │\nowner -- C;\nEND A;\nEND M.",
      [
        "ilivalid.target=on",
        "ilivalid.target=warning",
        "ilivalid.target=off",
        "ilivalid.multiplicity=on",
        "ilivalid.requiredIn=bid1",
      ],
      ['ili2db.dispName="..."'],
    ],
    [
      "constraint",
      "MODEL M =\nCLASS C =\n!!@ │\nMANDATORY CONSTRAINT value > 0;\nEND C;\nEND M.",
      [
        "ilivalid.check=on",
        "category=...",
        'ilivalid.msg="..."',
        'message_<lang>="..."',
        "name=c1023",
      ],
      ['ili2db.dispName="..."'],
    ],
    [
      "enum element",
      "MODEL M =\nDOMAIN D = (\n!!@ │\nA,\nB);\nEND M.",
      ['ili2db.dispName="..."'],
      ["ilivalid.type=on"],
    ],
  ])("%s root candidates", (_name, source, present, absent) => {
    const labels = complete(source);
    expect(labels).toEqual(expect.arrayContaining(present));
    for (const label of absent) expect(labels).not.toContain(label);
  });

  it.each([
    [
      "structure mappings",
      "MODEL M =\n!!@ ili2db.mapping=│\nSTRUCTURE S =\nEND S;\nEND M.",
      ["MultiSurface", "MultiLine", "MultiPoint", "Multilingual", "Localised"],
    ],
    [
      "attribute mappings",
      "MODEL M =\nSTRUCTURE S =\nEND S;\nCLASS C =\n!!@ ili2db.mapping=│\nvalues: LIST OF S;\nEND C;\nEND M.",
      ["ARRAY", "JSON", "EXPAND"],
    ],
    [
      "severity",
      "MODEL M =\nCLASS C =\n!!@ ilivalid.type=│\nvalue: TEXT;\nEND C;\nEND M.",
      ["on", "warning", "off"],
    ],
    [
      "quoted text",
      "MODEL M =\n!!@ ili2db.dispName=│\nCLASS C =\nEND C;\nEND M.",
      ['"..."'],
    ],
    [
      "oid",
      "MODEL M =\n!!@ ili2db.oid=│\nCLASS C =\nEND C;\nEND M.",
      ["INTERLIS.UUIDOID"],
    ],
    [
      "required basket",
      "MODEL M =\nCLASS C =\n!!@ ilivalid.requiredIn=│\nowner: REFERENCE TO C;\nEND C;\nEND M.",
      ["bid1"],
    ],
  ])("%s values", (_name, source, expected) => {
    expect(complete(source)).toEqual(expected);
  });

  it("returns nothing for an orphan metaattribute", () => {
    expect(complete("MODEL M =\n!!@ │\nEND M.")).toEqual([]);
  });
});
