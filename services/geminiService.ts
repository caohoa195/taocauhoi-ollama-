import { ExamConfig, GradingConfig, FileData, QuestionType, DifficultyLevel } from "../types";
import { extractFileContent } from "./fileUtils";

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

    const rawText = await response.text();

    if (!response.ok) {
        let errorMsg = `Lỗi hệ thống khi gọi AI (${response.status})`;
        try {
            const errObj = JSON.parse(rawText);
            errorMsg = errObj.error || errorMsg;
        } catch {
            if (rawText.includes("<!doctype") || rawText.includes("<html")) {
              errorMsg = `Server trả về lỗi HTML (${response.status}). Vui lòng thử lại.`;
            } else if (rawText) {
              errorMsg = rawText.slice(0, 200);
            }
        }
        throw new Error(errorMsg);
    }

    let parsed: any;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        throw new Error("Phản hồi tạo đề từ AI không đúng định dạng JSON. Vui lòng thử lại.");
    }
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

    const typeDesc = gradingType === 'trac-nghiem' 
        ? 'Chuyên trách Trắc nghiệm' 
        : gradingType === 'tu-luan' 
        ? 'Chuyên trách Tự luận' 
        : 'Tự động nhận diện toàn diện (Chấm đủ cả Trắc nghiệm và Tự luận nếu đề thi hỗn hợp)';

    const fastRule = options?.fastFinalResultGrading !== false;

    const prompt = `
      Nhiệm vụ: Giám khảo Chấm thi Đại học công tâm, chính xác tuyệt đối từng câu.
      Chế độ chấm: ${typeDesc}.
      Tệp bài làm nộp lên: "${submissionFile.name}".
      ${options?.examQuestionFile ? `Đề bài gốc: "${options.examQuestionFile.name}". Bắt buộc đối chiếu theo từng yêu cầu của đề bài này.` : ''}
      ${answerKeyFile ? `Tệp đáp án chuẩn: "${answerKeyFile.name}" (nếu có nhiều mã đề, bắt buộc tìm đúng mã đề của thí sinh để đối chiếu).` : 'LƯU Ý: Không có tệp đáp án riêng. Giám khảo AI tự giải chính xác từng câu của đề thi làm đáp án chuẩn, sau đó tiến hành đối chiếu và chấm điểm.'}

      ${fastRule ? `
      ⭐ QUY TẮC CHẤM ĐẶC BIỆT: "NẾU BÀI LÀM ĐÚNG ĐÁP ÁN CUỐI CÙNG CHO ĐIỂM CUỐI CÙNG, CÒN KHÔNG ĐÚNG ĐÁP ÁN CUỐI CÙNG MỚI CHẤM ĐIỂM CÁC THÀNH PHẦN":
      - Với từng câu / ý tự luận:
        + BƯỚC 1: Tìm kết quả / đáp số cuối cùng của thí sinh (kể cả kèm đơn vị đo). Nếu kết quả cuối cùng ĐÚNG -> Cho ngay ĐIỂM TỐI ĐA (điểm cuối cùng trọn vẹn) của câu/ý đó (ghi nhận: "✅ Đáp số cuối cùng chính xác -> Đạt trọn điểm").
        + BƯỚC 2: Chỉ khi kết quả cuối cùng SAI, tính nhầm, hoặc chưa xong: MỚI BẮT ĐẦU rà soát từng thành phần (công thức gốc, biến đổi trung gian, thay số) để cho điểm thành phần các bước đúng theo bareme.
      ` : ''}

      YÊU CẦU BẮT BUỘC ĐỂ CHẤM CHUẨN XÁC:
      1. TÌM TÊN THÍ SINH & TÁCH BÀI:
         - Quét tìm Họ và tên thật, MSSV/SBD, Lớp, Mã đề thi.
         - NẾU TÀI LIỆU CÓ BÀI THI CỦA 2 HAY NHIỀU THÍ SINH: Bắt buộc tách thành từng phần tử riêng biệt trong mảng "students" (mỗi em một phần tử).
      2. ĐỐI CHIẾU TỪNG CÂU VÀ TÍNH ĐIỂM CHUẨN XÁC:
         - Đọc kỹ bài làm: Thí sinh có thể khoanh trực tiếp, viết bảng đáp án hoặc viết lời giải.
         - Trắc nghiệm: Lập bảng đối chiếu từng câu (| Câu | Đáp án thí sinh | Đáp án chuẩn | Đánh giá | Điểm đạt |).
         - Tự luận: Lập bảng điểm chi tiết từng câu:
           | Câu / Ý | Yêu cầu đề bài | Kết quả cuối của HS | Đánh giá KQ cuối | Phương thức chấm | Thang điểm | Điểm đạt | Nhận xét chi tiết (Thành phần nếu sai) |
         - Đề hỗn hợp: Bắt buộc chấm cả trắc nghiệm và tự luận.
      3. KHÔNG SAI LỆCH SỐ HỌC:
         - Tổng điểm ở "score" và "TỔNG ĐIỂM CHÍNH THỨC" trong feedback BẮT BUỘC bằng đúng tổng cộng điểm đạt của từng câu trong Bảng điểm chi tiết!
      4. PHIẾU CHẤM ĐIỂM CHUẨN ĐẠI HỌC TRONG "feedback":
         Trình bày đầy đủ: Tiêu đề phiếu, Thông tin thí sinh, Bảng điểm chi tiết, Tổng điểm (số + chữ), Xếp loại, Nhận xét ưu/nhược điểm và Bảng chữ ký 2 giám khảo.
    `;

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

