// Helper for extracting text from diverse document formats (DOCX, TXT, MD, CSV, etc.)
// Uses mammoth for client-side .docx parsing and pdfjs-dist for client-side PDF text + page image rendering
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

let mammothModule: any = null;

const loadMammoth = async () => {
  if (!mammothModule) {
    try {
      const mod = await import('mammoth');
      mammothModule = mod.default || mod;
    } catch (e) {
      console.warn("Could not import mammoth:", e);
    }
  }
  return mammothModule;
};

// In-memory cache for extracted file text to prevent re-extracting during multi-student grading
const fileContentCache = new WeakMap<File, Promise<{
  type: 'text' | 'image' | 'pdf' | 'binary';
  text?: string;
  base64?: string;
  mimeType: string;
}>>();

const pdfOllamaCache = new Map<string, Promise<{
  text: string;
  images: string[];
  headerImages: string[];
  pageCount: number;
}>>();

const reconstructPdfPageText = (items: any[]): string => {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines: string[] = [];
  let currentLine = '';
  let prevY: number | null = null;
  let prevEndX: number | null = null;
  let prevFontSize = 10;

  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const fontSize = transform
      ? Math.max(6, Math.hypot(transform[0] || 0, transform[1] || 0) || Math.abs(transform[3] || 0) || 10)
      : prevFontSize;
    const x = transform ? Number(transform[4]) : null;
    const y = transform ? Number(transform[5]) : null;
    const width = typeof item.width === 'number' ? item.width : str.length * fontSize * 0.45;

    if (prevY !== null && y !== null && Math.abs(y - prevY) > Math.max(3, fontSize * 0.45)) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = str;
      prevY = y;
      prevEndX = x !== null ? x + width : null;
      prevFontSize = fontSize;
      continue;
    }

    if (currentLine.length > 0 && x !== null && prevEndX !== null) {
      const gap = x - prevEndX;
      if (gap > fontSize * 3.0 && !currentLine.endsWith('|') && str.trim()) {
        currentLine += ' | ' + str;
      } else if (gap > Math.max(1.2, fontSize * 0.18) && !/\s$/.test(currentLine) && !/^\s/.test(str)) {
        currentLine += ' ' + str;
      } else {
        currentLine += str;
      }
    } else {
      currentLine += str;
    }

    if (item.hasEOL) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = '';
      prevY = null;
      prevEndX = null;
    } else {
      if (y !== null) prevY = y;
      if (x !== null) prevEndX = x + width;
      prevFontSize = fontSize;
    }
  }

  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
};

const renderRightPhachCropUpright = (srcCanvas: HTMLCanvasElement): string | null => {
  try {
    if (typeof document === 'undefined' || srcCanvas.width < 100 || srcCanvas.height < 100) return null;
    // Standard Vietnamese exam sheets print Phách (Họ tên, Lớp, SBD) vertically along the right ~36% margin, rotated 90° clockwise.
    // Rotating that right strip -90° (counter-clockwise) restores text upright left-to-right.
    const sx = Math.floor(srcCanvas.width * 0.62);
    const sw = srcCanvas.width - sx;
    const sh = srcCanvas.height;
    if (sw <= 20 || sh <= 20) return null;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sh;
    cropCanvas.height = sw;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return null;

    cropCtx.fillStyle = '#FFFFFF';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.translate(0, cropCanvas.height);
    cropCtx.rotate(-Math.PI / 2);
    cropCtx.drawImage(srcCanvas, sx, 0, sw, sh, 0, 0, sw, sh);

    const dataUrl = cropCanvas.toDataURL('image/jpeg', 0.9);
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  } catch (err) {
    console.warn('Could not create upright phach crop:', err);
    return null;
  }
};

export const extractPortraitPhachImageCrop = async (file: File): Promise<string | null> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name)) return null;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.height <= img.width) {
        resolve(null);
        return;
      }
      const targetMax = 1600;
      const scale = Math.min(1, targetMax / Math.max(img.width, img.height, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(renderRightPhachCropUpright(canvas));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
};

export const extractPdfForOllama = async (
  file: File,
  maxRenderPages = 5,
  onlyRenderIfNoText = false
): Promise<{ text: string; images: string[]; headerImages: string[]; pageCount: number }> => {
  const cacheKey = `${file.name}:${file.size}:${file.lastModified}:${maxRenderPages}:${onlyRenderIfNoText ? 1 : 0}:v2`;
  const existing = pdfOllamaCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages || 0;

    const textParts: string[] = [];
    const pages: any[] = [];
    const maxTextPages = Math.min(pageCount, 20);

    for (let p = 1; p <= maxTextPages; p++) {
      const page = await pdf.getPage(p);
      pages.push(page);
      try {
        const textContent = await page.getTextContent();
        const pageText = reconstructPdfPageText(textContent.items || []);
        if (pageText) {
          textParts.push(`[Trang ${p}]:\n${pageText}`);
        }
      } catch (txtErr) {
        console.warn(`Could not extract text from page ${p} of ${file.name}:`, txtErr);
      }
    }

    const combinedText = textParts.join('\n').trim();
    const images: string[] = [];
    const headerImages: string[] = [];
    const shouldRenderImages = !onlyRenderIfNoText || combinedText.length < 80;

    if (shouldRenderImages && typeof document !== 'undefined') {
      const renderLimit = Math.min(pages.length, maxRenderPages);
      for (let i = 0; i < renderLimit; i++) {
        const page = pages[i];
        try {
          const baseViewport = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseViewport.width, baseViewport.height, 1);
          // Render Page 1 slightly higher (1500px) to preserve handwritten formulas and Phách header details
          const targetMax = i === 0 && !onlyRenderIfNoText ? 1500 : 1200;
          const scale = Math.min(2.5, Math.max(1.0, targetMax / maxDim));
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

            // On Page 1 of student submissions, extract upright rotated right-strip Phách header
            if (i === 0 && !onlyRenderIfNoText && canvas.height > canvas.width) {
              const phachB64 = renderRightPhachCropUpright(canvas);
              if (phachB64) headerImages.push(phachB64);
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            if (b64) images.push(b64);
          }
        } catch (renderErr) {
          console.warn(`Could not render page ${i + 1} of ${file.name} for Ollama:`, renderErr);
        }
      }
    }

    return {
      text: combinedText,
      images,
      headerImages,
      pageCount,
    };
  })();

  pdfOllamaCache.set(cacheKey, promise);
  return promise;
};


export const extractFileContent = async (file: File): Promise<{
  type: 'text' | 'image' | 'pdf' | 'binary';
  text?: string;
  base64?: string;
  mimeType: string;
}> => {
  if (fileContentCache.has(file)) {
    return fileContentCache.get(file)!;
  }

  const promise = doExtractFileContent(file);
  fileContentCache.set(file, promise);
  return promise;
};

const doExtractFileContent = async (file: File): Promise<{
  type: 'text' | 'image' | 'pdf' | 'binary';
  text?: string;
  base64?: string;
  mimeType: string;
}> => {
  const fileName = file.name.toLowerCase();
  const fileType = file.type || '';


  // 1. DOCX files (.docx)
  if (fileName.endsWith('.docx') || fileName.endsWith('.doc') || fileType.includes('word') || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Attempt 1: Call server-side /api/parse-document with base64 (always has full Node Buffer mammoth access)
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/parse-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text && data.text.trim().length > 0) {
          return {
            type: 'text',
            text: data.text.trim(),
            mimeType: 'text/plain',
          };
        }
      }
    } catch (serverErr) {
      console.warn("Server-side docx parsing failed, trying client-side:", serverErr);
    }

    // Attempt 2: Try client-side mammoth with table-preserving convertToHtml
    try {
      const mammoth = await loadMammoth();
      const convertToHtml = mammoth?.convertToHtml || mammoth?.default?.convertToHtml;
      if (typeof convertToHtml === 'function') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await convertToHtml({ arrayBuffer });
        const html = result?.value || '';
        if (html.length > 0) {
          const structured = html
            .replace(/<tr\b[^>]*>/gi, "\n| ")
            .replace(/<\/td>|<\/th>/gi, " | ")
            .replace(/<\/tr>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<h[1-6]\b[^>]*>/gi, "\n### ")
            .replace(/<\/h[1-6]>/gi, "\n")
            .replace(/<li\b[^>]*>/gi, "\n- ")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&nbsp;/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          if (structured.length > 0) {
            return {
              type: 'text',
              text: structured,
              mimeType: 'text/plain'
            };
          }
        }
      }
      
      const extractRawText = mammoth?.extractRawText || mammoth?.default?.extractRawText;
      if (typeof extractRawText === 'function') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await extractRawText({ arrayBuffer });
        if (result && result.value && result.value.trim().length > 0) {
          return {
            type: 'text',
            text: result.value.trim(),
            mimeType: 'text/plain'
          };
        }
      }
    } catch (docxErr) {
      console.warn("Client mammoth error:", docxErr);
    }
  }


  // 2. Plain text and markup files
  if (
    fileType.startsWith('text/') ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.md') ||
    fileName.endsWith('.json') ||
    fileName.endsWith('.csv') ||
    fileName.endsWith('.tsv') ||
    fileName.endsWith('.xml') ||
    fileName.endsWith('.html') ||
    fileName.endsWith('.htm')
  ) {
    try {
      const text = await file.text();
      return {
        type: 'text',
        text,
        mimeType: fileType || 'text/plain'
      };
    } catch (textErr) {
      console.warn("Failed to read as plain text:", textErr);
    }
  }

  // 3. Images (JPEG, PNG, WebP, HEIC, etc.) - automatically compress high-res phone photos to fast 1600px
  if (fileType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(fileName)) {
    const { base64, mimeType } = await compressImageFile(file);
    return {
      type: 'image',
      base64,
      mimeType,
    };
  }

  // 4. PDF documents
  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
    const base64 = await fileToBase64(file);
    return {
      type: 'pdf',
      base64,
      mimeType: 'application/pdf'
    };
  }

  // 5. Fallback: try reading text, else base64
  try {
    const text = await file.text();
    // Check if it looks like UTF-8 readable text without null bytes
    if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
      return {
        type: 'text',
        text,
        mimeType: 'text/plain'
      };
    }
  } catch {
    // ignore
  }

  const base64 = await fileToBase64(file);
  return {
    type: 'binary',
    base64,
    mimeType: fileType || 'application/octet-stream'
  };
};

export const compressImageFile = async (
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<{ base64: string; mimeType: string }> => {
  // If not running in browser environment or file is already small (< 300KB), don't compress
  if (typeof window === 'undefined' || file.size < 300 * 1024) {
    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type || 'image/jpeg' };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      // Only resize if larger than maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        fileToBase64(file).then((base64) => resolve({ base64, mimeType: file.type || 'image/jpeg' }));
        return;
      }

      // Draw background white for transparent PNGs
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve({ base64, mimeType: 'image/jpeg' });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      fileToBase64(file).then((base64) => resolve({ base64, mimeType: file.type || 'image/jpeg' }));
    };

    img.src = objectUrl;
  });
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64String = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
