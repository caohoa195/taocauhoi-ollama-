import { ExamConfig, GradingConfig, FileData, QuestionType, DifficultyLevel } from "../types";

const fileToGenerativePart = async (file: File): Promise<FileData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

  // Header Layout Template
  const examHeaderLayout = `| **KHOA ${config.faculty.toUpperCase()}**<br>**BỘ MÔN ${config.department.toUpperCase()}** | **ĐỀ THI KẾT THÚC HỌC PHẦN**<br>Môn: ${config.subject}<br>Đối tượng: ${config.targetAudience}<br>Thời gian: ${config.duration} phút |
| :--- | :--- |
`;

  const answerHeaderLayout = `| **KHOA ${config.faculty.toUpperCase()}**<br>**BỘ MÔN ${config.department.toUpperCase()}** | **ĐÁP ÁN ĐỀ THI**<br>Môn: ${config.subject}<br>Đối tượng: ${config.targetAudience} |
| :--- | :--- |
`;

  let structurePrompt = "";
  let variantPrompt = "";
  const totalVariants = (config.questionType === QuestionType.ESSAY && config.variantCount) ? config.variantCount : 1;

  if (config.questionType === QuestionType.ESSAY && config.levelDistribution) {
      structurePrompt = `
      CẤU TRÚC MA TRẬN ĐỀ THI:
      - Nhận biết: ${config.levelDistribution[DifficultyLevel.RECOGNITION]} câu
      - Thông hiểu: ${config.levelDistribution[DifficultyLevel.UNDERSTANDING]} câu
      - Vận dụng: ${config.levelDistribution[DifficultyLevel.APPLICATION]} câu
      - Vận dụng cao: ${config.levelDistribution[DifficultyLevel.ADVANCED_APPLICATION]} câu
      `;
      variantPrompt = `SỐ LƯỢNG MÃ ĐỀ CẦN TẠO: ${totalVariants} ĐỀ KHÁC NHAU (Về nội dung, cùng độ khó).`;
  } else {
      structurePrompt = `CẤU TRÚC: ${config.quantity} câu, mức độ ${config.difficulty}.`;
      variantPrompt = `Tạo duy nhất 01 đề thi.`;
  }

  const prompt = `
    Đóng vai trò là giảng viên đại học.
    Nhiệm vụ: Tạo đề thi và đáp án chi tiết cho môn ${config.subject}.
    
    THÔNG SỐ CHUNG:
    - Chủ đề: ${config.topic || 'Tổng hợp'}
    - Loại câu hỏi: ${config.questionType}
    - Yêu cầu đặc biệt: ${config.specificRequirement}
    
    ${structurePrompt}
    ${variantPrompt}
    
    YÊU CẦU ĐỊNH DẠNG (FORMATTING REQUIREMENTS):
    Output JSON gồm 2 trường "questions" và "answers".
    
    YÊU CẦU NGẮT TRANG TUYỆT ĐỐI (DÀNH CHO XUẤT WORD):
    - Sau mỗi mã đề thi (Phần Questions), bắt buộc chèn thẻ: <div class="word-page-break"></div>
    - Sau mỗi bộ đáp án (Phần Answers), bắt buộc chèn thẻ: <div class="word-page-break"></div>

    1. TRƯỜNG "questions" (Đề bài):
       - Tạo đủ ${totalVariants} mã đề.
       - Với MỖI mã đề, lặp lại cấu trúc sau:
       ${examHeaderLayout}
       <center><h3>ĐỀ SỐ [X]</h3></center>
       [Danh sách câu hỏi Đề X]
       <br>
       <table style="width: 100%; border: none; margin-top: 30px;">
       <tr>
       <td style="width: 50%; border: none; vertical-align: top;">---</td>
       <td style="width: 50%; text-align: center; border: none; vertical-align: top;"><b>${config.signerTitle}</b><br><br><br><br><br><b>${config.signerName}</b></td>
       </tr>
       </table>
       <div class="word-page-break"></div>

    2. TRƯỜNG "answers" (Đáp án):
       - Tạo đủ ${totalVariants} phần đáp án cho ${totalVariants} mã đề.
       - Với MỖI mã đề, lặp lại cấu trúc sau:
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
  `;
  
  parts.push({ text: prompt });

  try {
    const response = await fetch("/api/generate-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, parts })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Lỗi hệ thống khi gọi AI");
    }

    const parsed = await response.json();
    if (!parsed.questions || parsed.questions.length < 50) {
        throw new Error("AI không tạo được nội dung đề thi. Vui lòng thử lại.");
    }
    if (!parsed.answers || parsed.answers.length < 50) {
        parsed.answers = parsed.answers || "Hệ thống chưa tạo được đáp án chi tiết. Vui lòng thử lại.";
    }
    return parsed;
  } catch (error: any) {
    console.error("Lỗi khi tạo đề:", error);
    throw error;
  }
};

export const gradeSubmission = async (config: GradingConfig): Promise<{ content: string; score: string }> => {
    const parts: any[] = [];

    if (config.submissionFile) {
        parts.push(await fileToGenerativePart(config.submissionFile));
        parts.push({ text: "Đây là bài làm của sinh viên (file đầu tiên)." });
    }
    
    if (config.answerKeyFile) {
        parts.push(await fileToGenerativePart(config.answerKeyFile));
        parts.push({ text: "Đây là đáp án chuẩn và thang điểm (file thứ hai)." });
    }

    const prompt = `
      Chấm điểm bài làm dựa trên đáp án.
      Loại: ${config.gradingType === 'trac-nghiem' ? 'Trắc nghiệm' : 'Tự luận'}.
      
      Yêu cầu:
      - Tự luận: Chấm theo ý, so khớp với thang điểm (nếu có). Chi tiết đến 0.25đ.
      - Trắc nghiệm: Đếm số câu đúng.
      - Phản hồi JSON: { "feedback": "Chi tiết...", "score": "8.5/10" }
    `;

    parts.push({ text: prompt });

    try {
        const response = await fetch("/api/grade-submission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, parts })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Lỗi hệ thống khi chấm thi");
        }

        const parsed = await response.json();
        return { content: parsed.feedback, score: parsed.score };
    } catch (error: any) {
        console.error("Lỗi chấm thi:", error);
        throw error;
    }
};
