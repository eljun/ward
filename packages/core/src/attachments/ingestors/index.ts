import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export type ExtractedText = {
  text: string;
  metadata?: Record<string, unknown>;
};

export interface AttachmentIngestor {
  readonly kinds: string[];
  extractText(file: string): Promise<ExtractedText>;
  extractMetadata?(file: string): Promise<Record<string, unknown>>;
}

export class MarkdownIngestor implements AttachmentIngestor {
  readonly kinds = ["markdown", "md", "text/markdown"];

  async extractText(file: string): Promise<ExtractedText> {
    return { text: await readFile(file, "utf8") };
  }
}

export class PlainTextIngestor implements AttachmentIngestor {
  readonly kinds = ["text", "txt", "text/plain"];

  async extractText(file: string): Promise<ExtractedText> {
    return { text: await readFile(file, "utf8") };
  }
}

export class PdfTextIngestor implements AttachmentIngestor {
  readonly kinds = ["pdf", "application/pdf"];

  async extractText(file: string): Promise<ExtractedText> {
    const data = await readFile(file);
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return {
        text: result.text,
        metadata: { total_pages: result.total }
      };
    } finally {
      await parser.destroy();
    }
  }
}

export const DEFAULT_ATTACHMENT_INGESTORS: AttachmentIngestor[] = [
  new MarkdownIngestor(),
  new PlainTextIngestor(),
  new PdfTextIngestor()
];

export function inferAttachmentKind(name: string, mimeType?: string): "markdown" | "text" | "pdf" {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType?.toLowerCase();
  if (lowerMime === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowerMime === "text/markdown" || lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return "markdown";
  }
  if (lowerMime?.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".text")) {
    return "text";
  }
  throw new Error("Unsupported attachment type. Supported types: markdown, text, PDF.");
}

export function ingestorForKind(kind: string): AttachmentIngestor {
  const ingestor = DEFAULT_ATTACHMENT_INGESTORS.find((candidate) => candidate.kinds.includes(kind));
  if (!ingestor) {
    throw new Error(`No attachment ingestor registered for ${kind}`);
  }
  return ingestor;
}
