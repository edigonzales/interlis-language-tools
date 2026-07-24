import type {
  SemanticSnapshot,
  WorkspaceFileSystem,
} from "@ilic/language-service";
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  LevelSuffix,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export interface DocxOptions {
  readonly title?: string;
  /** Kept for API compatibility. Diagnostics are intentionally not rendered. */
  readonly includeDiagnostics?: boolean;
}

type DocumentationModel = NonNullable<
  SemanticSnapshot["documentation"]["models"]
>[number];
type DocumentationTopic = DocumentationModel["topics"][number];
type DocumentationViewable = DocumentationModel["viewables"][number];
type DocumentationEnumeration = DocumentationModel["enumerations"][number];

const FONT = "Arial";
const FONT_SIZE = 22;
const TITLE_SIZE = 36;
const TABLE_WIDTH = 9000;
const ATTRIBUTE_WIDTHS = [2250, 1500, 2250, 3000] as const;
const ENUMERATION_WIDTHS = [3000, 6000] as const;
const BLACK = "000000";
const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: BLACK,
} as const;

const textRun = (text: string, bold = false): TextRun =>
  new TextRun({
    text,
    bold,
    font: FONT,
    size: FONT_SIZE,
    color: BLACK,
  });

function paragraph(
  text = "",
  options: { readonly bold?: boolean } = {},
): Paragraph {
  return new Paragraph({
    children: [textRun(text, options.bold ?? false)],
    style: "Normal",
  });
}

function documentationParagraph(text?: string): Paragraph | undefined {
  if (!text?.trim()) return undefined;
  const lines = text.split(/\r?\n/u);
  return new Paragraph({
    style: "Normal",
    children: lines.map(
      (line, index) =>
        new TextRun({
          text: line,
          break: index === 0 ? undefined : 1,
          font: FONT,
          size: FONT_SIZE,
          color: BLACK,
        }),
    ),
  });
}

function heading(text: string, level: 0 | 1): Paragraph {
  return new Paragraph({
    style: level === 0 ? "Heading1" : "Heading2",
    numbering: { reference: "interlis-headings", level },
    children: [textRun(text, true)],
  });
}

function cell(text: string, width: number, bold = false): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 120, right: 120 },
    children: [paragraph(text, { bold })],
  });
}

function table(rows: readonly TableRow[], widths: readonly number[]): Table {
  return new Table({
    rows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 120, right: 120 },
    borders: {
      top: THIN_BORDER,
      bottom: THIN_BORDER,
      left: THIN_BORDER,
      right: THIN_BORDER,
      insideHorizontal: THIN_BORDER,
      insideVertical: THIN_BORDER,
    },
  });
}

function attributeTable(viewable: DocumentationViewable): Table {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Attributname", ATTRIBUTE_WIDTHS[0], true),
        cell("Kardinalität", ATTRIBUTE_WIDTHS[1], true),
        cell("Typ", ATTRIBUTE_WIDTHS[2], true),
        cell("Beschreibung", ATTRIBUTE_WIDTHS[3], true),
      ],
    }),
    ...viewable.rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(row.name, ATTRIBUTE_WIDTHS[0]),
            cell(row.cardinality, ATTRIBUTE_WIDTHS[1]),
            cell(row.type, ATTRIBUTE_WIDTHS[2]),
            cell(row.description ?? "", ATTRIBUTE_WIDTHS[3]),
          ],
        }),
    ),
  ];
  return table(rows, ATTRIBUTE_WIDTHS);
}

function enumerationTable(enumeration: DocumentationEnumeration): Table {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Wert", ENUMERATION_WIDTHS[0], true),
        cell("Beschreibung", ENUMERATION_WIDTHS[1], true),
      ],
    }),
    ...enumeration.entries.map(
      (entry) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(entry.value, ENUMERATION_WIDTHS[0]),
            cell(entry.documentation ?? "", ENUMERATION_WIDTHS[1]),
          ],
        }),
    ),
  ];
  return table(rows, ENUMERATION_WIDTHS);
}

function viewableTitle(viewable: DocumentationViewable): string {
  const kind =
    viewable.kind === "structure"
      ? "Structure"
      : viewable.kind === "view"
        ? "View"
        : "Class";
  const stereotype = viewable.isAbstract ? `Abstract ${kind}` : kind;
  return `${viewable.name} (${stereotype})`;
}

function renderViewable(
  viewable: DocumentationViewable,
): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [
    heading(viewableTitle(viewable), 1),
  ];
  const description = documentationParagraph(viewable.documentation);
  if (description) result.push(description);
  result.push(attributeTable(viewable), paragraph());
  return result;
}

function renderEnumeration(
  enumeration: DocumentationEnumeration,
): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [
    heading(`${enumeration.name} (Enumeration)`, 1),
  ];
  const description = documentationParagraph(enumeration.documentation);
  if (description) result.push(description);
  result.push(enumerationTable(enumeration), paragraph());
  return result;
}

function renderTopic(topic: DocumentationTopic): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [heading(topic.name, 0)];
  const description = documentationParagraph(topic.documentation);
  if (description) result.push(description);
  for (const viewable of topic.viewables)
    result.push(...renderViewable(viewable));
  for (const enumeration of topic.enumerations)
    result.push(...renderEnumeration(enumeration));
  return result;
}

function renderModel(model: DocumentationModel): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [heading(model.name, 0)];
  if (model.title?.trim()) result.push(paragraph(`Titel: ${model.title}`));
  if (model.shortDescription?.trim())
    result.push(paragraph(`Beschreibung: ${model.shortDescription}`));
  for (const viewable of model.viewables)
    result.push(...renderViewable(viewable));
  for (const enumeration of model.enumerations)
    result.push(...renderEnumeration(enumeration));
  for (const topic of model.topics) result.push(...renderTopic(topic));
  return result;
}

function sourceFilename(uri: string, fallback: string): string {
  const path = uri.split(/[?#]/u, 1)[0] ?? uri;
  const candidate = path.split("/").at(-1) || fallback;
  let filename = candidate;
  try {
    filename = decodeURIComponent(candidate);
  } catch {
    // Keep the URI segment if it is not valid percent-encoding.
  }
  return filename.toLowerCase().endsWith(".ili") ? filename : `${filename}.ili`;
}

export async function generateDocx(
  snapshot: SemanticSnapshot,
  options: DocxOptions = {},
): Promise<Uint8Array> {
  const models = snapshot.documentation.models;
  if (!models || models.length === 0) {
    throw new Error(
      "Structured INTERLIS documentation is unavailable. Please update the compiler and compile the document again.",
    );
  }
  const title =
    options.title ??
    sourceFilename(models[0]?.uri ?? "", models[0]?.name ?? "Model");
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      style: "Title",
      children: [
        new TextRun({
          text: title,
          bold: true,
          font: FONT,
          size: TITLE_SIZE,
          color: BLACK,
        }),
      ],
    }),
  ];
  for (const model of models) children.push(...renderModel(model));

  const document = new Document({
    title,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
    numbering: {
      config: [
        {
          reference: "interlis-headings",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1",
              alignment: AlignmentType.START,
              start: 1,
              suffix: LevelSuffix.SPACE,
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: "%1.%2",
              alignment: AlignmentType.START,
              start: 1,
              suffix: LevelSuffix.SPACE,
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE, color: BLACK },
        },
        title: {
          run: { font: FONT, size: TITLE_SIZE, bold: true, color: BLACK },
          paragraph: { spacing: { after: 144 } },
        },
        heading1: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
          paragraph: {
            outlineLevel: 0,
            keepNext: true,
            spacing: { before: 144, after: 72 },
          },
        },
        heading2: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
          paragraph: {
            outlineLevel: 1,
            keepNext: true,
            spacing: { before: 144, after: 72 },
          },
        },
        heading3: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
        },
        heading4: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
        },
        heading5: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
        },
        heading6: {
          run: { font: FONT, size: FONT_SIZE, bold: true, color: BLACK },
        },
      },
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { font: FONT, size: FONT_SIZE, color: BLACK },
          paragraph: { spacing: { after: 144 } },
        },
      ],
      characterStyles: [
        {
          id: "Hyperlink",
          name: "Hyperlink",
          run: { font: FONT, color: BLACK },
        },
      ],
    },
  });
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
