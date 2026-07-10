import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  extractPdfTextMap,
  rasterizePdfPages,
  type PdfTextMap,
} from '../processing/pdf-text-map.service.js';
import { createOcrServiceFromEnv, type OcrService } from '../processing/ocr.service.js';

export type AnonymizedOutputFormat = 'docx' | 'pdf' | 'txt';

export interface RedactionSpan {
  endOffset: number;
  startOffset: number;
}

export interface RenderedAnonymizedOutput {
  buffer: Buffer;
  extension: `.${AnonymizedOutputFormat}`;
  mimeType: string;
}

export class OutputRendererService {
  constructor(private readonly ocrService: OcrService | null = createOcrServiceFromEnv()) {}

  async render(input: {
    format: AnonymizedOutputFormat;
    originalPdfBuffer?: Buffer;
    redactions?: readonly RedactionSpan[];
    text: string;
  }): Promise<RenderedAnonymizedOutput> {
    if (input.format === 'docx') {
      return await renderDocx(input.text);
    }

    if (input.format === 'pdf') {
      if (input.originalPdfBuffer && input.redactions && input.redactions.length > 0) {
        const redactedPdf = await tryRenderRedactedOriginalPdf({
          ocrService: this.ocrService,
          originalPdfBuffer: input.originalPdfBuffer,
          redactions: input.redactions,
        });

        if (redactedPdf) {
          return redactedPdf;
        }
      }

      return await renderPdf(input.text);
    }

    return {
      buffer: Buffer.from(input.text, 'utf8'),
      extension: '.txt',
      mimeType: 'text/plain; charset=utf-8',
    };
  }
}

async function tryRenderRedactedOriginalPdf(input: {
  ocrService: OcrService | null;
  originalPdfBuffer: Buffer;
  redactions: readonly RedactionSpan[];
}): Promise<RenderedAnonymizedOutput | null> {
  try {
    const textMap = await extractPdfTextMap({
      buffer: input.originalPdfBuffer,
      ocrService: input.ocrService,
    });

    if (textMap.source === 'ocr') {
      return await renderRasterRedactedPdf({
        originalPdfBuffer: input.originalPdfBuffer,
        redactions: input.redactions,
        textMap,
      });
    }

    const redactedDocument = await PDFDocument.create();
    const font = await redactedDocument.embedFont(StandardFonts.Helvetica);
    const pages = textMap.pages.map((page) => redactedDocument.addPage([page.width, page.height]));
    const spansToRedact = textMap.spans.filter((span) => {
      return input.redactions.some((redaction) => overlaps(span, redaction));
    });

    if (spansToRedact.length === 0) {
      return null;
    }

    for (const span of textMap.spans) {
      const page = pages[span.pageIndex];

      if (!page) {
        continue;
      }

      drawSanitizedSpan({
        font,
        page,
        redactions: input.redactions,
        span,
      });
    }

    return {
      buffer: Buffer.from(await redactedDocument.save()),
      extension: '.pdf',
      mimeType: 'application/pdf',
    };
  } catch {
    return null;
  }
}

async function renderRasterRedactedPdf(input: {
  originalPdfBuffer: Buffer;
  redactions: readonly RedactionSpan[];
  textMap: PdfTextMap;
}): Promise<RenderedAnonymizedOutput | null> {
  const rasterPages = await rasterizePdfPages({
    buffer: input.originalPdfBuffer,
  });
  const redactedDocument = await PDFDocument.create();

  for (let pageIndex = 0; pageIndex < rasterPages.length; pageIndex += 1) {
    const rasterPage = rasterPages[pageIndex];

    if (!rasterPage) {
      continue;
    }

    const image = await loadImage(rasterPage.image);
    const scale = image.width / rasterPage.width;
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');

    context.drawImage(image, 0, 0);

    for (const span of input.textMap.spans.filter((candidate) => {
      return (
        candidate.pageIndex === pageIndex &&
        input.redactions.some((redaction) => overlaps(candidate, redaction))
      );
    })) {
      context.fillStyle = '#000000';
      context.fillRect(
        span.x * scale,
        (rasterPage.height - span.y - span.height) * scale,
        span.width * scale,
        span.height * scale,
      );
    }

    const page = redactedDocument.addPage([rasterPage.width, rasterPage.height]);
    const redactedImage = await redactedDocument.embedPng(canvas.toBuffer('image/png'));

    page.drawImage(redactedImage, {
      height: rasterPage.height,
      width: rasterPage.width,
      x: 0,
      y: 0,
    });
  }

  if (redactedDocument.getPageCount() === 0) {
    return null;
  }

  return {
    buffer: Buffer.from(await redactedDocument.save()),
    extension: '.pdf',
    mimeType: 'application/pdf',
  };
}

function toPdfSafeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\x20-\x7E]/gu, '');
}

function drawSanitizedSpan(input: {
  font: PDFFont;
  page: ReturnType<PDFDocument['addPage']>;
  redactions: readonly RedactionSpan[];
  span: {
    endOffset: number;
    height: number;
    startOffset: number;
    text: string;
    width: number;
    x: number;
    y: number;
  };
}): void {
  const ranges = mergeRanges(
    input.redactions
      .filter((redaction) => overlaps(input.span, redaction))
      .map((redaction) => ({
        end: Math.min(input.span.text.length, redaction.endOffset - input.span.startOffset),
        start: Math.max(0, redaction.startOffset - input.span.startOffset),
      })),
  );
  const fontSize = Math.max(7, Math.min(12, input.span.height));
  let cursor = 0;

  for (const range of ranges) {
    drawTextSlice(input, cursor, range.start, fontSize);
    drawRedactionSlice(input, range.start, range.end);
    cursor = range.end;
  }

  drawTextSlice(input, cursor, input.span.text.length, fontSize);
}

function drawTextSlice(
  input: Parameters<typeof drawSanitizedSpan>[0],
  start: number,
  end: number,
  fontSize: number,
): void {
  if (end <= start) {
    return;
  }

  const text = toPdfSafeText(input.span.text.slice(start, end));

  if (text.trim().length === 0) {
    return;
  }

  input.page.drawText(text, {
    color: rgb(0.07, 0.09, 0.13),
    font: input.font,
    size: fontSize,
    x: xForOffset(input.span, start),
    y: input.span.y,
  });
}

function drawRedactionSlice(
  input: Parameters<typeof drawSanitizedSpan>[0],
  start: number,
  end: number,
): void {
  if (end <= start) {
    return;
  }

  input.page.drawRectangle({
    color: rgb(0, 0, 0),
    height: input.span.height,
    width: Math.max(4, xForOffset(input.span, end) - xForOffset(input.span, start)),
    x: xForOffset(input.span, start),
    y: input.span.y,
  });
}

function xForOffset(
  span: {
    text: string;
    width: number;
    x: number;
  },
  offset: number,
): number {
  return span.x + span.width * (offset / Math.max(1, span.text.length));
}

function overlaps(
  left: {
    endOffset: number;
    startOffset: number;
  },
  right: {
    endOffset: number;
    startOffset: number;
  },
): boolean {
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function mergeRanges(ranges: Array<{ end: number; start: number }>): Array<{
  end: number;
  start: number;
}> {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ end: number; start: number }> = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}

function normalizeLines(text: string): string[] {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');

  return lines.length > 0 ? lines : [''];
}

async function renderDocx(text: string): Promise<RenderedAnonymizedOutput> {
  const document = new Document({
    sections: [
      {
        children: normalizeLines(text).map(
          (line) =>
            new Paragraph({
              children: [
                new TextRun({
                  text: line.length > 0 ? line : ' ',
                }),
              ],
            }),
        ),
      },
    ],
  });

  return {
    buffer: Buffer.from(await Packer.toBuffer(document)),
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

async function renderPdf(text: string): Promise<RenderedAnonymizedOutput> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 48;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin * 2;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const logicalLine of normalizeLines(text)) {
    for (const line of wrapLine(logicalLine, maxWidth, font, fontSize)) {
      if (y < margin) {
        page = document.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }

      page.drawText(line || ' ', {
        color: rgb(0.07, 0.09, 0.13),
        font,
        size: fontSize,
        x: margin,
        y,
      });
      y -= lineHeight;
    }
  }

  return {
    buffer: Buffer.from(await document.save()),
    extension: '.pdf',
    mimeType: 'application/pdf',
  };
}

function wrapLine(line: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  if (line.length === 0) {
    return [''];
  }

  const wrapped: string[] = [];
  let current = '';

  for (const word of line.split(/\s+/u)) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      wrapped.push(current);
    }

    current = word;
  }

  if (current.length > 0) {
    wrapped.push(current);
  }

  return wrapped;
}
