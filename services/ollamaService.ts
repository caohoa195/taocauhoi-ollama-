import { ExamConfig, GradingConfig, GeneratedContent, DifficultyLevel, QuestionType, OllamaConfig } from "../types";

export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
  source?: 'browser' | 'proxy';
}

// Convert File to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Check if file is text/readable
const tryReadAsText = async (file: File): Promise<string | null> => {
  if (
    file.type.startsWith('text/') ||
    file.name.endsWith('.txt') ||
    file.name.endsWith('.md') ||
    file.name.endsWith('.json') ||
    file.name.endsWith('.csv')
  ) {
    try {
      return await file.text();
    } catch {
      return null;
    }
  }
  return null;
};

// Test connection to Ollama
export const checkOllamaConnection = async (
  baseUrl: string = 'http://localhost:11434',
  mode: 'browser' | 'proxy' = 'browser'
): Promise<OllamaConnectionResult> => {
  const cleanUrl = baseUrl.replace(/\/+$/, '');

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
  } catch (proxyErr: any) {
    return {
      ok: false,
      models: [],
      error: `Không thể kết nối tới ${cleanUrl}. Vui lòng đảm bảo Ollama đang chạy (ví dụ: gõ 'ollama serve' trong Terminal). Nếu kết nối trực tiếp từ trình duyệt, cấu hình OLLAMA_ORIGINS="*" để cho phép CORS.`,
    };
  }
};

// Send request to Ollama (via browser or proxy)
const callOllamaApi = async (
  ollamaConfig: OllamaConfig,
  endpoint: '/api/chat' | '/api/generate',
  body: any
): Promise<any> => {
  const cleanUrl = ollamaConfig.baseUrl.replace(/\/+$/, '');

  if (ollamaConfig.connectionMode === 'browser') {
    try {
      const response = await fetch(`${cleanUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama lỗi (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (err: any) {
      console.warn("Browser call failed, trying proxy fallback...", err);
      // Fallback to proxy
    }
  }

  // Call via backend proxy
  const proxyRes = await fetch('/api/ollama/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: cleanUrl,
      endpoint,
      payload: body,
    }),
  });

  if (!proxyRes.ok) {
    const errJson = await proxyRes.json().catch(() => ({}));
    throw new Error(errJson.error || `Lỗi khi gọi Ollama qua proxy (${proxyRes.status})`);
  }

  return await proxyRes.json();
};

export const generateExamContentOllama = async (
  config: ExamConfig,
  ollamaConfig: OllamaConfig
): Promise<GeneratedContent> => {
  // Extract images and text from source files
  const images: string[] = [];
  let attachedText = '';

  if (config.sourceFiles && config.sourceFiles.length > 0) {
    for (const file of config.sourceFiles) {
      const textContent = await tryReadAsText(file);
      if (textContent) {
        attachedText += `\n--- Tài liệu đính kèm: ${file.name} ---\n${textContent}\n`;
      } else if (file.type.startsWith('image/')) {
        const b64 = await fileToBase64(file);
        images.push(b64);
      } else {
        // Base64 generic fallback
        attachedText += `\n[Tài liệu đính kèm: ${file.name} (${file.type})]`;
      }
    }
  }

  // Layout templates
  const examHeaderLayout = `| **KHOA ${config.faculty.toUpperCase()}**<br>**BỘ MÔN ${config.department.toUpperCase()}** | **ĐỀ THI KẾT THÚC HỌC PHẦN**<br>Môn: ${config.subject}<br>Đối tượng: ${config.targetAudience}<br>Thời gian: ${config.duration} phút |
| :--- | :--- |`;

  const answerHeaderLayout = `| **KHOA ${config.faculty.toUpperCase()}**<br>**BỘ MÔN ${config.department.toUpperCase()}** | **ĐÁP ÁN ĐỀ THI**<br>Môn: ${config.subject}<br>Đối tượng: ${config.targetAudience} |
| :--- | :--- |`;

  let structurePrompt = '';
  let variantPrompt = '';
  const totalVariants = (config.questionType === QuestionType.ESSAY && config.variantCount) ? config.variantCount : 1;

  if (config.questionType === QuestionType.ESSAY && config.levelDistribution) {
    structurePrompt = `
CẤU TRÚC MA TRẬN ĐỀ THI:
- Nhận biết: ${config.levelDistribution[DifficultyLevel.RECOGNITION]} câu
- Thông hiểu: ${config.levelDistribution[DifficultyLevel.UNDERSTANDING]} câu
- Vận dụng: ${config.levelDistribution[DifficultyLevel.APPLICATION]} câu
- Vận dụng cao: ${config.levelDistribution[DifficultyLevel.ADVANCED_APPLICATION]} câu`;
    variantPrompt = `SỐ LƯỢNG MÃ ĐỀ CẦN TẠO: ${totalVariants} ĐỀ KHÁC NHAU (cùng cấu trúc ma trận và độ khó).`;
  } else {
    structurePrompt = `CẤU TRÚC: ${config.quantity} câu, mức độ ${config.difficulty}.`;
    variantPrompt = `Tạo duy nhất 01 đề thi.`;
  }

  const systemPrompt = `Bạn là một giảng viên đại học giàu kinh nghiệm chuyên soạn thảo ngân hàng câu hỏi và đề thi chuẩn mực.
BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON với đúng 2 trường:
{
  "questions": "Nội dung Markdown của toàn bộ đề bài",
  "answers": "Nội dung Markdown của toàn bộ đáp án và thang điểm chi tiết"
}`;

  const userPrompt = `
Nhiệm vụ: Tạo đề thi và đáp án chi tiết cho môn: ${config.subject}.

THÔNG SỐ CHUNG:
- Môn học: ${config.subject}
- Chủ đề: ${config.topic || 'Tổng hợp kiến thức'}
- Loại câu hỏi: ${config.questionType}
- Yêu cầu đặc biệt: ${config.specificRequirement || 'Không có'}
${structurePrompt}
${variantPrompt}
${attachedText ? `\nTÀI LIỆU NGUỒN THAM KHẢO:\n${attachedText}` : ''}

YÊU CẦU ĐỊNH DẠNG VÀ NGẮT TRANG (DÀNH CHO XUẤT WORD):
1. TRƯỜNG "questions" (Đề bài):
   - Tạo đủ ${totalVariants} mã đề.
   - Với MỖI mã đề, sử dụng cấu trúc:
   ${examHeaderLayout}
   <center><h3>ĐỀ SỐ [X]</h3></center>
   [Danh sách các câu hỏi của đề X]
   <br>
   <table style="width: 100%; border: none; margin-top: 30px;">
   <tr>
   <td style="width: 50%; border: none; vertical-align: top;">---</td>
   <td style="width: 50%; text-align: center; border: none; vertical-align: top;"><b>${config.signerTitle}</b><br><br><br><br><br><b>${config.signerName}</b></td>
   </tr>
   </table>
   <div class="word-page-break"></div>

2. TRƯỜNG "answers" (Đáp án & Thang điểm):
   - Tạo đủ ${totalVariants} phần đáp án tương ứng.
   - Với MỖI mã đề, sử dụng cấu trúc:
   ${answerHeaderLayout}
   <center><h3>ĐÁP ÁN ĐỀ SỐ [X]</h3></center>
   | Nội dung | Điểm |
   | :--- | :--- |
   | **Câu 1:** Đáp án... | **2.0đ** |
   | - Lời giải chi tiết... | 0.5 |
   <br>
   <table style="width: 100%; border: none; margin-top: 30px;">
   <tr>
   <td style="width: 50%; border: none; vertical-align: top;">---</td>
   <td style="width: 50%; text-align: center; border: none; vertical-align: top;"><b>${config.signerTitle}</b><br><br><br><br><br><b>${config.signerName}</b></td>
   </tr>
   </table>
   <div class="word-page-break"></div>

Hãy xuất ra DUY NHẤT một chuỗi JSON hợp lệ với cấu trúc:
{"questions": "...", "answers": "..."}`;

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
      temperature: 0.3,
      num_ctx: 8192,
    },
  };

  const data = await callOllamaApi(ollamaConfig, '/api/chat', payload);

  let rawContent = '';
  if (data.message && data.message.content) {
    rawContent = data.message.content;
  } else if (data.response) {
    rawContent = data.response;
  } else {
    throw new Error('Ollama không trả về nội dung hợp lệ.');
  }

  // Parse JSON response safely
  try {
    const cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (parsed.questions && parsed.answers) {
      return {
        questions: parsed.questions,
        answers: parsed.answers,
      };
    }
  } catch (parseErr) {
    console.warn("JSON parse failed, attempting regex/heuristic recovery...", parseErr);
  }

  // Heuristic fallback if model returned raw markdown instead of pure JSON
  const matchQuestions = rawContent.match(/"questions"\s*:\s*"([\s\S]*?)",\s*"answers"/);
  const matchAnswers = rawContent.match(/"answers"\s*:\s*"([\s\S]*?)"\s*}/);
  if (matchQuestions && matchAnswers) {
    return {
      questions: matchQuestions[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      answers: matchAnswers[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    };
  }

  // Section splitting fallback
  if (rawContent.includes('ĐÁP ÁN') || rawContent.includes('ĐÁP ÁN ĐỀ SỐ')) {
    const splitIndex = rawContent.search(/(#+\s*ĐÁP ÁN|\|\s*\*\*ĐÁP ÁN|\*\*ĐÁP ÁN ĐỀ SỐ)/i);
    if (splitIndex > 0) {
      return {
        questions: rawContent.substring(0, splitIndex).trim(),
        answers: rawContent.substring(splitIndex).trim(),
      };
    }
  }

  return {
    questions: rawContent,
    answers: "Vui lòng xem đáp án trong nội dung câu hỏi hoặc yêu cầu tạo lại.",
  };
};

export const gradeSubmissionOllama = async (
  config: GradingConfig,
  ollamaConfig: OllamaConfig
): Promise<{ content: string; score: string }> => {
  const images: string[] = [];
  let extraText = '';

  if (config.submissionFile) {
    const text = await tryReadAsText(config.submissionFile);
    if (text) {
      extraText += `\n--- Bài làm của học sinh (${config.submissionFile.name}) ---\n${text}\n`;
    } else if (config.submissionFile.type.startsWith('image/')) {
      images.push(await fileToBase64(config.submissionFile));
    }
  }

  if (config.answerKeyFile) {
    const text = await tryReadAsText(config.answerKeyFile);
    if (text) {
      extraText += `\n--- Đáp án chuẩn & Thang điểm (${config.answerKeyFile.name}) ---\n${text}\n`;
    } else if (config.answerKeyFile.type.startsWith('image/')) {
      images.push(await fileToBase64(config.answerKeyFile));
    }
  }

  const prompt = `
Đóng vai trò là giáo viên chấm thi.
Loại bài thi: ${config.gradingType === 'trac-nghiem' ? 'Trắc nghiệm' : 'Tự luận'}.
${extraText}
Hãy chấm điểm bài làm của sinh viên dựa trên đáp án chuẩn và thang điểm.

Yêu cầu:
- Tự luận: Chấm chi tiết từng câu, từng ý, đối chiếu thang điểm, chỉ rõ lỗi sai và điểm trừ.
- Trắc nghiệm: Liệt kê số câu đúng, câu sai, tổng điểm.
- Trả về JSON DUY NHẤT với định dạng:
{
  "feedback": "Bản nhận xét Markdown chi tiết từng câu kèm lời giải và lỗi sai...",
  "score": "8.5/10"
}`;

  const messages: any[] = [
    {
      role: 'user',
      content: prompt,
      ...(images.length > 0 ? { images } : {}),
    },
  ];

  const payload = {
    model: ollamaConfig.model,
    messages,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.2,
    },
  };

  const data = await callOllamaApi(ollamaConfig, '/api/chat', payload);

  let rawContent = '';
  if (data.message && data.message.content) {
    rawContent = data.message.content;
  } else if (data.response) {
    rawContent = data.response;
  } else {
    throw new Error('Ollama không phản hồi kết quả chấm thi.');
  }

  try {
    const cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      content: parsed.feedback || rawContent,
      score: parsed.score || 'N/A',
    };
  } catch {
    // Extract score from text if possible
    const scoreMatch = rawContent.match(/(\d+(\.\d+)?\s*\/\s*10)/);
    return {
      content: rawContent,
      score: scoreMatch ? scoreMatch[1] : 'Đã chấm',
    };
  }
};
