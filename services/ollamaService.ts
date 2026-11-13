import { ExamConfig, GradingConfig, GeneratedContent, OllamaConfig } from "../types";
import { extractFileContent, extractPdfForOllama } from "./fileUtils";
import {
  buildExamMetaAndPrompt,
  buildGradingUserPrompt,
  formatExamFromVariants,
  getExamSystemInstruction,
  GRADING_SYSTEM_INSTRUCTION,
  synchronizeStudentScores,
} from "../utils/examHelpers";

export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
  source?: 'browser' | 'proxy';
}

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

// Send request to Ollama (via browser or proxy) with smart text fallback if model lacks vision
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

  try {
    return await doSend(body);
  } catch (err: any) {
    const errMsg = err?.message || '';
    const hasImages = Array.isArray(body?.messages) && body.messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0);
    if (hasImages && isVisionUnsupportedError(errMsg)) {
      if (canFallbackWithoutImages) {
        console.warn(`Model ${ollamaConfig.model} không hỗ trợ ảnh, tự động chuyển sang dùng văn bản trích xuất...`);
        const textOnlyBody = {
          ...body,
          messages: body.messages.map((m: any) => {
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

// Extract text and/or page images from any file (DOCX, TXT, Image, PDF) so Ollama sees full content like Gemini
const appendFileForOllama = async (
  file: File,
  roleLabel: string,
  images: string[],
  maxPdfRenderPages = 6
): Promise<{ textBlock: string; hasExtractedText: boolean }> => {
  const extracted = await extractFileContent(file);

  if (extracted.type === 'text' && extracted.text) {
    const trimmed = extracted.text.length > 25000
      ? extracted.text.slice(0, 25000) + '\n[Đã tối ưu trích xuất 25.000 ký tự đầu]'
      : extracted.text;
    return {
      textBlock: `\n--- [${roleLabel}] File: "${file.name}" ---\n${trimmed}\n`,
      hasExtractedText: trimmed.trim().length > 20,
    };
  }

  if (extracted.type === 'image' && extracted.base64) {
    images.push(extracted.base64);
    const imgIdx = images.length;
    return {
      textBlock: `\n--- [${roleLabel}] Ảnh đính kèm số ${imgIdx}: "${file.name}" ---\n(Hãy đọc kỹ toàn bộ chữ viết tay, công thức, khoanh tròn và nội dung trong Ảnh số ${imgIdx}).\n`,
      hasExtractedText: false,
    };
  }

  if (extracted.type === 'pdf') {
    try {
      const pdfData = await extractPdfForOllama(file, maxPdfRenderPages);
      let block = `\n--- [${roleLabel}] Tài liệu PDF (${pdfData.pageCount} trang): "${file.name}" ---\n`;
      if (pdfData.text && pdfData.text.trim().length > 0) {
        const cleanPdfText = pdfData.text.length > 25000
          ? pdfData.text.slice(0, 25000) + '\n[Đã tối ưu trích xuất 25.000 ký tự đầu]'
          : pdfData.text;
        block += `Nội dung văn bản trích xuất từ PDF:\n${cleanPdfText}\n`;
      }
      if (pdfData.images.length > 0) {
        const startIdx = images.length + 1;
        pdfData.images.forEach((b64) => images.push(b64));
        const endIdx = images.length;
        block += `Các trang PDF được chuyển thành hình ảnh từ Ảnh số ${startIdx} đến Ảnh số ${endIdx} (hãy đọc kỹ chữ viết, công thức, hình vẽ và đánh dấu trong các ảnh trang này).\n`;
      }
      return {
        textBlock: block,
        hasExtractedText: (pdfData.text || '').trim().length > 40,
      };
    } catch (pdfErr) {
      console.warn(`Không thể phân tích PDF "${file.name}" cho Ollama:`, pdfErr);
    }
  }

  if (extracted.text) {
    return {
      textBlock: `\n--- [${roleLabel}] File: "${file.name}" ---\n${extracted.text}\n`,
      hasExtractedText: extracted.text.trim().length > 20,
    };
  }

  return {
    textBlock: `\n[${roleLabel}: "${file.name}"]\n`,
    hasExtractedText: false,
  };
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
      const res = await appendFileForOllama(file, 'TÀI LIỆU NGUỒN', images, 5);
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
    format: 'json',
    options: {
      temperature: 0.1,
      num_ctx: 16384,
    },
  };

  const data = await callOllamaApi(ollamaConfig, '/api/chat', payload, allFilesHaveText);

  const rawContent = data?.message?.content || data?.response || '';
  if (!rawContent) {
    throw new Error('Ollama không trả về nội dung hợp lệ.');
  }

  // Parse JSON response safely (supports both unified `variants` schema and legacy `{questions, answers}`)
  try {
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
  } catch (parseErr) {
    console.warn("JSON parse failed in generateExamContentOllama, attempting heuristic recovery...", parseErr);
  }

  // Heuristic fallback if model returned raw markdown strings
  const cleanedRaw = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
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
  let extraText = '';
  let submissionHasText = true;

  if (options?.masterRubric && options.masterRubric.trim()) {
    extraText += `\n[BẢNG BAREM THANG ĐIỂM BẮT BUỘC DÙNG CHUNG CHO TẤT CẢ CÁC BÀI THI]:\n${options.masterRubric.trim()}\n\nQUY TẮC CỐ ĐỊNH BAREM: Bắt buộc liệt kê đầy đủ tất cả các câu trên vào bảng điểm của thí sinh này. Câu nào thí sinh không giải/bỏ trống bắt buộc ghi rõ vào bảng và cho 0.0đ. Tuyệt đối không được thay đổi thang điểm tối đa của từng câu.\n`;
  }

  if (options?.examQuestionFile) {
    const qRes = await appendFileForOllama(options.examQuestionFile, 'TỆP ĐỀ BÀI (ĐỀ THI GỐC)', images, 5);
    extraText += qRes.textBlock;
  }

  if (options?.examQuestionText && options.examQuestionText.trim()) {
    extraText += `\n[NỘI DUNG ĐỀ BÀI (ĐỀ THI GỐC) ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${options.examQuestionText.trim()}\n`;
  }

  const subRes = await appendFileForOllama(submissionFile, 'TÀI LIỆU BÀI LÀM CỦA THÍ SINH', images, 6);
  extraText += subRes.textBlock;
  submissionHasText = subRes.hasExtractedText;

  if (answerKeyFile) {
    const kRes = await appendFileForOllama(answerKeyFile, 'TỆP ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐỐI CHIẾU', images, 5);
    extraText += kRes.textBlock;
  }

  if (options?.answerKeyText && options.answerKeyText.trim()) {
    extraText += `\n[NỘI DUNG ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${options.answerKeyText.trim()}\n`;
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
BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON SAU (không viết thêm văn bản ngoài JSON):
{
  "students": [
    {
      "studentName": "Họ và tên thí sinh trích xuất từ bài thi",
      "studentId": "MSSV hoặc SBD nếu có",
      "className": "Lớp nếu có",
      "examCode": "Mã đề nếu có",
      "score": "6.75/10",
      "totalScoreNum": 6.75,
      "scoreText": "Sáu phẩy bảy lăm",
      "feedback": "Toàn bộ PHIẾU CHẤM ĐIỂM THI KẾT THÚC HỌC PHẦN Markdown đúng khuôn mẫu quy định"
    }
  ]
}`;

  const messages: any[] = [
    { role: 'system', content: GRADING_SYSTEM_INSTRUCTION },
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
    format: 'json',
    options: {
      temperature: 0.0,
      seed: 42,
      num_ctx: 16384,
    },
  };

  const data = await callOllamaApi(ollamaConfig, '/api/chat', payload, submissionHasText);

  const rawContent = data?.message?.content || data?.response || '';
  if (!rawContent) {
    throw new Error('Ollama không phản hồi kết quả chấm thi.');
  }

  try {
    const parsed = stripThinkingAndParseJson(rawContent);

    const studentsList = Array.isArray(parsed?.students) && parsed.students.length > 0
      ? parsed.students
      : [{
          studentName: parsed?.studentName || studentName || submissionFile.name.replace(/\.[^/.]+$/, ''),
          studentId: parsed?.studentId || '',
          className: parsed?.className || '',
          examCode: parsed?.examCode || '',
          score: parsed?.score || 'N/A',
          totalScoreNum: parsed?.totalScoreNum,
          scoreText: parsed?.scoreText || '',
          feedback: parsed?.feedback || rawContent,
        }];

    // Programmatically compute exact sum from table & synchronize GPA4 / Letter / Rank (identical to Gemini)
    synchronizeStudentScores(studentsList);

    const first = studentsList[0];
    return {
      students: studentsList,
      content: first.feedback,
      score: first.score,
      studentName: first.studentName || studentName || submissionFile.name.replace(/\.[^/.]+$/, ''),
      studentId: first.studentId,
      className: first.className,
      examCode: first.examCode,
    };
  } catch {
    const cleanedFallback = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const scoreMatch = cleanedFallback.match(/(\d+(?:\.\d+)?\s*\/\s*10)/);
    const fallbackScore = scoreMatch ? scoreMatch[1] : 'Đã chấm';
    const fallbackName = studentName || submissionFile.name.replace(/\.[^/.]+$/, '');
    const fallbackList = [{
      studentName: fallbackName,
      score: fallbackScore,
      feedback: cleanedFallback,
    }];
    synchronizeStudentScores(fallbackList);
    return {
      students: fallbackList,
      content: fallbackList[0].feedback,
      score: fallbackList[0].score,
      studentName: fallbackName,
    };
  }
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
