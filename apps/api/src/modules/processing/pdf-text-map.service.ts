import { createCanvas, Path2D as CanvasPath2D } from '@napi-rs/canvas';
import type { OcrService } from './ocr.service.js';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface PdfTextSpan {
  endOffset: number;
  height: number;
  pageIndex: number;
  startOffset: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface PdfTextMap {
  pages: Array<{
    height: number;
    width: number;
  }>;
  source: 'embedded' | 'ocr';
  spans: PdfTextSpan[];
  text: string;
}

export interface PdfRasterPage {
  height: number;
  image: Buffer;
  width: number;
}

interface PdfTextContentItem {
  height?: number;
  str?: string;
  transform?: number[];
  width?: number;
}

export async function extractPdfTextMap(input: {
  buffer: Buffer;
  ocrService?: OcrService | null;
}): Promise<PdfTextMap> {
  ensurePdfJsPolyfills();
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input.buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdfDocument = await loadingTask.promise;

  try {
    let text = '';
    const pages: PdfTextMap['pages'] = [];
    const spans: PdfTextSpan[] = [];

    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      const page = await pdfDocument.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let previousY: number | null = null;

      pages.push({
        height: viewport.height,
        width: viewport.width,
      });

      for (const item of content.items as PdfTextContentItem[]) {
        const itemText = item.str ?? '';

        if (itemText.length === 0 || !item.transform || item.transform.length < 6) {
          continue;
        }

        const scaleY = Number(item.transform[3] ?? 10);
        const x = Number(item.transform[4] ?? 0);
        const baselineY = Number(item.transform[5] ?? 0);
        const height = Math.max(6, Math.abs(item.height ?? scaleY ?? 10));
        const y = Math.max(0, baselineY - height * 0.25);

        if (text.length > 0) {
          text += previousY !== null && Math.abs(previousY - baselineY) > height * 0.8 ? '\n' : ' ';
        }

        const startOffset = text.length;
        text += itemText;
        spans.push({
          endOffset: text.length,
          height: Math.min(height * 1.25, viewport.height),
          pageIndex,
          startOffset,
          text: itemText,
          width: Math.max(item.width ?? itemText.length * height * 0.45, height),
          x,
          y,
        });
        previousY = baselineY;
      }

      if (pageIndex < pdfDocument.numPages - 1) {
        text += '\n';
      }
    }

    const embeddedTextMap = trimTextMap({
      pages,
      source: 'embedded',
      spans,
      text,
    });

    if (embeddedTextMap.text.length > 0 || !input.ocrService) {
      return embeddedTextMap;
    }

    return await extractOcrPdfTextMap({
      ocrService: input.ocrService,
      pdfDocument: pdfDocument as unknown as {
        getPage: (pageNumber: number) => Promise<PdfRenderablePage>;
        numPages: number;
      },
    });
  } finally {
    await loadingTask.destroy();
  }
}

async function extractOcrPdfTextMap(input: {
  ocrService: OcrService;
  pdfDocument: {
    getPage: (pageNumber: number) => Promise<PdfRenderablePage>;
    numPages: number;
  };
}): Promise<PdfTextMap> {
  const scale = 2;
  let text = '';
  const pages: PdfTextMap['pages'] = [];
  const spans: PdfTextSpan[] = [];

  for (let pageIndex = 0; pageIndex < input.pdfDocument.numPages; pageIndex += 1) {
    const page = await input.pdfDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    const words = await input.ocrService.recognize({
      image: canvas.toBuffer('image/png'),
      pageIndex,
    });
    const pageWidth = viewport.width / scale;
    const pageHeight = viewport.height / scale;

    pages.push({
      height: pageHeight,
      width: pageWidth,
    });

    for (const word of words.sort(readingOrder)) {
      if (text.length > 0) {
        text += ' ';
      }

      const startOffset = text.length;
      text += word.text;
      spans.push({
        endOffset: text.length,
        height: Math.max(4, word.height / scale),
        pageIndex,
        startOffset,
        text: word.text,
        width: Math.max(4, word.width / scale),
        x: word.left / scale,
        y: pageHeight - (word.top + word.height) / scale,
      });
    }

    if (pageIndex < input.pdfDocument.numPages - 1) {
      text += '\n';
    }
  }

  return trimTextMap({
    pages,
    source: 'ocr',
    spans,
    text,
  });
}

export async function rasterizePdfPages(input: {
  buffer: Buffer;
  scale?: number;
}): Promise<PdfRasterPage[]> {
  ensurePdfJsPolyfills();
  const scale = input.scale ?? 2;
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input.buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdfDocument = await loadingTask.promise;

  try {
    const pages: PdfRasterPage[] = [];

    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      const page = (await pdfDocument.getPage(pageIndex + 1)) as unknown as PdfRenderablePage;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      pages.push({
        height: viewport.height / scale,
        image: canvas.toBuffer('image/png'),
        width: viewport.width / scale,
      });
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

interface PdfRenderablePage {
  getViewport: (input: { scale: number }) => { height: number; width: number };
  render: (input: { canvas?: unknown; canvasContext: unknown; viewport: unknown }) => {
    promise: Promise<void>;
  };
}

function readingOrder(
  left: { left: number; top: number },
  right: { left: number; top: number },
): number {
  if (Math.abs(left.top - right.top) > 8) {
    return left.top - right.top;
  }

  return left.left - right.left;
}

function trimTextMap(map: PdfTextMap): PdfTextMap {
  const leadingTrim = map.text.length - map.text.trimStart().length;
  const trimmedText = map.text.trim();

  if (leadingTrim === 0 && trimmedText.length === map.text.length) {
    return map;
  }

  const endOffset = leadingTrim + trimmedText.length;
  const spans = map.spans
    .map((span) => ({
      ...span,
      endOffset: Math.min(span.endOffset, endOffset) - leadingTrim,
      startOffset: Math.max(span.startOffset, leadingTrim) - leadingTrim,
    }))
    .filter((span) => span.endOffset > span.startOffset);

  return {
    pages: map.pages,
    source: map.source,
    spans,
    text: trimmedText,
  };
}

function ensurePdfJsPolyfills(): void {
  const globalScope = globalThis as Record<string, unknown>;

  globalScope.DOMMatrix ??= MinimalDOMMatrix;
  globalScope.ImageData ??= MinimalImageData;
  globalScope.Path2D ??= CanvasPath2D ?? MinimalPath2D;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}

class MinimalDOMMatrix {
  a = 1;

  b = 0;

  c = 0;

  d = 1;

  e = 0;

  f = 0;

  constructor(init?: readonly number[] | string) {
    if (Array.isArray(init)) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = [
        Number(init[0] ?? 1),
        Number(init[1] ?? 0),
        Number(init[2] ?? 0),
        Number(init[3] ?? 1),
        Number(init[4] ?? 0),
        Number(init[5] ?? 0),
      ];
    }
  }

  invertSelf(): this {
    return this;
  }

  multiplySelf(): this {
    return this;
  }

  preMultiplySelf(): this {
    return this;
  }

  scale(): this {
    return this;
  }

  translate(): this {
    return this;
  }
}

class MinimalImageData {
  readonly data: Uint8ClampedArray;

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    readonly width: number,
    readonly height = 0,
  ) {
    this.data =
      typeof dataOrWidth === 'number'
        ? new Uint8ClampedArray(dataOrWidth * width * 4)
        : dataOrWidth;
  }
}

class MinimalPath2D {
  constructor(_path?: string | MinimalPath2D) {}

  addPath(): void {}
}
