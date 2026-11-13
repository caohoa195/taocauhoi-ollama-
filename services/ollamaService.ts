import { ExamConfig, GradingConfig, GeneratedContent, OllamaConfig } from "../types";
import { extractFileContent, extractPdfForOllama, extractPortraitPhachImageCrop } from "./fileUtils";
import {
  buildExamMetaAndPrompt,
  buildGradingUserPrompt,
  extractDeterministicRubricFromText,
  formatExamFromVariants,
  formatGradingFeedbackFromStructured,
  getExamSystemInstruction,
  sanitizeStudentField,
  StructuredGradedStudent,
  synchronizeStudentScores,
} from "../utils/examHelpers";

export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
  source?: 'browser' | 'proxy';
}

const OLLAMA_EXAM_SCHEMA = {
  type: 'object',
  required: ['variants'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        required: ['variantNumber', 'questions', 'answerRows'],
        properties: {
          variantNumber: { type: 'integer' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['questionLabel', 'questionContent'],
              properties: {
                sectionTitle: { type: 'string' },
                questionLabel: { type: 'string' },
                questionContent: { type: 'string' },
              },
            },
          },
          answerRows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['content', 'points'],
              properties: {
                content: { type: 'string' },
                points: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const OLLAMA_RUBRIC_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'maxScore'],
        properties: {
          question: { type: 'string' },
          maxScore: { type: 'number' },
          expectedAnswer: { type: 'string' },
        },
      },
    },
  },
};

const OLLAMA_GRADING_SCHEMA = {
  type: 'object',
  required: ['students'],
  properties: {
    students: {
      type: 'array',
      items: {
        type: 'object',
        required: ['studentName', 'questionRows'],
        properties: {
          studentName: { type: 'string' },
          studentId: { type: 'string' },
          className: { type: 'string' },
          examCode: { type: 'string' },
          questionRows: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'question',
                'expectedAnswer',
                'studentAnswer',
                'isFinalCorrect',
                'gradingMethod',
                'maxScore',
                'earnedScore',
                'comment',
              ],
              properties: {
                question: { type: 'string' },
                requirement: { type: 'string' },
                expectedAnswer: { type: 'string' },
                studentAnswer: { type: 'string' },
                isFinalCorrect: {
                  type: 'string',
                  enum: ['Đúng', 'Sai', 'Thiếu', 'Không làm'],
                },
                gradingMethod: {
                  type: 'string',
                  enum: ['Trọn điểm (Đúng KQ cuối)', 'Chấm thành phần (Sai KQ cuối)', 'Bỏ trống'],
                },
                maxScore: { type: 'number' },
                earnedScore: { type: 'number' },
                comment: { type: 'string' },
              },
            },
          },
          strengths: { type: 'string' },
          weaknesses: { type: 'string' },
        },
      },
    },
  },
};

const OLLAMA_GRADING_SYSTEM_INSTRUCTION = `Bạn là Giám khảo Chấm thi Đại học công tâm, chính xác và ổn định tuyệt đối (DETERMINISTIC).
Nhiệm vụ của bạn là đọc ảnh/nội dung bài làm thí sinh, đối chiếu với đề bài và đáp án chuẩn, rồi điền dữ liệu JSON có cấu trúc.

QUY TẮC BẮT BUỘC:
1. ĐỌC THÔNG TIN THÍ SINH (PHÁCH & TRANG ĐẦU):
   - Nếu có "Ảnh PHÁCH đã xoay thẳng đứng", hãy đọc KỸ chữ viết tay ở mục "Họ và tên:" (studentName), "Lớp:" (className), "Số báo danh / MSSV:" (studentId), "Mã đề:" (examCode).
   - Trả về đúng Họ tên thật viết tay (ví dụ "Ngô Quang Huy", lớp "ĐHCN7"). Nếu thực sự không có chỗ ghi tên hoặc không đọc được, trả về chuỗi rỗng "" (TUYỆT ĐỐI KHÔNG tự viết chữ "Không xác định được").
2. CỐ ĐỊNH BAREM 10.0 ĐIỂM (KHÔNG ĐƯỢC BỎ SÓT CÂU):
   - Phải tạo ĐẦY ĐỦ 1 phần tử trong "questionRows" cho MỌI câu / ý có trong đề thi và barem (tổng maxScore = 10.0).
   - TUYỆT ĐỐI KHÔNG bỏ qua các câu thí sinh không làm rồi dồn điểm lên 10.0 cho các câu đã làm.
3. KIỂM TRA TỪNG TRANG BÀI LÀM & CHỐNG CHẤM NHẦM 10/10:
   - Trước khi cho điểm từng câu, viết rõ "expectedAnswer" (đáp án chuẩn) và "studentAnswer" (những gì thí sinh thực sự viết trong các ảnh trang bài làm).
   - BỎ TRỐNG / KHÔNG LÀM: Nếu trong bài làm hoàn toàn không thấy lời giải của câu đó (hoặc chỉ chép lại đề/tên câu rồi để trống), BẮT BUỘC ghi studentAnswer = "Bỏ trống", isFinalCorrect = "Không làm", gradingMethod = "Bỏ trống", earnedScore = 0.
   - ĐÚNG KẾT QUẢ CUỐI: Chỉ đặt isFinalCorrect = "Đúng" và cho earnedScore = maxScore khi thí sinh có lời giải hợp lý VÀ kết quả cuối cùng đúng với đáp án chuẩn (kể cả đúng đơn vị/bản chất).
   - SAI / THIẾU KẾT QUẢ CUỐI: Đặt isFinalCorrect = "Sai" hoặc "Thiếu", gradingMethod = "Chấm thành phần (Sai KQ cuối)", và chấm điểm thành phần từng bước đúng (earnedScore phải NHỎ HƠN maxScore, bước 0.25đ).`;

const rubricExtractionCache = new Map<string, string>();

const normalizeOllamaUrl = (rawUrl?: string): string => {
  let u = (rawUrl || 'http://localhost:11434').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  return u;
};

const stripThinkingAndParseJson = (raw: string): any => {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const cleaned = withoutThink
    .replace(/^```json\s*/gi, '')
    .replace(/^```\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Phản hồi từ Ollama không đúng định dạng JSON.');
  }
};

const isVisionUnsupportedError = (msg: string): boolean => {
  const lower = (msg || '').toLowerCase();
  return (
    lower.includes('does not support image') ||
    lower.includes('missing data required for image') ||
    lower.includes('unsupported image') ||
    lower.includes('no multimodal') ||
    lower.includes('vision is not supported') ||
    lower.includes('image input is not supported') ||
    lower.includes('projector')
  );
};

const isSchemaOrThinkUnsupportedError = (msg: string): boolean => {
  const lower = (msg || '').toLowerCase();
  if (!lower.includes('ollama lỗi (400)') && !lower.includes('(400)') && !lower.includes('unmarshal')) {
    return false;
  }
  return (
    lower.includes('format') ||
    lower.includes('think') ||
    lower.includes('schema') ||
    lower.includes('unmarshal') ||
    lower.includes('unknown field')
  );
};

// Test connection to Ollama
export const checkOllamaConnection = async (
  baseUrl: string = 'http://localhost:11434',
  mode: 'browser' | 'proxy' = 'browser'
): Promise<OllamaConnectionResult> => {
  const cleanUrl = normalizeOllamaUrl(baseUrl);

  // 1. Try specified mode
  if (mode === 'browser') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${cleanUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        return { ok: true, models, source: 'browser' };
      }
    } catch (browserErr: any) {
      console.warn("Direct browser connection to Ollama failed, attempting server proxy fallback...", browserErr);
    }
  }

  // 2. Try proxy mode (via server /api/ollama/tags)
  try {
    const res = await fetch(`/api/ollama/tags?url=${encodeURIComponent(cleanUrl)}`);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, models: data.models || [], source: 'proxy' };
    }
    const errData = await res.json().catch(() => ({}));
    return {
      ok: false,
      models: [],
      error: errData.error || `Không thể kết nối tới Ollama tại ${cleanUrl}`,
    };
  } catch {
    return {
      ok: false,
      models: [],
      error: `Không thể kết nối tới ${cleanUrl}. Vui lòng đảm bảo Ollama đang chạy (ví dụ: gõ 'ollama serve' trong Terminal). Nếu kết nối trực tiếp từ trình duyệt, cấu hình OLLAMA_ORIGINS="*" để cho phép CORS.`,
    };
  }
};

// Send request to Ollama (via browser or proxy) with smart backward-compat & text fallback
const callOllamaApi = async (
  ollamaConfig: OllamaConfig,
  endpoint: '/api/chat' | '/api/generate',
  body: any,
  canFallbackWithoutImages = false
): Promise<any> => {
  const cleanUrl = normalizeOllamaUrl(ollamaConfig.baseUrl);
  const isLocalhost = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1') || cleanUrl.includes('[::1]');

  const doSend = async (payloadToSend: any) => {
    if (ollamaConfig.connectionMode === 'browser' || isLocalhost) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min for local inference
        const response = await fetch(`${cleanUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadToSend),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama lỗi (${response.status}): ${errorText}`);
        }

        return await response.json();
      } catch (err: any) {
        console.warn("Direct browser call to Ollama failed:", err);
        const msg = err?.message || '';
        // If Ollama actually responded with HTTP error (not a network/CORS error), don't mask it as connection failure
        if (msg.startsWith('Ollama lỗi (')) {
          throw err;
        }
        if (isLocalhost) {
          throw new Error(
            `Không thể kết nối đến Ollama trên máy tính của bạn tại ${cleanUrl}.\n` +
            `Nguyên nhân: Ứng dụng Ollama chưa được mở hoặc trình duyệt chặn kết nối CORS.\n` +
            `Khắc phục: Mở Terminal gõ 'OLLAMA_ORIGINS="*" ollama serve', hoặc chuyển sang dùng 'Gemini Cloud'.`
          );
        }
      }
    }

    // Call via backend proxy (only suitable for remote servers / tunnels / ngrok)
    const proxyRes = await fetch('/api/ollama/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cleanUrl,
        endpoint,
        payload: payloadToSend,
      }),
    });

    if (!proxyRes.ok) {
      const errJson = await proxyRes.json().catch(() => ({}));
      throw new Error(errJson.error || `Lỗi khi gọi Ollama (${proxyRes.status})`);
    }

    return await proxyRes.json();
  };

  const executeWithFallbacks = async (payloadToTry: any, allowCompatDowngrade: boolean): Promise<any> => {
    try {
      return await doSend(payloadToTry);
    } catch (err: any) {
      const errMsg = err?.message || '';

      // Backward compatibility for older Ollama servers that reject JSON schema `format` or `think: false`
      const hasObjectFormatOrThink =
        (payloadToTry?.format && typeof payloadToTry.format === 'object') ||
        payloadToTry?.think !== undefined;
      if (allowCompatDowngrade && hasObjectFormatOrThink && isSchemaOrThinkUnsupportedError(errMsg)) {
        console.warn("Ollama server không hỗ trợ format schema hoặc tham số think, tự động chuyển về format: 'json'...");
        const { think: _omitThink, ...restPayload } = payloadToTry;
        const legacyPayload = {
          ...restPayload,
          format: 'json',
        };
        return await executeWithFallbacks(legacyPayload, false);
      }

      const hasImages =
        Array.isArray(payloadToTry?.messages) &&
        payloadToTry.messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0);
      if (hasImages && isVisionUnsupportedError(errMsg)) {
        if (canFallbackWithoutImages) {
          console.warn(`Model ${ollamaConfig.model} không hỗ trợ ảnh, tự động chuyển sang dùng văn bản trích xuất...`);
          const textOnlyBody = {
            ...payloadToTry,
            messages: payloadToTry.messages.map((m: any) => {
              const { images: _ignored, ...rest } = m;
              return rest;
            }),
          };
          return await doSend(textOnlyBody);
        }
        throw new Error(
          `Model Ollama "${ollamaConfig.model}" hiện không hỗ trợ đọc ảnh/PDF scan. Vui lòng chọn model hỗ trợ hình ảnh (như gemma4:e4b, gemma4:12b, qwen3.6:35b-a3b-q4, qwen2.5vl) hoặc tải lên file văn bản/Word.`
        );
      }
      throw err;
    }
  };

  return await executeWithFallbacks(body, true);
};

// Extract text and/or page images from any file (DOCX, TXT, Image, PDF) so Ollama sees full content cleanly
const appendFileForOllama = async (
  file: File,
  roleLabel: string,
  images: string[],
  options: { maxPdfRenderPages?: number; onlyRenderIfNoText?: boolean; includePhachCrop?: boolean } = {}
): Promise<{ textBlock: string; hasExtractedText: boolean; normalizedText: string; rawText: string }> => {
  const maxPdfRenderPages = options.maxPdfRenderPages ?? 5;
  const onlyRenderIfNoText = options.onlyRenderIfNoText ?? false;
  const includePhachCrop = options.includePhachCrop ?? false;
  const extracted = await extractFileContent(file);

  if (extracted.type === 'text' && extracted.text) {
    const trimmed = extracted.text.length > 25000
      ? extracted.text.slice(0, 25000) + '\n[Đã tối ưu trích xuất 25.000 ký tự đầu]'
      : extracted.text;
    return {
      textBlock: `\n--- [${roleLabel}] File: "${file.name}" ---\n${trimmed}\n`,
      hasExtractedText: trimmed.trim().length > 20,
      normalizedText: extracted.text.replace(/\s+/g, ' ').trim(),
      rawText: extracted.text,
    };
  }

  if (extracted.type === 'image' && extracted.base64) {
    let block = `\n--- [${roleLabel}] File ảnh: "${file.name}" ---\n`;
    if (includePhachCrop) {
      const phachB64 = await extractPortraitPhachImageCrop(file);
      if (phachB64) {
        images.push(phachB64);
        const phachIdx = images.length;
        block += `- Ảnh số ${phachIdx} là ẢNH PHÁCH ĐÃ XOAY THẲNG ĐỨNG (cạnh phải trang 1): BẮT BUỘC đọc Họ và tên (studentName), Lớp (className), SBD/MSSV (studentId), Mã đề (examCode) từ Ảnh số ${phachIdx}.\n`;
      }
    }
    images.push(extracted.base64);
    const imgIdx = images.length;
    block += `- Ảnh số ${imgIdx} là toàn bộ trang bài làm: hãy đọc kỹ toàn bộ chữ viết tay, công thức, khoanh tròn và đáp số trong Ảnh số ${imgIdx}.\n`;
    return {
      textBlock: block,
      hasExtractedText: false,
      normalizedText: '',
      rawText: '',
    };
  }

  if (extracted.type === 'pdf') {
    try {
      const pdfData = await extractPdfForOllama(file, maxPdfRenderPages, onlyRenderIfNoText);
      let block = `\n--- [${roleLabel}] Tài liệu PDF (${pdfData.pageCount} trang): "${file.name}" ---\n`;
      if (pdfData.text && pdfData.text.trim().length > 0) {
        const cleanPdfText = pdfData.text.length > 25000
          ? pdfData.text.slice(0, 25000) + '\n[Đã tối ưu trích xuất 25.000 ký tự đầu]'
          : pdfData.text;
        block += `Nội dung văn bản trích xuất từ PDF:\n${cleanPdfText}\n`;
      }
      if (includePhachCrop && pdfData.headerImages && pdfData.headerImages.length > 0) {
        for (const phachB64 of pdfData.headerImages) {
          images.push(phachB64);
          const phachIdx = images.length;
          block += `- Ảnh số ${phachIdx} là ẢNH PHÁCH ĐÃ XOAY THẲNG ĐỨNG (phần ghi tên bên phải Trang 1): BẮT BUỘC đọc chính xác Họ và tên thí sinh (studentName), Lớp (className), SBD/MSSV (studentId) từ Ảnh số ${phachIdx}.\n`;
        }
      }
      if (pdfData.images.length > 0) {
        const startIdx = images.length + 1;
        pdfData.images.forEach((b64) => images.push(b64));
        const endIdx = images.length;
        block += `- Các trang PDF từ Trang 1 đến Trang ${pdfData.images.length} tương ứng với Ảnh số ${startIdx} đến Ảnh số ${endIdx} (hãy đối chiếu kỹ từng câu bài làm trên tất cả các trang ảnh này).\n`;
      }
      return {
        textBlock: block,
        hasExtractedText: (pdfData.text || '').trim().length > 40,
        normalizedText: (pdfData.text || '').replace(/\s+/g, ' ').trim(),
        rawText: pdfData.text || '',
      };
    } catch (pdfErr) {
      console.warn(`Không thể phân tích PDF "${file.name}" cho Ollama:`, pdfErr);
    }
  }

  if (extracted.text) {
    return {
      textBlock: `\n--- [${roleLabel}] File: "${file.name}" ---\n${extracted.text}\n`,
      hasExtractedText: extracted.text.trim().length > 20,
      normalizedText: extracted.text.replace(/\s+/g, ' ').trim(),
      rawText: extracted.text,
    };
  }

  return {
    textBlock: `\n[${roleLabel}: "${file.name}"]\n`,
    hasExtractedText: false,
    normalizedText: '',
    rawText: '',
  };
};

// Pre-extract and anchor Master Rubric from the Answer Key / Exam Question BEFORE grading Student #1
const ensureMasterRubricForOllama = async (
  ollamaConfig: OllamaConfig,
  params: {
    existingMasterRubric?: string;
    answerKeyRawText?: string;
    examQuestionRawText?: string;
    answerKeyTextArg?: string;
    examQuestionTextArg?: string;
    referenceImages?: string[];
  }
): Promise<string> => {
  if (params.existingMasterRubric && params.existingMasterRubric.trim()) {
    return params.existingMasterRubric.trim();
  }

  // 1. Fast deterministic extraction from Answer Key or Exam Question text (zero LLM latency)
  const textCandidates = [
    params.answerKeyTextArg,
    params.answerKeyRawText,
    params.examQuestionTextArg,
    params.examQuestionRawText,
  ].filter((t): t is string => Boolean(t && t.trim()));

  for (const txt of textCandidates) {
    const det = extractDeterministicRubricFromText(txt);
    if (det) {
      return det;
    }
  }

  // 2. Fallback: 1-shot Ollama rubric extraction cached by reference signature
  const combinedRefText = textCandidates.join('\n\n').slice(0, 12000).trim();
  const refImgs = params.referenceImages || [];
  if (!combinedRefText && refImgs.length === 0) {
    return '';
  }

  const cacheKey = `${ollamaConfig.model}:${combinedRefText.slice(0, 500)}:${combinedRefText.length}:${refImgs.length}`;
  const cached = rubricExtractionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const payload = {
      model: ollamaConfig.model,
      messages: [
        {
          role: 'system',
          content:
            'Trích xuất danh sách cố định tất cả các câu/ý và thang điểm tối đa (tổng = 10.0 điểm) từ đề bài / đáp án chuẩn bên dưới. Trả về đúng JSON schema.',
        },
        {
          role: 'user',
          content: `Hãy liệt kê đầy đủ mọi câu/ý (vd: Câu 1a, Câu 1b...) cùng điểm tối đa (maxScore) và đáp án ngắn gọn (expectedAnswer) sao cho tổng maxScore = 10.0:\n\n${combinedRefText}`,
          ...(refImgs.length > 0 ? { images: refImgs.slice(0, 3) } : {}),
        },
      ],
      stream: false,
      think: false,
      keep_alive: '10m',
      format: OLLAMA_RUBRIC_SCHEMA,
      options: {
        temperature: 0.0,
        seed: 42,
        top_k: 1,
        repeat_penalty: 1.0,
        num_ctx: 8192,
        num_predict: 1024,
      },
    };

    const data = await callOllamaApi(ollamaConfig, '/api/chat', payload, combinedRefText.length > 40);
    const raw = data?.message?.content || data?.response || '';
    if (raw) {
      const parsed = stripThinkingAndParseJson(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const valid = items.filter((it: any) => it?.question && Number(it?.maxScore) > 0);
      const total = valid.reduce((acc: number, it: any) => acc + Number(it.maxScore), 0);
      if (valid.length >= 2 && total >= 9.0 && total <= 10.5) {
        const formatted = valid
          .map((it: any) => `- ${String(it.question).trim()}: Thang điểm tối đa ${Number(it.maxScore)}`)
          .join('\n');
        rubricExtractionCache.set(cacheKey, formatted);
        return formatted;
      }
    }
  } catch (err) {
    console.warn('Không thể trích xuất barem tự động trước chấm bài:', err);
  }

  return '';
};

export const generateExamContentOllama = async (
  config: ExamConfig,
  ollamaConfig: OllamaConfig
): Promise<GeneratedContent> => {
  const images: string[] = [];
  let attachedText = '';
  let allFilesHaveText = true;

  if (config.sourceFiles && config.sourceFiles.length > 0) {
    for (const file of config.sourceFiles) {
      // Source materials are text/reference docs: only render images if scanned PDF lacks text
      const res = await appendFileForOllama(file, 'TÀI LIỆU NGUỒN', images, {
        maxPdfRenderPages: 4,
        onlyRenderIfNoText: true,
      });
      attachedText += res.textBlock;
      if (!res.hasExtractedText) allFilesHaveText = false;
    }
    attachedText += `\nSử dụng ${config.sourceFiles.length} tài liệu đính kèm bên trên làm nguồn kiến thức chính để tạo câu hỏi.\n`;
  }

  const { examMeta, prompt, totalVariants } = buildExamMetaAndPrompt(config);
  const systemPrompt = `${getExamSystemInstruction(examMeta)}

BẮT BUỘC TRẢ VỀ DUY NHẤT MỘT CHUỖI JSON HỢP LỆ theo đúng cấu trúc schema sau (không giải thích thêm bên ngoài JSON):
{
  "variants": [
    {
      "variantNumber": 1,
      "questions": [
        {
          "sectionTitle": "Để trống hoặc ghi tên phần (vd: PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN)",
          "questionLabel": "Câu 1 (Nhận biết - 0.5 điểm):",
          "questionContent": "Nội dung chi tiết câu hỏi..."
        }
      ],
      "answerRows": [
        { "content": "**Câu 1 (0.5 điểm):**", "points": "" },
        { "content": "Nội dung đáp án / bước giải chi tiết", "points": "0.25" },
        { "content": "Bước tiếp theo / giải thích ngắn", "points": "0.25" }
      ]
    }
  ]
}
Lưu ý: Tạo ĐÚNG ${totalVariants} phần tử trong mảng "variants" (variantNumber từ 1 đến ${totalVariants}).`;

  const userPrompt = `${attachedText ? `TÀI LIỆU NGUỒN THAM KHẢO:\n${attachedText}\n` : ''}${prompt}`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: userPrompt,
      ...(images.length > 0 ? { images } : {}),
    },
  ];

  const payload = {
    model: ollamaConfig.model,
    messages,
    stream: false,
    think: false,
    keep_alive: '10m',
    format: OLLAMA_EXAM_SCHEMA,
    options: {
      temperature: 0.1,
      seed: 42,
      top_k: 1,
      repeat_penalty: 1.0,
      num_ctx: 16384,
      num_predict: 4096,
    },
  };

  let lastRawContent = '';
  let lastError: any = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await callOllamaApi(ollamaConfig, '/api/chat', payload, allFilesHaveText);
      const rawContent = data?.message?.content || data?.response || '';
      if (!rawContent) {
        throw new Error('Ollama không trả về nội dung hợp lệ.');
      }
      lastRawContent = rawContent;

      const parsed = stripThinkingAndParseJson(rawContent);
      if (Array.isArray(parsed?.variants) && parsed.variants.length > 0) {
        return formatExamFromVariants(parsed.variants, examMeta);
      }
      if (parsed?.questions && parsed?.answers) {
        return {
          questions: parsed.questions,
          answers: parsed.answers,
        };
      }
      throw new Error('JSON trả về thiếu mảng variants.');
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || '';
      // Do not retry fatal connection or unsupported-vision errors
      if (
        errMsg.includes('Không thể kết nối đến Ollama') ||
        errMsg.includes('hiện không hỗ trợ đọc ảnh')
      ) {
        throw err;
      }
      if (attempt === 0) {
        console.warn('Sinh đề Ollama lần 1 chưa hợp lệ, đang thử lại...', errMsg);
      }
    }
  }

  // Heuristic fallback only if we actually received raw text on the last attempt
  if (lastRawContent) {
    const cleanedRaw = lastRawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const matchQuestions = cleanedRaw.match(/"questions"\s*:\s*"([\s\S]*?)",\s*"answers"/);
    const matchAnswers = cleanedRaw.match(/"answers"\s*:\s*"([\s\S]*?)"\s*}/);
    if (matchQuestions && matchAnswers) {
      return {
        questions: matchQuestions[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        answers: matchAnswers[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      };
    }

    if (cleanedRaw.includes('ĐÁP ÁN') || cleanedRaw.includes('ĐÁP ÁN ĐỀ SỐ')) {
      const splitIndex = cleanedRaw.search(/(#+\s*ĐÁP ÁN|\|\s*\*\*ĐÁP ÁN|\*\*ĐÁP ÁN ĐỀ SỐ)/i);
      if (splitIndex > 0) {
        return {
          questions: cleanedRaw.substring(0, splitIndex).trim(),
          answers: cleanedRaw.substring(splitIndex).trim(),
        };
      }
    }

    return {
      questions: cleanedRaw,
      answers: "Vui lòng xem đáp án trong nội dung câu hỏi hoặc yêu cầu tạo lại.",
    };
  }

  throw lastError || new Error('Ollama không trả về nội dung hợp lệ.');
};

export const gradeSingleSubmissionOllama = async (
  submissionFile: File,
  answerKeyFile: File | null,
  gradingType: 'auto' | 'trac-nghiem' | 'tu-luan' | 'hon-hop' = 'auto',
  ollamaConfig: OllamaConfig,
  studentName?: string,
  options?: {
    examQuestionFile?: File | null;
    examQuestionText?: string;
    answerKeyText?: string;
    fastFinalResultGrading?: boolean;
    masterRubric?: string;
  }
): Promise<{
  students: any[];
  content: string;
  score: string;
  studentName: string;
  studentId?: string;
  className?: string;
  examCode?: string;
}> => {
  const images: string[] = [];
  const referenceImages: string[] = [];
  let extraText = '';
  let submissionHasText = true;
  let examNormalizedText = '';
  let examRawText = '';
  let answerKeyRawText = '';

  // 1. Extract submission FIRST (so Image 1 is the upright rotated Phách crop, followed by Pages 1..5)
  const subRes = await appendFileForOllama(submissionFile, 'TÀI LIỆU BÀI LÀM CỦA THÍ SINH', images, {
    maxPdfRenderPages: 5,
    onlyRenderIfNoText: false,
    includePhachCrop: true,
  });
  extraText += subRes.textBlock;
  submissionHasText = subRes.hasExtractedText;

  // 2. Extract Exam Question file & text
  if (options?.examQuestionFile) {
    const qRes = await appendFileForOllama(options.examQuestionFile, 'TỆP ĐỀ BÀI (ĐỀ THI GỐC)', referenceImages, {
      maxPdfRenderPages: 4,
      onlyRenderIfNoText: true,
    });
    extraText += qRes.textBlock;
    examNormalizedText = qRes.normalizedText;
    examRawText = qRes.rawText;
    referenceImages.forEach((b64) => images.push(b64));
  }

  if (options?.examQuestionText && options.examQuestionText.trim()) {
    extraText += `\n[NỘI DUNG ĐỀ BÀI (ĐỀ THI GỐC) ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${options.examQuestionText.trim()}\n`;
  }

  // 3. Extract Answer Key file (deduplicated against examQuestionFile) & text
  if (answerKeyFile) {
    const isSameMetadata =
      options?.examQuestionFile &&
      answerKeyFile.name === options.examQuestionFile.name &&
      answerKeyFile.size === options.examQuestionFile.size;

    if (isSameMetadata) {
      answerKeyRawText = examRawText;
      extraText += `\n--- [TỆP ĐÁP ÁN CHUẨN] File "${answerKeyFile.name}" ---\n(Trùng với tệp đề bài đã đính kèm — dùng cả phần đề và đáp án/hướng dẫn chấm trong tệp đó).\n`;
    } else {
      const tempImages: string[] = [];
      const kRes = await appendFileForOllama(answerKeyFile, 'TỆP ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐỐI CHIẾU', tempImages, {
        maxPdfRenderPages: 4,
        onlyRenderIfNoText: true,
      });
      answerKeyRawText = kRes.rawText;
      const isDuplicateText =
        Boolean(examNormalizedText) &&
        Boolean(kRes.normalizedText) &&
        kRes.normalizedText === examNormalizedText;

      if (isDuplicateText) {
        extraText += `\n--- [TỆP ĐÁP ÁN CHUẨN] File "${answerKeyFile.name}" ---\n(Nội dung trùng với tệp đề bài đã đính kèm).\n`;
      } else {
        extraText += kRes.textBlock;
        tempImages.forEach((b64) => {
          referenceImages.push(b64);
          images.push(b64);
        });
      }
    }
  }

  if (options?.answerKeyText && options.answerKeyText.trim()) {
    extraText += `\n[NỘI DUNG ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${options.answerKeyText.trim()}\n`;
  }

  // 4. Lock Master Rubric BEFORE grading even the 1st student
  const effectiveMasterRubric = await ensureMasterRubricForOllama(ollamaConfig, {
    existingMasterRubric: options?.masterRubric,
    answerKeyRawText,
    examQuestionRawText: examRawText,
    answerKeyTextArg: options?.answerKeyText,
    examQuestionTextArg: options?.examQuestionText,
    referenceImages,
  });

  if (effectiveMasterRubric) {
    extraText =
      `\n[BẢNG BAREM THANG ĐIỂM BẮT BUỘC DÙNG CHUNG — TỔNG 10.0 ĐIỂM]:\n${effectiveMasterRubric}\n` +
      `\nQUY TẮC BẮT BUỘC VỀ BAREM: Phải tạo đủ ĐÚNG các dòng trong "questionRows" khớp 100% các câu trên với đúng "maxScore". Câu nào không thấy thí sinh giải trong các trang bài làm -> studentAnswer: "Bỏ trống", isFinalCorrect: "Không làm", gradingMethod: "Bỏ trống", earnedScore: 0.\n` +
      extraText;
  }

  const fastRule = options?.fastFinalResultGrading !== false;
  const userGradingRequirements = buildGradingUserPrompt({
    submissionFileName: submissionFile.name,
    examQuestionFileName: options?.examQuestionFile?.name,
    answerKeyFileName: answerKeyFile?.name,
    gradingType,
    fastFinalResultGrading: fastRule,
  });

  const userPrompt = `${extraText}\n${userGradingRequirements}\n
BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON SAU (không viết thêm văn bản hay bảng Markdown bên ngoài):
{
  "students": [
    {
      "studentName": "Họ và tên viết tay trên PHÁCH/trang 1 (vd: Ngô Quang Huy; nếu thực sự không có ghi rỗng '')",
      "studentId": "MSSV hoặc SBD nếu có (nếu không ghi 'Không có')",
      "className": "Lớp nếu có (vd: ĐHCN7; nếu không ghi 'Không có')",
      "examCode": "Mã đề nếu có (vd: Đề 2; nếu không ghi 'Không có')",
      "questionRows": [
        {
          "question": "Câu 1a",
          "requirement": "Tìm phương trình quỹ đạo...",
          "expectedAnswer": "Elip x^2/16 + y^2/9 = 1",
          "studentAnswer": "x^2/16 + y^2/9 = 1, kết luận elip a=4m, b=3m (hoặc 'Bỏ trống' nếu không làm)",
          "isFinalCorrect": "Đúng",
          "gradingMethod": "Trọn điểm (Đúng KQ cuối)",
          "maxScore": 1.5,
          "earnedScore": 1.5,
          "comment": "Lời giải đúng phương pháp và kết quả cuối."
        }
      ],
      "strengths": "Tóm tắt ưu điểm chính của bài làm",
      "weaknesses": "Tóm tắt hạn chế / câu làm sai hoặc bỏ trống"
    }
  ]
}`;

  const messages: any[] = [
    { role: 'system', content: OLLAMA_GRADING_SYSTEM_INSTRUCTION },
    {
      role: 'user',
      content: userPrompt,
      ...(images.length > 0 ? { images } : {}),
    },
  ];

  const payload = {
    model: ollamaConfig.model,
    messages,
    stream: false,
    think: false,
    keep_alive: '10m',
    format: OLLAMA_GRADING_SCHEMA,
    options: {
      temperature: 0.0,
      seed: 42,
      top_k: 1,
      top_p: 1.0,
      repeat_penalty: 1.0,
      num_ctx: 16384,
      num_predict: 4096,
    },
  };

  const cleanFileBase = submissionFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
  const cleanPassedName = sanitizeStudentField(
    String(studentName || '').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim(),
    'name'
  );
  const defaultName = cleanPassedName || cleanFileBase || 'Thí sinh';

  let parsed: any = null;
  let lastRawContent = '';
  let lastError: any = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await callOllamaApi(ollamaConfig, '/api/chat', payload, submissionHasText);
      const rawContent = data?.message?.content || data?.response || '';
      if (!rawContent) {
        throw new Error('Ollama không phản hồi kết quả chấm thi.');
      }
      lastRawContent = rawContent;
      parsed = stripThinkingAndParseJson(rawContent);
      break;
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || '';
      if (
        errMsg.includes('Không thể kết nối đến Ollama') ||
        errMsg.includes('hiện không hỗ trợ đọc ảnh')
      ) {
        throw err;
      }
      if (attempt === 0) {
        console.warn('Chấm bài Ollama lần 1 lỗi parse/mạng, đang thử lại...', errMsg);
      }
    }
  }

  if (parsed) {
    const rawStudents: StructuredGradedStudent[] =
      Array.isArray(parsed?.students) && parsed.students.length > 0
        ? parsed.students
        : [parsed];

    const finalStudents = rawStudents.map((rawSt, idx) => {
      const rowFallbackName = rawStudents.length > 1 ? `${defaultName} (Bài ${idx + 1})` : defaultName;
      if (Array.isArray(rawSt?.questionRows) && rawSt.questionRows.length > 0) {
        return formatGradingFeedbackFromStructured(rawSt, rowFallbackName, effectiveMasterRubric || undefined);
      }
      const legacyStudent = {
        studentName: sanitizeStudentField(rawSt?.studentName, 'name') || rowFallbackName,
        studentId: sanitizeStudentField(rawSt?.studentId, 'meta') || 'Không có',
        className: sanitizeStudentField(rawSt?.className, 'meta') || 'Không có',
        examCode: sanitizeStudentField(rawSt?.examCode, 'meta') || 'Không có',
        score: rawSt?.score || 'N/A',
        totalScoreNum: rawSt?.totalScoreNum,
        scoreText: rawSt?.scoreText || '',
        feedback: rawSt?.feedback || lastRawContent,
      };
      synchronizeStudentScores([legacyStudent]);
      return legacyStudent;
    });

    const first = finalStudents[0];
    return {
      students: finalStudents,
      content: first.feedback,
      score: first.score,
      studentName: sanitizeStudentField(first.studentName, 'name') || defaultName,
      studentId: first.studentId,
      className: first.className,
      examCode: first.examCode,
    };
  }

  if (lastRawContent) {
    const cleanedFallback = lastRawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const scoreMatch = cleanedFallback.match(/(\d+(?:\.\d+)?\s*\/\s*10)/);
    const fallbackScore = scoreMatch ? scoreMatch[1] : 'Đã chấm';
    const fallbackList = [{
      studentName: defaultName,
      score: fallbackScore,
      feedback: cleanedFallback,
    }];
    synchronizeStudentScores(fallbackList);
    return {
      students: fallbackList,
      content: fallbackList[0].feedback,
      score: fallbackList[0].score,
      studentName: defaultName,
    };
  }

  throw lastError || new Error('Ollama không phản hồi kết quả chấm thi.');
};

export const gradeSubmissionOllama = async (
  config: GradingConfig,
  ollamaConfig: OllamaConfig
): Promise<{ content: string; score: string }> => {
  const firstFile = config.submissionFiles && config.submissionFiles.length > 0 ? config.submissionFiles[0] : null;
  if (!firstFile) {
    throw new Error('Không có file bài làm nào để chấm.');
  }
  const result = await gradeSingleSubmissionOllama(firstFile, config.answerKeyFile, config.gradingType, ollamaConfig);
  return { content: result.content, score: result.score };
};
