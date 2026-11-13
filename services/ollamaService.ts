import { ExamConfig, GradingConfig, GeneratedContent, DifficultyLevel, QuestionType, OllamaConfig } from "../types";
import { extractFileContent } from "./fileUtils";

export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
  source?: 'browser' | 'proxy';
}


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
  const cleanUrl = (ollamaConfig.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const isLocalhost = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1');

  // For localhost, browser direct connection is the only path because cloud server cannot reach user's 127.0.0.1
  if (ollamaConfig.connectionMode === 'browser' || isLocalhost) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min
      const response = await fetch(`${cleanUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      if (isLocalhost) {
        throw new Error(
          `Không thể kết nối đến Ollama trên máy tính của bạn tại ${cleanUrl}.\n` +
          `Nguyên nhân: Ứng dụng Ollama chưa được mở hoặc trình duyệt chặn kết nối CORS.\n` +
          `Khắc phục: Mở Terminal gõ 'OLLAMA_ORIGINS="*" ollama serve', hoặc chuyển sang dùng 'Gemini Cloud' để chấm ngay lập tức.`
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
      payload: body,
    }),
  });

  if (!proxyRes.ok) {
    const errJson = await proxyRes.json().catch(() => ({}));
    throw new Error(errJson.error || `Lỗi khi gọi Ollama (${proxyRes.status})`);
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
      const extracted = await extractFileContent(file);
      if (extracted.type === 'text' && extracted.text) {
        attachedText += `\n--- Tài liệu đính kèm: ${file.name} ---\n${extracted.text}\n`;
      } else if (extracted.type === 'image' && extracted.base64) {
        images.push(extracted.base64);
      } else if (extracted.text) {
        attachedText += `\n--- Tài liệu đính kèm: ${file.name} ---\n${extracted.text}\n`;
      } else {
        attachedText += `\n[Tài liệu đính kèm: ${file.name}]\n`;
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

  if (options?.masterRubric && options.masterRubric.trim()) {
    extraText += `\n--- BẢNG BAREM THANG ĐIỂM BẮT BUỘC DÙNG CHUNG ---\n${options.masterRubric.trim()}\nBẮT BUỘC DÙNG ĐÚNG BẢNG BAREM NÀY: Mọi bài thi đều phải có đủ các câu trên. Câu nào không làm cho 0.0đ. Không được đổi thang điểm.\n`;
  }

  if (options?.examQuestionFile) {
    const qExtracted = await extractFileContent(options.examQuestionFile);
    if (qExtracted.type === 'text' && qExtracted.text) {
      extraText += `\n--- ĐỀ BÀI (ĐỀ THI GỐC): ${options.examQuestionFile.name} ---\n${qExtracted.text}\n`;
    } else if (qExtracted.type === 'image' && qExtracted.base64) {
      images.push(qExtracted.base64);
      extraText += `\n--- ĐỀ BÀI (ảnh đính kèm bên dưới) ---\n`;
    }
  }

  if (options?.examQuestionText && options.examQuestionText.trim()) {
    extraText += `\n--- ĐỀ BÀI (nhập trực tiếp) ---\n${options.examQuestionText.trim()}\n`;
  }

  const subExtracted = await extractFileContent(submissionFile);
  if (subExtracted.type === 'text' && subExtracted.text) {
    extraText += `\n--- Bài làm của thí sinh: "${studentName || submissionFile.name}" ---\n${subExtracted.text}\n`;
  } else if (subExtracted.type === 'image' && subExtracted.base64) {
    images.push(subExtracted.base64);
    extraText += `\n--- Bài làm ảnh của thí sinh: "${studentName || submissionFile.name}" đính kèm bên dưới ---\n`;
  } else if (subExtracted.text) {
    extraText += `\n--- Bài làm của thí sinh: "${studentName || submissionFile.name}" ---\n${subExtracted.text}\n`;
  } else {
    extraText += `\n[Tài liệu bài làm: ${submissionFile.name}]\n`;
  }

  if (answerKeyFile) {
    const keyExtracted = await extractFileContent(answerKeyFile);
    if (keyExtracted.type === 'text' && keyExtracted.text) {
      extraText += `\n--- Đáp án chuẩn & Thang điểm (${answerKeyFile.name}) ---\n${keyExtracted.text}\n`;
    } else if (keyExtracted.type === 'image' && keyExtracted.base64) {
      images.push(keyExtracted.base64);
      extraText += `\n--- Đáp án chuẩn (ảnh) đính kèm ---\n`;
    } else if (keyExtracted.text) {
      extraText += `\n--- Đáp án chuẩn & Thang điểm (${answerKeyFile.name}) ---\n${keyExtracted.text}\n`;
    }
  }

  if (options?.answerKeyText && options.answerKeyText.trim()) {
    extraText += `\n--- Đáp án chuẩn & Thang điểm (nhập trực tiếp) ---\n${options.answerKeyText.trim()}\n`;
  }

  const fastRule = options?.fastFinalResultGrading !== false;

  const prompt = `
Đóng vai trò là Giám khảo Chấm thi Đại học công tâm, chi tiết và chính xác tuyệt đối.
Tệp bài thi nộp lên: "${submissionFile.name}"
Loại bài thi: ${gradingType === 'trac-nghiem' ? 'Trắc nghiệm' : gradingType === 'tu-luan' ? 'Tự luận' : 'Tự động'}.
${extraText}

${fastRule ? `
⭐ QUY TẮC CHẤM: Đúng kết quả cuối cùng cho điểm tối đa trọn vẹn của câu/ý đó. Nếu sai kết quả cuối cùng mới chấm điểm các thành phần (công thức, biến đổi, thay số) theo bareme điểm từng bước.
` : ''}

Yêu cầu bắt buộc:
1. TÌM TÊN THÍ SINH & TÁCH BÀI LÀM:
   - Đọc kỹ bài làm để tìm Họ và tên thật của thí sinh, MSSV/SBD, Lớp.
   - NẾU TÀI LIỆU CHỨA BÀI THI CỦA 2 HAY NHIỀU THÍ SINH: Bắt buộc tách thành từng phần tử riêng biệt trong mảng "students" (mỗi em một phần tử).
2. ĐỐI CHIẾU ĐÁP ÁN:
   - Trắc nghiệm: Lập bảng đối chiếu (Câu | Đáp án chọn | Đáp án đúng | Đánh giá | Điểm).
   - Tự luận: Lập bảng điểm chi tiết từng câu theo quy tắc trên:
     | Câu / Ý | Yêu cầu đề bài | Kết quả cuối của HS | Đánh giá KQ cuối | Phương thức chấm | Thang điểm | Điểm đạt | Nhận xét chi tiết (Thành phần nếu sai) |
3. PHIẾU CHẤM ĐIỂM CHUẨN ĐẠI HỌC TRONG "feedback":
   Gồm Tiêu đề phiếu, Thông tin thí sinh, Bảng điểm chi tiết, Tổng điểm và Bảng chữ ký 2 giám khảo.
4. Trả về đúng JSON:
{
  "students": [
    {
      "studentName": "Họ và tên thí sinh",
      "studentId": "MSSV nếu có",
      "className": "Lớp nếu có",
      "examCode": "Mã đề nếu có",
      "score": "8.5/10",
      "feedback": "Nội dung phiếu chấm điểm Markdown..."
    }
  ]
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
      temperature: 0.0,
      seed: 42,
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

    const studentsList = Array.isArray(parsed.students) && parsed.students.length > 0
      ? parsed.students
      : [{
          studentName: parsed.studentName || studentName || submissionFile.name.replace(/\.[^/.]+$/, ''),
          studentId: parsed.studentId,
          className: parsed.className,
          examCode: parsed.examCode,
          score: parsed.score || 'N/A',
          feedback: parsed.feedback || rawContent
        }];

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
    // Extract score from text if possible
    const scoreMatch = rawContent.match(/(\d+(\.\d+)?\s*\/\s*10)/);
    const fallbackScore = scoreMatch ? scoreMatch[1] : 'Đã chấm';
    const fallbackName = studentName || submissionFile.name.replace(/\.[^/.]+$/, '');
    return {
      students: [{
        studentName: fallbackName,
        score: fallbackScore,
        feedback: rawContent
      }],
      content: rawContent,
      score: fallbackScore,
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
  return gradeSingleSubmissionOllama(firstFile, config.answerKeyFile, config.gradingType, ollamaConfig);
};

