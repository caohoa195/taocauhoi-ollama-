import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  PageBreak,
  ShadingType,
  VerticalAlign,
} from 'docx';

const FONT_NAME = 'Times New Roman';
const BASE_SIZE = 24; // 12pt in half-points

const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'auto',
};

const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: '333333',
};

const NONE_TABLE_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};

const DATA_TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

/**
 * Normalizes collapsed single-line Markdown/HTML strings (often produced inside JSON by LLMs)
 * into clean multi-line Markdown so both web preview and Word .docx export preserve the exact exam/answer template.
 */
export function normalizeExamMarkdown(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  // 1. Protect LaTeX math segments so pipes inside |x| aren't mistaken for table borders
  const mathTokens: string[] = [];
  let s = raw.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g, (m) => {
    const idx = mathTokens.length;
    mathTokens.push(m);
    return `@@MATH_TOKEN_${idx}@@`;
  });

  // 2. Normalize escaped literal \n if any came double-escaped
  s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');

  // 3. Split collapsed Markdown table separator rows:
  // e.g. "| Col1 | Col2 | | :--- | :--- | <center>..."
  s = s.replace(
    /\|\s+(\|\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?)/g,
    '|\n$1'
  );

  // Split anything trailing right after a markdown separator row on the same line
  s = s.replace(
    /((?:^|\n)\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?)[ \t]+(?=[^\n])/g,
    '$1\n'
  );

  // 4. Ensure block-level HTML tags sit on their own lines
  s = s
    .replace(/[ \t]*(<center>[\s\S]*?<\/center>)[ \t]*/gi, '\n$1\n')
    .replace(/[ \t]*(<div[^>]*word-page-break[^>]*>[\s\S]*?<\/div>)[ \t]*/gi, '\n$1\n')
    .replace(/[ \t]*(<div[^>]*page-break[^>]*>[\s\S]*?<\/div>)[ \t]*/gi, '\n$1\n')
    .replace(/[ \t]*(<table[\s\S]*?<\/table>)[ \t]*/gi, '\n$1\n');

  // 5. Split collapsed table data rows: "| cell1 | cell2 | | cell3 | cell4 |" -> separate lines
  // Only split `| |` when it is outside a single row (i.e. preceded by `|` and followed by non-empty content starting a row)
  const rawLines = s.split(/\r?\n/);
  const splitLines: string[] = [];
  for (const line of rawLines) {
    const t = line.trim();
    if (t.startsWith('|') && /\|\s+\|/.test(t)) {
      // Split on `| |` boundaries where the next segment has another `|`
      const expanded = t.replace(/\|\s+\|(?=\s*[^|\n]+\|)/g, '|\n|');
      splitLines.push(...expanded.split('\n'));
    } else {
      splitLines.push(line);
    }
  }
  s = splitLines.join('\n');

  // 6. Split multiple questions collapsed onto a single paragraph line
  // e.g. "...đại lượng nào? Câu 2 (Thông hiểu): ..." or "ĐỀ SỐ 1 Câu 1 (Nhận biết): ..."
  s = s.replace(
    /([.?!:;)”"']|ĐỀ SỐ\s*\d+|ĐÁP ÁN ĐỀ SỐ\s*\d+)[ \t]+((?:\*\*)?(?:Câu|Bài)\s+\d+(?:\s*\([^)]+\))?\s*[:.])/gi,
    '$1\n\n$2'
  );

  // Also split sub-sections like "A. PHẦN TRẮC NGHIỆM" / "PHẦN I." if collapsed after punctuation
  s = s.replace(
    /([.?!:;])[ \t]+((?:\*\*)?(?:PHẦN\s+[IVX\d]+|[IVX]+\.\s+[A-ZÀ-Ỹ]))/g,
    '$1\n\n$2'
  );

  // 6.5. Enforce strictly 2 columns (| Nội dung | Điểm |) on Answer Key tables
  const tableNormLines = s.split('\n');
  const finalNormLines: string[] = [];
  let idx = 0;
  while (idx < tableNormLines.length) {
    const cur = tableNormLines[idx].trim();
    if (cur.startsWith('|')) {
      const block: string[] = [];
      while (idx < tableNormLines.length && tableNormLines[idx].trim().startsWith('|')) {
        block.push(tableNormLines[idx].trim());
        idx++;
      }

      const firstNonSep = block[0] || '';
      const headerLower = firstNonSep.toLowerCase();
      const isGradingTable =
        headerLower.includes('kết quả cuối') ||
        headerLower.includes('phương thức chấm') ||
        headerLower.includes('điểm đạt') ||
        headerLower.includes('yêu cầu đề bài');
      const isHeaderLayout =
        headerLower.includes('khoa') ||
        headerLower.includes('bộ môn') ||
        headerLower.includes('đề thi kết thúc') ||
        headerLower.includes('đáp án đề thi');
      const isAnswerTable =
        !isGradingTable &&
        !isHeaderLayout &&
        (headerLower.includes('nội dung') || headerLower.includes('đáp án') || headerLower.includes('lời giải')) &&
        headerLower.includes('điểm');

      if (isAnswerTable) {
        let emittedHeader = false;
        for (const row of block) {
          if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(row)) {
            continue;
          }
          const rawCells = row.split('|');
          if (rawCells.length > 0 && rawCells[0].trim() === '') rawCells.shift();
          if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
          const cells = rawCells.map((c) => c.trim());

          if (!emittedHeader) {
            finalNormLines.push('| Nội dung | Điểm |');
            finalNormLines.push('| :--- | :---: |');
            emittedHeader = true;
            continue;
          }

          if (cells.length === 1) {
            finalNormLines.push(`| ${cells[0]} | |`);
          } else if (cells.length === 2) {
            finalNormLines.push(`| ${cells[0]} | ${cells[1]} |`);
          } else if (cells.length >= 3) {
            // Remove stray empty outer cells first if present
            let cleaned = [...cells];
            while (cleaned.length > 2 && cleaned[0] === '') cleaned.shift();
            while (cleaned.length > 2 && cleaned[cleaned.length - 1] === '') cleaned.pop();

            if (cleaned.length === 2) {
              finalNormLines.push(`| ${cleaned[0]} | ${cleaned[1]} |`);
            } else {
              const scoreCell = cleaned[cleaned.length - 1];
              const leftParts = cleaned.slice(0, -1).filter((p) => p !== '');
              let mergedContent = '';
              for (const part of leftParts) {
                if (!mergedContent) {
                  mergedContent = part;
                } else if (/[:：]\s*(\*\*)?$/.test(mergedContent)) {
                  mergedContent += ` ${part}`;
                } else {
                  mergedContent += `: ${part}`;
                }
              }
              finalNormLines.push(`| ${mergedContent} | ${scoreCell} |`);
            }
          }
        }
      } else if (isHeaderLayout) {
        const nonSepRows = block.filter(
          (r) => !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(r)
        );
        if (nonSepRows.length > 0) {
          finalNormLines.push(nonSepRows[0]);
          finalNormLines.push('| :--- | :--- |');
          for (let rIdx = 1; rIdx < nonSepRows.length; rIdx++) {
            finalNormLines.push(nonSepRows[rIdx]);
          }
        } else {
          finalNormLines.push(...block);
        }
      } else {
        finalNormLines.push(...block);
      }
      continue;
    }

    finalNormLines.push(tableNormLines[idx]);
    idx++;
  }
  s = finalNormLines.join('\n');

  // Clean up excessive blank lines
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  // 7. Restore LaTeX math tokens
  s = s.replace(/@@MATH_TOKEN_(\d+)@@/g, (_, idx) => mathTokens[Number(idx)] ?? '');

  return s;
}

function cleanLatexToUnicode(input: string): string {
  if (!input) return '';
  let s = input;

  const replacements: [RegExp, string][] = [
    [/\\left\(/g, '('],
    [/\\right\)/g, ')'],
    [/\\left\[/g, '['],
    [/\\right\]/g, ']'],
    [/\\cdot/g, '·'],
    [/\\times/g, '×'],
    [/\\div/g, '÷'],
    [/\\pm/g, '±'],
    [/\\mp/g, '∓'],
    [/\\leq/g, '≤'],
    [/\\le(?![a-zA-Z])/g, '≤'],
    [/\\geq/g, '≥'],
    [/\\ge(?![a-zA-Z])/g, '≥'],
    [/\\neq/g, '≠'],
    [/\\ne(?![a-zA-Z])/g, '≠'],
    [/\\approx/g, '≈'],
    [/\\equiv/g, '≡'],
    [/\\infty/g, '∞'],
    [/\\rightarrow/g, '→'],
    [/\\to(?![a-zA-Z])/g, '→'],
    [/\\Rightarrow/g, '⇒'],
    [/\\Leftrightarrow/g, '⇔'],
    [/\\alpha/g, 'α'],
    [/\\beta/g, 'β'],
    [/\\gamma/g, 'γ'],
    [/\\delta/g, 'δ'],
    [/\\Delta/g, 'Δ'],
    [/\\epsilon/g, 'ε'],
    [/\\varepsilon/g, 'ε'],
    [/\\theta/g, 'θ'],
    [/\\lambda/g, 'λ'],
    [/\\mu/g, 'μ'],
    [/\\pi/g, 'π'],
    [/\\rho/g, 'ρ'],
    [/\\sigma/g, 'σ'],
    [/\\tau/g, 'τ'],
    [/\\phi/g, 'φ'],
    [/\\varphi/g, 'φ'],
    [/\\omega/g, 'ω'],
    [/\\Omega/g, 'Ω'],
    [/\\sum/g, '∑'],
    [/\\int/g, '∫'],
    [/\\partial/g, '∂'],
    [/\\degree/g, '°'],
    [/\^\{\\circ\}/g, '°'],
    [/\^\\circ/g, '°'],
    [/\\text\{([^}]*)\}/g, '$1'],
    [/\\mathrm\{([^}]*)\}/g, '$1'],
    [/\\mathbf\{([^}]*)\}/g, '$1'],
    [/\\vec\{([^}]*)\}/g, '$1⃗'],
    [/\\sqrt\{([^}]*)\}/g, '√($1)'],
    [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)'],
  ];

  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }

  // Strip $$, $, \(, \), \[ , \] math delimiters cleanly
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  s = s.replace(/\$([^$\n]+?)\$/g, '$1');
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, '$1');

  // Strip backslash from standard math functions
  s = s.replace(/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|ln|log|exp|lim|max|min|sup|inf)\b/g, '$1');

  const supMap: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻',
  };
  const subMap: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  };
  s = s.replace(/\^\{([0-9+-]+)\}/g, (_, g) => g.split('').map((c: string) => supMap[c] || c).join(''));
  s = s.replace(/\^([0-9])/g, (_, d) => supMap[d] || `^${d}`);
  s = s.replace(/_\{([0-9]+)\}/g, (_, g) => g.split('').map((c: string) => subMap[c] || c).join(''));
  s = s.replace(/_\{([^}]+)\}/g, '_$1');
  s = s.replace(/\^\{([^}]+)\}/g, '^$1');
  s = s.replace(/_([0-9])/g, (_, d) => subMap[d] || `_${d}`);

  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return s;
}

function parseInlineRuns(
  rawText: string,
  options?: { baseBold?: boolean; baseItalics?: boolean; size?: number; color?: string }
): TextRun[] {
  const size = options?.size ?? BASE_SIZE;
  const baseBold = options?.baseBold ?? false;
  const baseItalics = options?.baseItalics ?? false;
  const color = options?.color;

  let text = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(b|strong)>/gi, '**')
    .replace(/<\/?(i|em)>/gi, '*')
    .replace(/<\/?u>/gi, '')
    .replace(/<\/?(p|div|span|center|h[1-6])[^>]*>/gi, '');

  text = cleanLatexToUnicode(text);

  const runs: TextRun[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      runs.push(new TextRun({ break: 1 }));
    }

    const tokenRegex = /(\*\*[\s\S]*?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
      if (match.index > lastIdx) {
        const plain = line.slice(lastIdx, match.index);
        if (plain) {
          runs.push(
            new TextRun({
              text: plain,
              font: FONT_NAME,
              size,
              bold: baseBold,
              italics: baseItalics,
              color,
            })
          );
        }
      }

      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        const inner = token.slice(2, -2);
        runs.push(
          new TextRun({
            text: inner,
            font: FONT_NAME,
            size,
            bold: true,
            italics: baseItalics,
            color,
          })
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        const inner = token.slice(1, -1);
        runs.push(
          new TextRun({
            text: inner,
            font: FONT_NAME,
            size,
            bold: baseBold,
            italics: true,
            color,
          })
        );
      } else if (token.startsWith('`') && token.endsWith('`')) {
        const inner = token.slice(1, -1);
        runs.push(
          new TextRun({
            text: inner,
            font: 'Consolas',
            size: size - 2,
            bold: baseBold,
            italics: baseItalics,
            color,
          })
        );
      }

      lastIdx = tokenRegex.lastIndex;
    }

    if (lastIdx < line.length) {
      const tail = line.slice(lastIdx);
      if (tail) {
        runs.push(
          new TextRun({
            text: tail,
            font: FONT_NAME,
            size,
            bold: baseBold,
            italics: baseItalics,
            color,
          })
        );
      }
    }
  });

  if (runs.length === 0) {
    runs.push(new TextRun({ text: '', font: FONT_NAME, size }));
  }

  return runs;
}

function buildCellParagraphs(
  cellContent: string,
  options?: { bold?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number }
): Paragraph[] {
  const parts = cellContent.split(/<br\s*\/?>|\n/gi);
  const paragraphs: Paragraph[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '' && parts.length > 1) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 0, after: 40, line: 260 },
          alignment: options?.alignment ?? AlignmentType.LEFT,
          children: [new TextRun({ text: '', font: FONT_NAME, size: options?.size ?? BASE_SIZE })],
        })
      );
      continue;
    }

    paragraphs.push(
      new Paragraph({
        spacing: { before: 20, after: 40, line: 276 },
        alignment: options?.alignment ?? AlignmentType.LEFT,
        children: parseInlineRuns(trimmed, {
          baseBold: options?.bold,
          size: options?.size ?? BASE_SIZE,
        }),
      })
    );
  }

  return paragraphs.length > 0
    ? paragraphs
    : [new Paragraph({ children: [new TextRun({ text: '', font: FONT_NAME, size: BASE_SIZE })] })];
}

function buildWordTableFromRows(
  rows: string[][],
  options: { isHeaderLayout: boolean; isSignature: boolean }
): Table {
  const colCount = Math.max(...rows.map((r) => r.length), 1);

  // Detect 2-column answer key table (| Nội dung | Điểm |)
  const firstRowText = (rows[0] || []).join(' ').toLowerCase();
  const isAnswerScoreTable =
    !options.isHeaderLayout &&
    !options.isSignature &&
    colCount === 2 &&
    (firstRowText.includes('nội dung') || firstRowText.includes('điểm'));

  const getColWidth = (colIdx: number) => {
    if (options.isHeaderLayout && colCount === 2) {
      return colIdx === 0 ? 45 : 55;
    }
    if (isAnswerScoreTable) {
      return colIdx === 0 ? 82 : 18;
    }
    return Math.floor(100 / colCount);
  };

  const tableRows = rows.map((cells, rowIndex) => {
    const isFirstHeaderRow = !options.isHeaderLayout && !options.isSignature && rowIndex === 0;
    const normalizedCells = [...cells];
    while (normalizedCells.length < colCount) {
      normalizedCells.push('');
    }

    return new TableRow({
      ...(isFirstHeaderRow ? { tableHeader: true } : {}),
      children: normalizedCells.map((rawCell, colIdx) => {
        let cellText = rawCell.trim();
        if (options.isSignature && cellText === '---') {
          cellText = '';
        }

        const align =
          options.isSignature || options.isHeaderLayout
            ? AlignmentType.CENTER
            : isAnswerScoreTable && colIdx === 1
            ? AlignmentType.CENTER
            : AlignmentType.LEFT;

        const isBorderless = options.isHeaderLayout || options.isSignature;

        return new TableCell({
          width: { size: getColWidth(colIdx), type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.TOP,
          borders: isBorderless ? NONE_TABLE_BORDERS : undefined,
          shading: isFirstHeaderRow
            ? { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' }
            : undefined,
          margins: isBorderless
            ? { top: 40, bottom: 40, left: 80, right: 80 }
            : { top: 80, bottom: 80, left: 100, right: 100 },
          children: buildCellParagraphs(cellText, {
            bold: isFirstHeaderRow,
            alignment: align,
            size: isBorderless ? 24 : 22,
          }),
        });
      }),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: options.isHeaderLayout || options.isSignature ? NONE_TABLE_BORDERS : DATA_TABLE_BORDERS,
    rows: tableRows,
  });
}

function parseHtmlTableToWordTable(tableHtml: string): Table | null {
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length === 0) return null;

  const parsedRows: string[][] = [];
  for (const rm of rowMatches) {
    const cellMatches = [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cellMatches.length > 0) {
      parsedRows.push(cellMatches.map((cm) => cm[1].trim()));
    }
  }

  if (parsedRows.length === 0) return null;

  const lower = tableHtml.toLowerCase();
  const isBorderNone = lower.includes('border: none') || lower.includes('border:none');
  const isSig =
    isBorderNone ||
    lower.includes('cán bộ chấm thi') ||
    lower.includes('giám khảo') ||
    lower.includes('trưởng bộ môn') ||
    lower.includes('giảng viên');

  return buildWordTableFromRows(parsedRows, {
    isHeaderLayout: isBorderNone && !isSig,
    isSignature: isSig,
  });
}

export async function generateWordDocxBlob(markdownContent: string): Promise<Blob> {
  const normalized = normalizeExamMarkdown(markdownContent || '');
  const safeContent = normalized.trim() || 'Không có nội dung';

  // Extract inline HTML <table>...</table> blocks first and replace with placeholders
  const extractedHtmlTables: Table[] = [];
  const contentWithTablePlaceholders = safeContent.replace(
    /<table[\s\S]*?<\/table>/gi,
    (match) => {
      const tbl = parseHtmlTableToWordTable(match);
      if (tbl) {
        const idx = extractedHtmlTables.length;
        extractedHtmlTables.push(tbl);
        return `\n@@HTML_TABLE_${idx}@@\n`;
      }
      return match;
    }
  );

  const lines = contentWithTablePlaceholders.split(/\r?\n/);
  const elements: (Paragraph | Table)[] = [];

  let inMdTable = false;
  let mdTableRows: string[][] = [];
  let isHeaderLayoutTable = false;
  let isSignatureTable = false;
  let lastWasPageBreak = false;

  const checkIsHeaderLayout = (row: string) => {
    const r = row.toUpperCase();
    return (
      r.includes('KHOA') ||
      r.includes('BỘ MÔN') ||
      r.includes('ĐỀ THI KẾT THÚC') ||
      r.includes('ĐÁP ÁN ĐỀ THI') ||
      r.includes('SUBJECT') ||
      r.includes('FACULTY') ||
      r.includes('DEPARTMENT')
    );
  };

  const checkIsSignature = (row: string) => {
    const r = row.toUpperCase();
    return r.includes('CÁN BỘ CHẤM THI') || r.includes('GIÁM KHẢO');
  };

  const checkIsDataTableHeader = (row: string) => {
    const r = row.toLowerCase();
    return (
      r.includes('nội dung') ||
      r.includes('điểm') ||
      r.includes('đáp án') ||
      r.includes('câu hỏi') ||
      r.includes('thang điểm') ||
      r.includes('câu / ý') ||
      r.includes('content') ||
      r.includes('score')
    );
  };

  const flushMdTable = () => {
    if (mdTableRows.length === 0) {
      inMdTable = false;
      isHeaderLayoutTable = false;
      isSignatureTable = false;
      return;
    }
    elements.push(
      buildWordTableFromRows(mdTableRows, {
        isHeaderLayout: isHeaderLayoutTable,
        isSignature: isSignatureTable,
      })
    );
    elements.push(
      new Paragraph({
        spacing: { before: 0, after: 100 },
        children: [],
      })
    );
    mdTableRows = [];
    inMdTable = false;
    isHeaderLayoutTable = false;
    isSignatureTable = false;
    lastWasPageBreak = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (inMdTable) flushMdTable();
      continue;
    }

    // Extracted HTML table placeholder
    const htmlTableMatch = trimmed.match(/^@@HTML_TABLE_(\d+)@@$/);
    if (htmlTableMatch) {
      if (inMdTable) flushMdTable();
      const tbl = extractedHtmlTables[Number(htmlTableMatch[1])];
      if (tbl) {
        elements.push(
          new Paragraph({ spacing: { before: 160, after: 0 }, children: [] })
        );
        elements.push(tbl);
        lastWasPageBreak = false;
      }
      continue;
    }

    // Page breaks
    if (
      trimmed.includes('word-page-break') ||
      trimmed.includes('page-break') ||
      trimmed === '---'
    ) {
      if (inMdTable) flushMdTable();
      const hasMoreContent = lines
        .slice(i + 1)
        .some((l) => {
          const t = l.trim();
          return t !== '' && !t.includes('word-page-break') && !t.includes('page-break') && t !== '---';
        });
      if (hasMoreContent && !lastWasPageBreak && elements.length > 0) {
        elements.push(new Paragraph({ children: [new PageBreak()] }));
        lastWasPageBreak = true;
      }
      continue;
    }

    lastWasPageBreak = false;

    // Skip standalone separator rows even if leading pipe was omitted
    const isSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(trimmed);
    if (isSeparator) {
      continue;
    }

    // Markdown table rows
    if (trimmed.startsWith('|')) {
      if (inMdTable && isHeaderLayoutTable && checkIsDataTableHeader(trimmed)) {
        flushMdTable();
      }

      if (!inMdTable) {
        inMdTable = true;
        isHeaderLayoutTable = checkIsHeaderLayout(trimmed);
        isSignatureTable = checkIsSignature(trimmed);
      }

      const cells = trimmed.split('|');
      if (cells.length > 0 && cells[0].trim() === '') cells.shift();
      if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
      if (cells.length > 0) {
        // For a 2-column header layout row, only take the 2 header cells
        if (isHeaderLayoutTable && cells.length > 2) {
          mdTableRows.push(cells.slice(0, 2));
        } else {
          mdTableRows.push(cells);
        }
      }
      continue;
    }

    if (inMdTable) {
      flushMdTable();
    }

    // Centered blocks like <center><h3>ĐỀ SỐ 1</h3></center>
    if (/^<center>/i.test(trimmed)) {
      const inner = trimmed.replace(/<\/?center>/gi, '').trim();
      const isHeading = /<h[1-6]/i.test(inner);
      const cleanInner = inner.replace(/<\/?h[1-6][^>]*>/gi, '').trim();
      elements.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 120, line: 276 },
          children: parseInlineRuns(cleanInner, {
            baseBold: isHeading || true,
            size: isHeading ? 28 : 24,
          }),
        })
      );
      continue;
    }

    // Standalone <br> / <br/>
    if (/^<br\s*\/?>$/i.test(trimmed)) {
      elements.push(new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }));
      continue;
    }

    // Markdown Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const size = level === 1 ? 30 : level === 2 ? 28 : 26;
      const isCentered =
        level === 1 ||
        headingText.toUpperCase().includes('PHIẾU CHẤM') ||
        /^ĐỀ SỐ\s*\d+/i.test(headingText) ||
        /^ĐÁP ÁN ĐỀ SỐ\s*\d+/i.test(headingText);
      elements.push(
        new Paragraph({
          alignment: isCentered ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 180, after: 100, line: 276 },
          children: parseInlineRuns(headingText, { baseBold: true, size }),
        })
      );
      continue;
    }

    // HTML Headings (<h1>..<h3>)
    const htmlHeadingMatch = trimmed.match(/^<h([1-4])[^>]*>([\s\S]*?)<\/h\1>$/i);
    if (htmlHeadingMatch) {
      const level = Number(htmlHeadingMatch[1]);
      const size = level === 1 ? 30 : level === 2 ? 28 : 26;
      const cleanText = htmlHeadingMatch[2].trim();
      const isCentered =
        /^ĐỀ SỐ\s*\d+/i.test(cleanText) || /^ĐÁP ÁN ĐỀ SỐ\s*\d+/i.test(cleanText);
      elements.push(
        new Paragraph({
          alignment: isCentered ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 160, after: 100, line: 276 },
          children: parseInlineRuns(cleanText, { baseBold: true, size }),
        })
      );
      continue;
    }

    // Bullet lists (- ... or * ...)
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      elements.push(
        new Paragraph({
          indent: { left: 360, hanging: 180 },
          spacing: { before: 40, after: 60, line: 276 },
          children: [
            new TextRun({ text: '•  ', font: FONT_NAME, size: BASE_SIZE }),
            ...parseInlineRuns(bulletMatch[1]),
          ],
        })
      );
      continue;
    }

    // Auto-bold "Câu X (...):" or "Bài X (...):" prefix if AI omitted **
    let formattedLine = trimmed;
    if (!formattedLine.startsWith('**')) {
      formattedLine = formattedLine.replace(
        /^((?:Câu|Bài)\s+\d+(?:\s*\([^)]+\))?\s*[:.])\s*/i,
        '**$1** '
      );
    }

    const isCenteredTitle =
      /^(\*\*)?(ĐỀ SỐ\s*\d+|ĐÁP ÁN ĐỀ SỐ\s*\d+)(\*\*)?$/i.test(formattedLine);

    elements.push(
      new Paragraph({
        alignment: isCenteredTitle ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 60, after: 100, line: 276 },
        children: parseInlineRuns(formattedLine, {
          baseBold: isCenteredTitle,
          size: isCenteredTitle ? 28 : BASE_SIZE,
        }),
      })
    );
  }

  if (inMdTable) {
    flushMdTable();
  }

  if (elements.length === 0) {
    elements.push(
      new Paragraph({
        children: [new TextRun({ text: safeContent, font: FONT_NAME, size: BASE_SIZE })],
      })
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_NAME,
            size: BASE_SIZE,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1134, // ~2cm
              bottom: 1134,
              left: 1417, // ~2.5cm
              right: 1134,
            },
          },
        },
        children: elements,
      },
    ],
  });

  return await Packer.toBlob(doc);
}
