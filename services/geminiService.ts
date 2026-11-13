import { ExamConfig, GradingConfig } from "../types";
import { extractFileContent } from "./fileUtils";
import { buildExamMetaAndPrompt, buildGradingUserPrompt } from "../utils/examHelpers";

export const fileToGenerativePart = async (file: File): Promise<any> => {

  const extracted = await extractFileContent(file);

  if (extracted.type === 'text' && extracted.text) {
    return {
      text: `[Nội dung tài liệu/bài thi từ file "${file.name}"]:\n${extracted.text}\n`
    };
  }

  if (extracted.type === 'image' || extracted.type === 'pdf') {
    return {
      inlineData: {
        data: extracted.base64,
        mimeType: extracted.mimeType,
      },
    };
  }

  // Fallback for other file types
  return {
    inlineData: {
      data: extracted.base64,
      mimeType: extracted.mimeType || 'application/octet-stream',
    },
  };
};

export const generateExamContent = async (config: ExamConfig): Promise<{ questions: string; answers: string }> => {
  let parts: any[] = [];
  
  // Xử lý danh sách các file tài liệu
  if (config.sourceFiles && config.sourceFiles.length > 0) {
      for (const file of config.sourceFiles) {
          const filePart = await fileToGenerativePart(file);
          parts.push(filePart);
      }
      parts.push({ text: `Sử dụng ${config.sourceFiles.length} tài liệu đính kèm bên trên làm nguồn kiến thức chính để tạo câu hỏi.` });
  }


  const { examMeta, prompt } = buildExamMetaAndPrompt(config);
  parts.push({ text: prompt });

  try {
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      try {
        const response = await fetch("/api/generate-exam", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts, examMeta }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const rawText = await response.text();
        const isHtml = rawText.trim().startsWith("<") || rawText.includes("<!doctype") || rawText.includes("<html");

        if (isHtml && attempts < 2) {
          console.log("Server returned HTML response during exam generation, retrying in 1.5s...");
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        if (!response.ok) {
          let errorMsg = `Lỗi hệ thống khi gọi AI (${response.status})`;
          try {
            const errObj = JSON.parse(rawText);
            errorMsg = errObj.error || errorMsg;
          } catch {
            if (isHtml) {
              errorMsg = `Server trả về lỗi HTML (${response.status}). Vui lòng thử lại.`;
            } else if (rawText) {
              errorMsg = rawText.slice(0, 200);
            }
          }

          if (attempts < 2 && (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504)) {
            console.log(`Exam generation returned ${response.status}, retrying in 1.5s...`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          throw new Error(errorMsg);
        }

        let parsed: any;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          if (attempts < 2) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          throw new Error("Phản hồi tạo đề từ AI không đúng định dạng JSON. Vui lòng thử lại.");
        }

        if (!parsed.questions || parsed.questions.length < 50) {
          throw new Error("AI không tạo được nội dung đề thi. Vui lòng thử lại.");
        }
        if (!parsed.answers || parsed.answers.length < 50) {
          parsed.answers = parsed.answers || "Hệ thống chưa tạo được đáp án chi tiết. Vui lòng thử lại.";
        }
        return parsed;
      } catch (innerErr: any) {
        clearTimeout(timeoutId);
        if (attempts < 2 && (innerErr?.name === 'AbortError' || innerErr?.message?.includes('Failed to fetch'))) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        throw innerErr;
      }
    }
    throw new Error("Không thể tạo đề thi. Vui lòng thử lại.");
  } catch (error: any) {
    console.error("Lỗi khi tạo đề:", error);
    throw error;
  }
};

export interface GradedStudentItem {
    studentName: string;
    studentId?: string;
    className?: string;
    examCode?: string;
    score: string;
    feedback: string;
}

export const gradeSingleSubmission = async (
    submissionFile: File,
    answerKeyFile: File | null,
    gradingType: 'auto' | 'trac-nghiem' | 'tu-luan' | 'hon-hop' = 'auto',
    studentName?: string,
    options?: {
      examQuestionFile?: File | null;
      examQuestionText?: string;
      answerKeyText?: string;
      fastFinalResultGrading?: boolean;
      masterRubric?: string;
    }
): Promise<{ 
    students: GradedStudentItem[];
    content: string; 
    score: string; 
    studentName: string;
    studentId?: string;
    className?: string;
    examCode?: string;
}> => {
    const parts: any[] = [];

    // 1. Add Exam Question Paper if provided
    if (options?.examQuestionFile) {
        parts.push(await fileToGenerativePart(options.examQuestionFile));
        parts.push({ text: `[TỆP ĐỀ BÀI (ĐỀ THI GỐC)]: Tên tệp "${options.examQuestionFile.name}". Bám sát toàn bộ yêu cầu, giả thiết và câu hỏi trong đề thi này để chấm.` });
    }
    if (options?.examQuestionText && options.examQuestionText.trim()) {
        parts.push({ text: `[NỘI DUNG ĐỀ BÀI (ĐỀ THI GỐC) NHẬP TRỰC TIẾP]:\n${options.examQuestionText.trim()}\n` });
    }

    // 2. Add Student Submission
    parts.push(await fileToGenerativePart(submissionFile));
    parts.push({ text: `[TÀI LIỆU BÀI LÀM CỦA THÍ SINH]: Tên tệp "${submissionFile.name}". Quét toàn bộ nội dung, bảng biểu, ảnh bài làm để chấm thi.` });
    
    // 3. Add Answer Key & Rubric
    if (answerKeyFile) {
        parts.push(await fileToGenerativePart(answerKeyFile));
        parts.push({ text: `[TỆP ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐỐI CHIẾU]: Tên tệp "${answerKeyFile.name}". Hãy đối chiếu đúng mã đề của thí sinh.` });
    }
    if (options?.answerKeyText && options.answerKeyText.trim()) {
        parts.push({ text: `[NỘI DUNG ĐÁP ÁN & THANG ĐIỂM NHẬP TRỰC TIẾP]:\n${options.answerKeyText.trim()}\n` });
    }

    const fastRule = options?.fastFinalResultGrading !== false;
    const prompt = buildGradingUserPrompt({
      submissionFileName: submissionFile.name,
      examQuestionFileName: options?.examQuestionFile?.name,
      answerKeyFileName: answerKeyFile?.name,
      gradingType,
      fastFinalResultGrading: fastRule,
    });

    parts.push({ text: prompt });

    try {
        let attempts = 0;
        let lastErr: any = null;

        while (attempts < 2) {
            attempts++;
            try {
                const controller = new AbortController();
                // 60 seconds maximum timeout per student (each normally takes 2-4 seconds)
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const response = await fetch("/api/grade-submission", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        prompt, 
                        parts,
                        masterRubric: options?.masterRubric,
                        fastFinalResultGrading: fastRule,
                        gradingType
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                const rawText = await response.text();

                // If server is starting up or returning HTML gateway, wait 1.5s and retry once
                if (rawText.trim().startsWith("<") || rawText.includes("<!doctype") || rawText.includes("<html")) {
                    if (attempts < 2) {
                        console.log("Server returned HTML response, retrying in 1.5s...");
                        await new Promise(r => setTimeout(r, 1500));
                        continue;
                    }
                    throw new Error("Server đang bận xử lý hoặc khởi động lại. Vui lòng bấm chấm lại sau vài giây.");
                }

                if (!response.ok) {
                    let errorMsg = `Lỗi hệ thống khi chấm thi (${response.status})`;
                    try {
                        const errObj = JSON.parse(rawText);
                        errorMsg = errObj.error || errorMsg;
                    } catch {
                        if (rawText) {
                            errorMsg = rawText.slice(0, 200);
                        }
                    }

                    if (attempts < 2 && (response.status === 502 || response.status === 503 || response.status === 504)) {
                        console.log(`Server returned ${response.status}, retrying in 1.5s...`);
                        await new Promise(r => setTimeout(r, 1500));
                        continue;
                    }

                    throw new Error(errorMsg);
                }

                let parsed: any;
                try {
                    parsed = JSON.parse(rawText);
                } catch (jsonErr) {
                    console.error("Failed to parse grade response JSON:", rawText);
                    throw new Error("Phản hồi từ AI không đúng định dạng JSON. Vui lòng thử lại.");
                }

                const studentsList: GradedStudentItem[] = Array.isArray(parsed.students) && parsed.students.length > 0
                    ? parsed.students
                    : [{
                        studentName: parsed.studentName || studentName || submissionFile.name.replace(/\.[^/.]+$/, ''),
                        studentId: parsed.studentId,
                        className: parsed.className,
                        examCode: parsed.examCode,
                        score: parsed.score || 'N/A',
                        feedback: parsed.feedback || rawText
                    }];

                const first = studentsList[0];
                return {
                    students: studentsList,
                    content: first.feedback,
                    score: first.score,
                    studentName: first.studentName || studentName || submissionFile.name.replace(/\.[^/.]+$/, ''),
                    studentId: first.studentId,
                    className: first.className,
                    examCode: first.examCode
                };
            } catch (err: any) {
                lastErr = err;
                if (attempts < 2 && (err.name === 'TypeError' || err.message?.includes('fetch failed'))) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                throw err;
            }
        }
        throw lastErr || new Error("Không thể nhận kết quả chấm thi.");
    } catch (error: any) {
        if (error.name === 'AbortError' || error.message?.includes('aborted')) {
            throw new Error("Thời gian phản hồi vượt quá 60 giây. Bạn có thể bấm 'Chấm lại bài này ngay' để hệ thống gửi lại ngay lập tức.");
        }
        console.error(`Lỗi chấm thi cho ${submissionFile.name}:`, error);
        throw error;
    }
};


export const gradeSubmission = async (config: GradingConfig): Promise<{ content: string; score: string }> => {
    const firstFile = config.submissionFiles && config.submissionFiles.length > 0 ? config.submissionFiles[0] : null;
    if (!firstFile) {
        throw new Error("Không có bài làm nào để chấm.");
    }
    const result = await gradeSingleSubmission(firstFile, config.answerKeyFile, config.gradingType);
    return { content: result.content, score: result.score };
};

