import type {
  SemanticSnapshot,
  WorkspaceFileSystem,
} from "@ilic/language-service";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export interface DocxOptions {
  readonly title?: string;
  readonly includeDiagnostics?: boolean;
}

export async function generateDocx(
  snapshot: SemanticSnapshot,
  options: DocxOptions = {},
): Promise<Uint8Array> {
  const title =
    options.title ??
    (snapshot.documentation.title || "INTERLIS Model Documentation");
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Compiler: ${snapshot.compilerVersion}`,
          italics: true,
        }),
      ],
    }),
  ];
  for (const section of snapshot.documentation.sections) {
    const heading =
      section.level <= 1
        ? HeadingLevel.HEADING_1
        : section.level === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
    children.push(new Paragraph({ text: section.title, heading }));
    if (section.text) children.push(new Paragraph(section.text));
  }
  if (snapshot.symbols.length > 0) {
    children.push(
      new Paragraph({
        text: "Model elements",
        heading: HeadingLevel.HEADING_1,
      }),
    );
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ["Kind", "Qualified name"].map(
              (text) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text, bold: true })],
                    }),
                  ],
                }),
            ),
          }),
          ...snapshot.symbols.map(
            (symbol) =>
              new TableRow({
                children: [symbol.kind, symbol.qualifiedName].map(
                  (text) => new TableCell({ children: [new Paragraph(text)] }),
                ),
              }),
          ),
        ],
      }),
    );
  }
  if (options.includeDiagnostics && snapshot.diagnostics.length > 0) {
    children.push(
      new Paragraph({ text: "Diagnostics", heading: HeadingLevel.HEADING_1 }),
    );
    children.push(
      ...snapshot.diagnostics.map(
        (diagnostic) =>
          new Paragraph(
            `${diagnostic.severity.toUpperCase()}: ${diagnostic.message}`,
          ),
      ),
    );
  }
  const document = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

export function siblingDocxUri(sourceUri: string): string {
  return sourceUri.toLowerCase().endsWith(".ili")
    ? `${sourceUri.slice(0, -4)}.docx`
    : `${sourceUri}.docx`;
}

export async function writeDocxBesideSource(
  workspace: WorkspaceFileSystem,
  sourceUri: string,
  snapshot: SemanticSnapshot,
  options: DocxOptions = {},
): Promise<string> {
  const uri = siblingDocxUri(sourceUri);
  await workspace.write(uri, await generateDocx(snapshot, options), {
    create: true,
    overwrite: true,
  });
  return uri;
}
