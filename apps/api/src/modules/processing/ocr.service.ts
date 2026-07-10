import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OcrRasterWord {
  confidence: number;
  height: number;
  left: number;
  text: string;
  top: number;
  width: number;
}

export interface OcrService {
  recognize(input: { image: Buffer; pageIndex: number }): Promise<OcrRasterWord[]>;
}

export class CommandLineOcrService implements OcrService {
  constructor(
    private readonly options: {
      args: readonly string[];
      command: string;
      minConfidence: number;
    },
  ) {}

  async recognize(input: { image: Buffer; pageIndex: number }): Promise<OcrRasterWord[]> {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'anonimizador-ocr-'));
    const imagePath = path.join(tempDirectory, `page-${input.pageIndex + 1}.png`);

    try {
      await fs.writeFile(imagePath, input.image);
      const args = this.options.args.map((arg) => arg.replaceAll('{image}', imagePath));
      const { stdout } = await execFileAsync(this.options.command, args, {
        timeout: 120000,
        windowsHide: true,
      });

      return parseTesseractTsv(stdout, this.options.minConfidence);
    } finally {
      await fs.rm(tempDirectory, { force: true, recursive: true });
    }
  }
}

export function createOcrServiceFromEnv(): OcrService | null {
  if (process.env.OCR_ENABLED !== 'true') {
    return null;
  }

  const command = process.env.OCR_COMMAND ?? 'tesseract';
  const args = process.env.OCR_ARGS_JSON
    ? (JSON.parse(process.env.OCR_ARGS_JSON) as string[])
    : ['{image}', 'stdout', '-l', process.env.OCR_LANGUAGES ?? 'spa+eng', 'tsv'];

  return new CommandLineOcrService({
    args,
    command,
    minConfidence: Number(process.env.OCR_MIN_CONFIDENCE ?? 45),
  });
}

function parseTesseractTsv(tsv: string, minConfidence: number): OcrRasterWord[] {
  const [headerLine, ...rows] = tsv.trim().split(/\r?\n/u);
  const headers = headerLine?.split('\t') ?? [];
  const indexes = {
    confidence: headers.indexOf('conf'),
    height: headers.indexOf('height'),
    left: headers.indexOf('left'),
    text: headers.indexOf('text'),
    top: headers.indexOf('top'),
    width: headers.indexOf('width'),
  };

  if (Object.values(indexes).some((index) => index < 0)) {
    return [];
  }

  return rows
    .map((row) => {
      const columns = row.split('\t');
      const text = columns[indexes.text]?.trim() ?? '';
      const confidence = Number(columns[indexes.confidence] ?? -1);

      return {
        confidence,
        height: Number(columns[indexes.height] ?? 0),
        left: Number(columns[indexes.left] ?? 0),
        text,
        top: Number(columns[indexes.top] ?? 0),
        width: Number(columns[indexes.width] ?? 0),
      };
    })
    .filter((word) => {
      return (
        word.text.length > 0 &&
        word.confidence >= minConfidence &&
        word.height > 0 &&
        word.width > 0
      );
    });
}
