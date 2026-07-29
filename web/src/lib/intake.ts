// ドキュメント取り込み: 提案書/マニュアル/議事録などからタスクを抽出する
//
// - テキスト抽出: txt/md/csv/json/log は直読み、docx は mammoth。PDF は今後対応。
// - タスク分解: 見出し・箇条書き・番号・チェックボックス・アクション動詞から候補を生成。
//   （MVP はヒューリスティック。将来 LLM プランナーへ差し替え可能な純関数として分離）

const ACTION_WORDS = [
  '実装', '対応', '作成', '修正', '調査', '設計', 'レビュー', '追加', '更新', '削除',
  'テスト', 'ドキュメント', '連携', '確認', '改善', '検討', '整備', '移行', '導入', '構築',
  '定義', '見直し', '最適化', '検証', '準備', '手配', '共有', '報告',
];

export interface ExtractResult {
  text: string;
  /** 抽出できたか（未対応形式なら false） */
  ok: boolean;
  note?: string;
}

// pdfjs の最小型（依存の型に縛られないための局所定義）
interface PdfTextItem {
  str?: string;
}
interface PdfPage {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
}
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

export async function extractText(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  const isText =
    file.type.startsWith('text/') ||
    /\.(txt|md|markdown|csv|tsv|json|log|yml|yaml)$/.test(name);

  if (isText) {
    return { text: await file.text(), ok: true };
  }
  if (name.endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth');
      const buf = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
      return { text: value, ok: true };
    } catch (e) {
      return { text: '', ok: false, note: `docx 解析に失敗: ${(e as Error).message}` };
    }
  }
  if (name.endsWith('.pdf')) {
    try {
      const pdfjs = (await import('pdfjs-dist')) as unknown as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
      };
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => it.str ?? '').join(' ') + '\n';
      }
      return { text, ok: true };
    } catch (e) {
      return { text: '', ok: false, note: `PDF 解析に失敗: ${(e as Error).message}` };
    }
  }
  // 最後の手段: テキストとして読む
  try {
    return { text: await file.text(), ok: true, note: '不明な形式のためテキストとして読み込みました' };
  } catch {
    return { text: '', ok: false, note: '未対応の形式です' };
  }
}

/** ドキュメント本文からタスク候補を抽出（ヒューリスティック=簡易AI分解） */
export function decomposeToTasks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const tasks: string[] = [];
  let section = '';

  const push = (t: string) => {
    const clean = t.replace(/\s+/g, ' ').trim();
    if (clean.length >= 4 && clean.length <= 160) tasks.push(clean);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // 見出し（Markdown / 章番号）はセクション文脈に
    const heading = line.match(/^#{1,6}\s+(.*)$/) || line.match(/^第?\d+[.．、]\s*(.+)$/);
    if (heading && line.length < 40) {
      section = heading[1].trim();
      continue;
    }

    // チェックボックス / 箇条書き / 番号付き
    const bullet = line.match(/^(?:[-*・]|\d+[.)．]|\[[ x]\]|- \[[ x]\])\s*(.+)$/);
    if (bullet) {
      push(section ? `${section}: ${bullet[1]}` : bullet[1]);
      continue;
    }

    // アクション動詞を含む短文
    if (line.length <= 120 && ACTION_WORDS.some((w) => line.includes(w))) {
      push(line.replace(/^[・\-*\s]+/, ''));
    }
  }

  // 何も取れなければ段落を分割してフォールバック
  if (tasks.length === 0) {
    for (const para of text.split(/\n\s*\n/)) {
      const p = para.replace(/\s+/g, ' ').trim();
      if (p.length >= 8) push(p.slice(0, 140));
      if (tasks.length >= 10) break;
    }
  }

  // 重複除去・上限
  return [...new Set(tasks)].slice(0, 30);
}
