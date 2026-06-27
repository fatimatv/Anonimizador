import { createHash } from 'node:crypto';
import mammoth from 'mammoth';

export interface ExtractedTextSummary {
  extractedTextHash: string;
  extractedTextLength: number;
}

export interface ExtractedTextResult extends ExtractedTextSummary {
  text: string;
}

export class TextExtractionService {
  async extract(input: { buffer: Buffer; mimeType: string }): Promise<ExtractedTextResult> {
    const text = await this.extractRawText(input);
    const normalizedText = text.replace(/\r\n/g, '\n').trim();

    if (normalizedText.length === 0) {
      throw new Error('No extractable text');
    }

    return {
      extractedTextHash: hashText(normalizedText),
      extractedTextLength: normalizedText.length,
      text: normalizedText,
    };
  }

  private async extractRawText(input: { buffer: Buffer; mimeType: string }): Promise<string> {
    if (input.mimeType === 'text/plain') {
      return input.buffer.toString('utf8').replace(/^\uFEFF/u, '');
    }

    if (input.mimeType === 'application/pdf') {
      ensurePdfJsPolyfills();
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: input.buffer });

      try {
        const result = await parser.getText();

        return result.text;
      } finally {
        await parser.destroy();
      }
    }

    if (
      input.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer: input.buffer });

      return result.value;
    }

    throw new Error('Unsupported extraction type');
  }
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function ensurePdfJsPolyfills(): void {
  const globalScope = globalThis as Record<string, unknown>;

  globalScope.DOMMatrix ??= MinimalDOMMatrix;
  globalScope.ImageData ??= MinimalImageData;
  globalScope.Path2D ??= MinimalPath2D;
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
