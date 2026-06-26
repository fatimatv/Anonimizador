import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

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
