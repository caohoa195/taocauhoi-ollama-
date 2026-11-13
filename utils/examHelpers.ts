import { DifficultyLevel, ExamConfig, QuestionType } from '../types';

export function formatExamFromVariants(variants: any[], meta: any): { questions: string; answers: string } {
  const faculty = String(meta?.faculty || 'KHOA').toUpperCase();
  const department = String(meta?.department || 'BỘ MÔN').toUpperCase();
  const subject = String(meta?.subject || '');
  const targetAudience = String(meta?.targetAudience || '');
  const duration = String(meta?.duration || '60');
  const signerTitle = String(meta?.signerTitle || 'TRƯỞNG BỘ MÔN');
  const signerName = String(meta?.signerName || '');

  const examHeader = `| **KHOA ${faculty}**<br>**BỘ MÔN ${department}** | **ĐỀ THI KẾT THÚC HỌC PHẦN**<br>Môn: ${subject}<br>Đối tượng: ${targetAudience}<br>Thời gian: ${duration} phút |\n| :--- | :--- |`;
  const answerHeader = `| **KHOA ${faculty}**<br>**BỘ MÔN ${department}** | **ĐÁP ÁN ĐỀ THI**<br>Môn: ${subject}<br>Đối tượng: ${targetAudience} |\n| :--- | :--- |`;
  const signatureBlock = `<br>\n<table style="width: 100%; border: none; margin-top: 30px;">\n<tr>\n<td style="width: 50%; border: none; vertical-align: top;">---</td>\n<td style="width: 50%; text-align: center; border: none; vertical-align: top;"><b>${signerTitle}</b><br><br><br><br><br><b>${signerName}</b></td>\n</tr>\n</table>`;

  const questionBlocks: string[] = [];
  const answerBlocks: string[] = [];

  variants.forEach((v, idx) => {
    const num = v.variantNumber || idx + 1;

    // 1. Format Questions deterministically
    const qList: string[] = [];
    const rawQuestions = Array.isArray(v.questions) ? v.questions : [];
    let lastSection = '';
    for (let qi = 0; qi < rawQuestions.length; qi++) {
      const q = rawQuestions[qi];
      const secTitle = String(q.sectionTitle || '').trim();
      if (secTitle && secTitle !== lastSection) {
        lastSection = secTitle;
        const cleanSec = secTitle.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
        qList.push(`### **${cleanSec}**`);
      }

      let label = String(q.questionLabel || `Câu ${qi + 1}:`).trim();
      if (!label.startsWith('**')) label = `**${label}**`;
      let body = String(q.questionContent || '').trim();
      if (secTitle) {
        const cleanSec = secTitle.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
        if (cleanSec && body.toUpperCase().startsWith(cleanSec.toUpperCase())) {
          body = body.slice(cleanSec.length).replace(/^[.:\-\s]+/, '').trim();
        }
      }

      // If 4 MCQ options A., B., C., D. are present inline, break them cleanly onto indented lines
      const hasAllMcqOptions = /(?:^|\s)A\.\s+[\s\S]*?\sB\.\s+[\s\S]*?\sC\.\s+[\s\S]*?\sD\.\s+/m.test(body);
      if (hasAllMcqOptions) {
        body = body
          .replace(/([?:.;!”"']|\n|^)\s*(A\.)\s+/g, '$1\n\n   **$2** ')
          .replace(/\s+(B\.)\s+/g, '\n\n   **$1** ')
          .replace(/\s+(C\.)\s+/g, '\n\n   **$1** ')
          .replace(/\s+(D\.)\s+/g, '\n\n   **$1** ');
      }

      // Ensure sub-parts a), b), c), d) break cleanly onto indented lines if joined inline
      body = body.replace(/([.:;?!])\s+([a-d]\))\s+/gi, '$1\n\n   **$2** ');
      body = body.replace(/^([a-d]\))\s+/i, '\n\n   **$1** ');
      qList.push(`${label} ${body}`.trim());
    }

    const qBlock = [
      examHeader,
      `<center><h3>ĐỀ SỐ ${num}</h3></center>`,
      ...qList,
      signatureBlock,
    ].join('\n\n');
    questionBlocks.push(qBlock);

    // 2. Format Answers deterministically (Strictly 2 columns)
    const rawSteps = Array.isArray(v.answerRows) ? v.answerRows : [];
    const tableRows: string[] = [
      '| Nội dung | Điểm |',
      '| :--- | :---: |',
    ];
    let numericSum = 0;

    for (const step of rawSteps) {
      const content = String(step.content || '').replace(/\r?\n/g, '<br>').replace(/\|/g, '/').trim();
      if (!content) continue;
      if (content.toUpperCase().includes('TỔNG ĐIỂM')) continue;

      const pts = String(step.points ?? '').replace(/\|/g, '').trim();
      const numericMatch = pts.replace(',', '.').match(/^\d+(?:\.\d+)?$/);
      const rowVal = numericMatch ? parseFloat(numericMatch[0]) : NaN;

      // Auto-split combined sub-items like "a) Đúng (0.5đ), b) Sai (0.25đ)..." into individual <=0.5pt rows
      if (!isNaN(rowVal) && rowVal > 0.5) {
        const subMatches = [...content.matchAll(/([a-d]\)\s*[^()]+?)\s*\((\d+(?:[.,]\d+)?)\s*đ?\)/gi)];
        if (subMatches.length >= 2) {
          for (const sm of subMatches) {
            const subText = sm[1].replace(/[,;]\s*$/, '').trim();
            const subPtStr = sm[2].replace(',', '.');
            const subPtVal = parseFloat(subPtStr);
            if (!isNaN(subPtVal)) numericSum += subPtVal;
            tableRows.push(`| ${subText} | ${subPtStr} |`);
          }
          continue;
        }
      }

      if (!isNaN(rowVal)) numericSum += rowVal;
      tableRows.push(`| ${content} | ${pts} |`);
    }

    const roundedSum = Math.round(numericSum * 100) / 100;
    const totalDisplay = roundedSum > 0
      ? (Number.isInteger(roundedSum * 10) ? roundedSum.toFixed(1) : roundedSum.toFixed(2))
      : '10.0';
    tableRows.push(`| **TỔNG ĐIỂM TOÀN BÀI** | **${totalDisplay}** |`);

    const aBlock = [
      answerHeader,
      `<center><h3>ĐÁP ÁN ĐỀ SỐ ${num}</h3></center>`,
      tableRows.join('\n'),
      signatureBlock,
    ].join('\n\n');
    answerBlocks.push(aBlock);
  });

  return {
    questions: questionBlocks.join('\n\n<div class="word-page-break"></div>\n\n'),
    answers: answerBlocks.join('\n\n<div class="word-page-break"></div>\n\n'),
  };
}

export function getExamSystemInstruction(examMeta: any): string {
  const useStructuredVariants = Boolean(examMeta && typeof examMeta === 'object');
  const qTypeStr = String(examMeta?.questionType || '');
  const isEssayType = qTypeStr === 'Tự luận' || qTypeStr === QuestionType.ESSAY;
  const isMixedObjectiveType = qTypeStr.includes('tổng hợp');

  if (!useStructuredVariants) {
    return `Bạn là Giảng viên Đại học biên soạn đề thi và đáp án chuẩn mực.
QUY ĐỊNH BẮT BUỘC:
1. TRƯỜNG "questions": Đề bài phải CHI TIẾT, ghi rõ điểm từng câu/ý (tổng toàn đề đúng 10.0 điểm).
2. TRƯỜNG "answers":
   - Bảng đáp án CHỈ ĐƯỢC CÓ ĐÚNG 2 CỘT: | Nội dung | Điểm | (Tuyệt đối KHÔNG thêm cột thứ 3).
   - KHÔNG CÓ ĐÁP ÁN 1.0 ĐIỂM (CHỈ CHẤM 0.25 HOẶC TỐI ĐA 0.5): Tuyệt đối không ghi 1.0, 1, 1.5, 2.0 hay 0.75 cho một dòng bước giải.`;
  }

  if (isEssayType) {
    return `Bạn là Giảng viên Đại học biên soạn đề thi và đáp án chuẩn mực, ổn định tuyệt đối (DETERMINISTIC).
QUY ĐỊNH BẮT BUỘC:
1. KHÔNG cần tự vẽ bảng tiêu đề Khoa/Bộ môn hay khung chữ ký (hệ thống sẽ tự ghép mẫu chuẩn cố định). Chỉ tập trung sinh đúng nội dung từng câu hỏi và từng dòng đáp án trong JSON.
2. MỖI CÂU HỎI ("questions") phải CHI TIẾT, chia rõ các ý nhỏ a), b), c), d)... kèm số điểm từng ý ngay trong đề bài (tổng toàn đề đúng 10.0 điểm) để chấm được chi tiết tới 0.25 điểm.
3. MỖI BƯỚC ĐÁP ÁN ("answerRows") chỉ gồm 2 trường "content" và "points":
   - Dòng tiêu đề câu/ý ghi đậm (ví dụ "**Câu 1 (2.5 điểm):**") và để "points": "".
   - KHÔNG CÓ BẤT KỲ DÒNG NÀO CHẤM 1.0 ĐIỂM TRỞ LÊN: Tuyệt đối không ghi "1.0", "1", "1.5", "2.0" hay "0.75" vào "points". Mọi dòng bước giải chi tiết CHỈ ĐƯỢC PHÉP ghi "0.25" (ưu tiên hàng đầu) hoặc tối đa "0.5".
   - Mỗi dòng bước giải phải ghi cụ thể nội dung đáp án (nguyên văn định nghĩa, công thức, phép biến đổi, số liệu thay vào, kết quả cuối kèm đơn vị). Tổng cộng các giá trị "points" trong một đề phải đúng bằng 10.0.`;
  }

  return `Bạn là Giảng viên Đại học biên soạn đề thi trắc nghiệm và đáp án chuẩn mực, ổn định tuyệt đối (DETERMINISTIC).
QUY ĐỊNH BẮT BUỘC:
1. KHÔNG cần tự vẽ bảng tiêu đề Khoa/Bộ môn hay khung chữ ký (hệ thống sẽ tự ghép mẫu chuẩn cố định). Chỉ tập trung sinh đúng nội dung từng câu hỏi và từng dòng đáp án trong JSON. KHÔNG lặp lại tên "PHẦN I..." bên trong "questionContent" (chỉ đặt ở "sectionTitle").
2. ${isMixedObjectiveType
    ? 'TUÂN THỦ CHÍNH XÁC 100% SỐ CÂU TỪNG DẠNG VÀ TỪNG MỨC ĐỘ (Nhận biết, Thông hiểu, Vận dụng, Vận dụng nâng cao) trong ma trận. Điền "sectionTitle" cho từng câu (vd: "PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN", "PHẦN II. CÂU HỎI ĐÚNG / SAI", "PHẦN III. ĐIỀN VÀO CHỖ TRỐNG") và đánh số câu liên tục từ Câu 1 đến hết.'
    : 'TẠO ĐÚNG DẠNG CÂU HỎI VÀ ĐÚNG SỐ LƯỢNG CÂU ĐƯỢC YÊU CẦU.'}
   - Với Trắc nghiệm 4 phương án: ghi rõ câu dẫn và đủ 4 phương án A., B., C., D. (chỉ 1 đáp án đúng).
   - Với Đúng/Sai: mỗi câu có phát biểu dẫn và chia thành 2-4 ý nhận định nhỏ a), b), c), d) (mỗi ý 0.25đ hoặc 0.5đ).
   - Với Điền vào chỗ trống: có câu văn/biểu thức chứa 2-3 chỗ trống (1) ......, (2) ...... (hoặc 1 chỗ trống nếu câu <= 0.5đ) để chấm chi tiết đến 0.25/0.5đ.
   - Ghi rõ mức độ nhận thức và điểm số từng câu trong "questionLabel" (tổng toàn đề đúng 10.0 điểm).
3. MỖI BƯỚC ĐÁP ÁN ("answerRows") chỉ gồm 2 trường "content" và "points":
   - Dòng tiêu đề phần/câu ghi đậm (ví dụ "**Câu 1 (0.5 điểm):**") và để "points": "".
   - KHÔNG CÓ BẤT KỲ DÒNG NÀO CHẤM >= 0.75 ĐIỂM: Tuyệt đối KHÔNG gộp 4 ý a, b, c, d vào chung 1 dòng hay ghi "0.75", "1.0", "1.5", "2.0" ở trường "points". MỖI ý a), b), c), d) của câu Đúng/Sai và MỖI chỗ trống của câu Điền khuyết phải là MỘT DÒNG RIÊNG BIỆT trong "answerRows" với "points" là "0.25" hoặc "0.5".
   - Tổng cộng các giá trị "points" trong một đề phải đúng bằng 10.0.`;
}

export function buildExamMetaAndPrompt(config: ExamConfig): {
  examMeta: Record<string, any>;
  prompt: string;
  totalVariants: number;
} {
  let structurePrompt = '';
  let variantPrompt = '';
  let questionStyleGuide = '';
  const isEssay = config.questionType === QuestionType.ESSAY;
  const isMixedObjective = config.questionType === QuestionType.MIXED_OBJECTIVE;
  const totalVariants =
    ((isEssay || isMixedObjective) && config.variantCount) ? config.variantCount : 1;

  if (isEssay && config.levelDistribution) {
    structurePrompt = `
      CẤU TRÚC MA TRẬN ĐỀ THI TỰ LUẬN:
      - Nhận biết: ${config.levelDistribution[DifficultyLevel.RECOGNITION]} câu
      - Thông hiểu: ${config.levelDistribution[DifficultyLevel.UNDERSTANDING]} câu
      - Vận dụng: ${config.levelDistribution[DifficultyLevel.APPLICATION]} câu
      - Vận dụng cao: ${config.levelDistribution[DifficultyLevel.ADVANCED_APPLICATION]} câu
      `;
    variantPrompt = `SỐ LƯỢNG MÃ ĐỀ CẦN TẠO: ${totalVariants} ĐỀ KHÁC NHAU (Về nội dung, cùng độ khó).`;
    questionStyleGuide = `
       - Mỗi câu hỏi tự luận phải đầy đủ dữ kiện rõ ràng và BẮT BUỘC chia thành nhiều ý nhỏ cụ thể (a), b), c), d)...) hoặc nhiều yêu cầu thành phần (nêu định nghĩa/nguyên lý, viết công thức và giải thích đại lượng, thiết lập phương trình/chứng minh, thay số tính toán, nhận xét/biện luận).
       - Ghi rõ điểm từng câu và từng ý ngay trong đề bài (tổng toàn đề đúng 10.0 điểm).
       - Ví dụ:
         questionLabel: "Câu 1 (Nhận biết - 2.5 điểm):"
         questionContent: "a) Phát biểu định luật... (1.0đ). b) Viết biểu thức công thức và giải thích các đại lượng... (1.5đ)."`;
  } else if (isMixedObjective && config.objectiveMatrix) {
    const romanParts = ['PHẦN I', 'PHẦN II', 'PHẦN III'];
    let activePartIdx = 0;
    const sectionLines: string[] = [];
    let grandTotal = 0;

    for (const sec of config.objectiveMatrix) {
      const r = sec.counts[DifficultyLevel.RECOGNITION] || 0;
      const u = sec.counts[DifficultyLevel.UNDERSTANDING] || 0;
      const a = sec.counts[DifficultyLevel.APPLICATION] || 0;
      const aa = sec.counts[DifficultyLevel.ADVANCED_APPLICATION] || 0;
      const subTotal = r + u + a + aa;
      if (subTotal <= 0) continue;
      grandTotal += subTotal;
      const partLabel = romanParts[activePartIdx] || `PHẦN ${activePartIdx + 1}`;
      activePartIdx++;
      sectionLines.push(
        `- ${partLabel} - ${sec.type} (Tổng ${subTotal} câu): Nhận biết: ${r} câu | Thông hiểu: ${u} câu | Vận dụng: ${a} câu | Vận dụng nâng cao: ${aa} câu`
      );
    }

    structurePrompt = `
      CẤU TRÚC MA TRẬN ĐỀ TRẮC NGHIỆM TỔNG HỢP (Tổng cộng ${grandTotal} câu):
      ${sectionLines.join('\n      ')}
      `;
    variantPrompt = `SỐ LƯỢNG MÃ ĐỀ CẦN TẠO: ${totalVariants} ĐỀ KHÁC NHAU (Cùng cấu trúc ma trận và độ khó).`;
    questionStyleGuide = `
       - Phân chia rõ từng PHẦN theo đúng ma trận trên và điền trường "sectionTitle" cho mỗi câu hỏi (ví dụ: "PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN", "PHẦN II. CÂU HỎI ĐÚNG / SAI", "PHẦN III. ĐIỀN VÀO CHỖ TRỐNG"). Chỉ tạo đúng các phần có số câu > 0 và TẠO ĐỦ SỐ CÂU Ở TỪNG MỨC ĐỘ (Nhận biết, Thông hiểu, Vận dụng, Vận dụng nâng cao) như ma trận.
       - Với dạng Trắc nghiệm 4 phương án: questionLabel ghi rõ số câu, mức độ và điểm (vd: "Câu 1 (Nhận biết - 0.5 điểm):"). questionContent chứa câu dẫn rõ ràng kèm đủ 4 phương án A. ... B. ... C. ... D. ... (chỉ 1 phương án đúng).
       - Với dạng Đúng/Sai: questionLabel ghi rõ số câu, mức độ và điểm (vd: "Câu 11 (Thông hiểu - 1.0 điểm):"). Mỗi câu có phát biểu dẫn và chia các nhận định nhỏ a), b), c), d) (mỗi ý 0.25đ hoặc 0.5đ) hoặc nhận định Đúng/Sai kèm yêu cầu giải thích ngắn gọn.
       - Với dạng Điền vào chỗ trống: questionLabel ghi rõ số câu, mức độ và điểm. questionContent chứa câu văn/biểu thức có chỗ trống "......" để điền từ khóa hoặc giá trị chính xác.
       - Tổng điểm toàn đề phải đúng bằng 10.0 điểm.`;
  } else {
    structurePrompt = `CẤU TRÚC: ${config.quantity} câu loại "${config.questionType}", mức độ ${config.difficulty}.`;
    variantPrompt = `Tạo duy nhất 01 đề thi.`;
    if (config.questionType === QuestionType.MULTIPLE_CHOICE) {
      questionStyleGuide = `
       - Mỗi câu trắc nghiệm có câu dẫn rõ ràng kèm đủ 4 phương án lựa chọn A., B., C., D. (chỉ 1 phương án đúng), ghi rõ mức độ và điểm từng câu trong questionLabel (tổng toàn đề đúng 10.0 điểm).`;
    } else if (config.questionType === QuestionType.TRUE_FALSE) {
      questionStyleGuide = `
       - Mỗi câu Đúng/Sai có phát biểu/dữ kiện rõ ràng (có thể chia các ý nhận định a), b), c), d) mỗi ý 0.25đ/0.5đ hoặc nhận định Đúng/Sai kèm giải thích), ghi rõ mức độ và điểm từng câu trong questionLabel (tổng toàn đề đúng 10.0 điểm).`;
    } else {
      questionStyleGuide = `
       - Mỗi câu điền khuyết có câu văn/biểu thức rõ ràng chứa chỗ trống "......" (hoặc các ý (1)......, (2)......), ghi rõ mức độ và điểm từng câu trong questionLabel (tổng toàn đề đúng 10.0 điểm).`;
    }
  }

  const examMeta = {
    faculty: config.faculty,
    department: config.department,
    subject: config.subject,
    targetAudience: config.targetAudience,
    duration: config.duration,
    signerTitle: config.signerTitle,
    signerName: config.signerName,
    variantCount: totalVariants,
    questionType: config.questionType,
    objectiveMatrix: config.objectiveMatrix,
  };

  const prompt = `
    Đóng vai trò là giảng viên đại học.
    Nhiệm vụ: Tạo ${totalVariants} mã đề thi và đáp án chi tiết cho môn ${config.subject} (đối tượng: ${config.targetAudience}, thời gian: ${config.duration} phút).
    
    THÔNG SỐ CHUNG:
    - Chủ đề: ${config.topic || 'Tổng hợp'}
    - Loại câu hỏi: ${config.questionType}
    - Yêu cầu đặc biệt: ${config.specificRequirement || 'Không có'}
    
    ${structurePrompt}
    ${variantPrompt}
    
    YÊU CẦU NỘI DUNG CHI TIẾT ĐỂ CHẤM ĐẾN 0.25 ĐIỂM:
    1. Trả về JSON có mảng "variants" với ĐÚNG ${totalVariants} phần tử (variantNumber từ 1 đến ${totalVariants}).
    2. KHÔNG cần sinh tiêu đề Khoa/Bộ môn hay khung chữ ký trong JSON (hệ thống tự ghép mẫu cố định đồng nhất).
    3. TRONG MỖI MÃ ĐỀ ("questions"):
       ${questionStyleGuide}
    4. TRONG MỖI BỘ ĐÁP ÁN ("answerRows"):
       - Mỗi phần tử là 1 dòng của bảng 2 cột (content | points).
       - Dòng tiêu đề câu/phần/ý ghi rõ tổng điểm trong "content" (ví dụ "**Câu 1 (0.5 điểm):**" hoặc "**PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN**") và để "points": "".
       - KHÔNG CÓ BẤT KỲ BƯỚC ĐÁP ÁN NÀO CHẤM 1.0 ĐIỂM TRỞ LÊN: Tuyệt đối không ghi "1.0", "1", "1.5", "2.0" hay "0.75" ở trường "points". Mọi dòng bước đáp án/giải chi tiết CHỈ ĐƯỢC PHÉP ghi "0.25" (ưu tiên hàng đầu) hoặc tối đa "0.5". Nếu một câu có tổng 1.0đ trở lên thì BẮT BUỘC tách thành nhiều dòng 0.25đ/0.5đ (ví dụ: chọn đáp án/nhận định đúng + giải thích ngắn/công thức kiểm chứng).
       - Mỗi dòng đáp án phải ghi NGUYÊN VĂN nội dung cụ thể (phương án đúng, Đúng/Sai, từ cần điền, định nghĩa, công thức, kết quả cuối kèm đơn vị). Tổng cộng các điểm số trong mỗi đề phải đúng bằng 10.0.
  `;

  return { examMeta, prompt, totalVariants };
}

export const GRADING_SYSTEM_INSTRUCTION = `
Bạn là Trưởng Ban Chấm thi Đại học / Hội đồng Chấm thi Quốc gia công tâm, nghiêm ngặt, chuẩn mực và ổn định tuyệt đối (DETERMINISTIC).
Mục tiêu tối thượng: Kết quả chấm phải CHUẨN XÁC, CÔNG BẰNG, KHÔNG THAY ĐỔI GIỮA CÁC LẦN CHẤM, và TUYỆT ĐỐI KHÔNG ĐỂ XẢY RA HIỆN TƯỢNG BÀI TỆ LẠI CÓ ĐIỂM CAO HƠN BÀI TỐT.

QUY TẮC BẮT BUỘC ĐỂ ĐẢM BẢO TÍNH ỔN ĐỊNH VÀ CÔNG BẰNG 100%:

1. CỐ ĐỊNH BẢNG BAREM THANG ĐIỂM (RUBRIC ANCHORING):
   - Đọc kỹ ĐỀ BÀI và ĐÁP ÁN CHUẨN để trích xuất cố định danh sách tất cả các câu hỏi (ví dụ Câu 1a, 1b, 1c, 1d; Câu 2a, 2b, 2c, 2d...) và thang điểm tối đa của từng câu (Tổng điểm tối đa toàn bài bắt buộc đúng bằng 10.0 điểm).
   - TẤT CẢ CÁC BÀI THI trong cùng đợt chấm đều BẮT BUỘC PHẢI DÙNG CHUNG ĐÚNG 1 BẢNG BAREM NÀY. Thang điểm của từng câu không được thay đổi bất thường giữa các thí sinh hay giữa các lần chấm.

2. CÔNG BẰNG TUYỆT ĐỐI & CHỐNG ĐẢO NGƯỢC THỨ HẠNG (ANTI-INVERSION):
   - Thí sinh làm nhiều câu hơn, giải đúng nhiều bước hơn BẮT BUỘC PHẢI CÓ ĐIỂM CAO HƠN thí sinh bỏ câu, làm ít hoặc làm sai.
   - BỎ TRỐNG / KHÔNG LÀM: Bất kỳ câu nào thí sinh không giải hoặc bỏ trống trong bài làm (ví dụ: không làm câu 2c, 2d), BẮT BUỘC CHO 0.0 ĐIỂM cho câu đó trong Bảng điểm chi tiết.
   - CHỐNG ĐOÁN MÒ / GHI BỪA SỐ: Để được công nhận "Đúng kết quả cuối cùng", thí sinh BẮT BUỘC PHẢI CÓ CÁC BƯỚC BIẾN ĐỔI / CÔNG THỨC / LỜI GIẢI HỢP LÝ trong bài thi dẫn đến kết quả đó.
     * Nếu thí sinh chỉ ghi trơ trọi một con số kết quả mà hoàn toàn không có lời giải/bước tính: KHÔNG ĐƯỢC CHO TRỌN ĐIỂM (tối đa chỉ 0.25đ phần đáp số nếu đúng số).
     * Tuyệt đối không cho điểm nếu thí sinh ghi bừa kết quả mà không làm bài.
   - CHẤM THÀNH PHẦN CÔNG BẰNG CHO THÍ SINH GIẢI ĐÚNG BẢN CHẤT:
     * Thí sinh viết đúng công thức gốc, biến đổi đúng phương pháp nhưng chỉ tính nhầm số học ở bước cuối: BẮT BUỘC cho điểm các bước làm đúng (chiếm 60% - 80% số điểm của câu), chỉ trừ phần điểm đáp số cuối (20% - 40%). Tuyệt đối không được trừ sạch điểm của thí sinh giải đúng phương pháp.

3. QUY TRÌNH CHẤM THEO KẾT QUẢ CUỐI CÙNG & THÀNH PHẦN:
   - Với MỖI câu hỏi / ý:
     + BƯỚC 1: Kiểm tra xem thí sinh có giải câu này không. Nếu BỎ TRỐNG -> Cho 0.0đ.
     + BƯỚC 2: Kiểm tra Lời giải & Kết quả cuối cùng:
       * NẾU CÓ LỜI GIẢI HỢP LÝ VÀ ĐÁP ÁN CUỐI CÙNG ĐÚNG (kể cả kèm đơn vị đo theo đề bài): Cho ngay ĐIỂM TỐI ĐA TRỌN VẸN của câu đó (Cách chấm áp dụng: "Trọn điểm (Đúng KQ cuối)").
       * NẾU KẾT QUẢ CUỐI CÙNG SAI / THIẾU / TÍNH NHẦM: Rà soát từng thành phần theo barem điểm từng bước (Công thức gốc -> Biến đổi -> Thay số). Cho điểm thành phần ở các bước thí sinh làm đúng, chỉ trừ điểm ở bước tính sai (Cách chấm áp dụng: "Chấm thành phần (Sai KQ cuối)").

4. PHIẾU CHẤM ĐIỂM CHUẨN ĐẠI HỌC (KHUÔN MẪU PHIÊN BẢN CŨ):
Mọi bài thi đều phải xuất ra phiếu chấm trong trường "feedback" theo đúng chuẩn mẫu cũ sau:

# PHIẾU CHẤM ĐIỂM THI KẾT THÚC HỌC PHẦN

- **Họ và tên thí sinh:** [Họ tên thật của thí sinh trích xuất từ bài thi]
- **Mã số sinh viên (MSSV / SBD):** [MSSV hoặc Không có]
- **Lớp / Khóa:** [Lớp hoặc Không có]
- **Mã đề thi:** [Mã đề hoặc Không có]

### BẢNG ĐIỂM CHI TIẾT TỪNG CÂU
| Câu / Ý | Yêu cầu đề bài | Kết quả cuối của HS | Đánh giá KQ cuối | Phương thức chấm | Thang điểm | Điểm đạt | Nhận xét chi tiết (Thành phần nếu sai) |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
[Liệt kê đầy đủ mọi câu từ Câu 1 đến câu cuối cùng theo đúng barem đề thi, không được bỏ sót câu nào]

### TỔNG KẾT ĐÁNH GIÁ & XẾP LOẠI
- **TỔNG ĐIỂM CHÍNH THỨC:** **[X.X] / 10** (*Bằng chữ: [Ghi điểm bằng chữ]*)
- **Thang điểm 4:** **[Y.Y / 4.0]** | **Điểm chữ:** **[A/B/C/D/F]**
- **Xếp loại:** **[Xuất sắc / Giỏi / Khá / Trung bình / Chưa đạt]**
- **Nhận xét chung:**
  - **Ưu điểm:** [Nêu ưu điểm của bài làm]
  - **Hạn chế / Lưu ý:** [Nêu các điểm sai sót hoặc câu chưa làm]

| CÁN BỘ CHẤM THI 1 | CÁN BỘ CHẤM THI 2 |
| :---: | :---: |
| *(Ký và ghi rõ họ tên)* | *(Ký và ghi rõ họ tên)* |

5. CỘNG ĐIỂM CHÍNH XÁC TUYỆT ĐỐI (ARITHMETIC INTEGRITY):
   - "totalScoreNum" và "score" BẮT BUỘC PHẢI BẰNG ĐÚNG tổng cộng điểm đạt của từng câu trong Bảng điểm chi tiết (ví dụ: các câu trong bảng cộng lại ra 6.5 thì totalScoreNum phải là 6.5 và score là "6.5/10", tuyệt đối không được ghi sai lệch).
`;

export function buildGradingUserPrompt(params: {
  submissionFileName: string;
  examQuestionFileName?: string | null;
  answerKeyFileName?: string | null;
  gradingType: 'auto' | 'trac-nghiem' | 'tu-luan' | 'hon-hop';
  fastFinalResultGrading?: boolean;
}): string {
  const typeDesc = params.gradingType === 'trac-nghiem'
    ? 'Chuyên trách Trắc nghiệm'
    : params.gradingType === 'tu-luan'
    ? 'Chuyên trách Tự luận'
    : 'Tự động nhận diện toàn diện (Chấm đủ cả Trắc nghiệm và Tự luận nếu đề thi hỗn hợp)';

  const fastRule = params.fastFinalResultGrading !== false;

  return `
      Nhiệm vụ: Giám khảo Chấm thi Đại học công tâm, chính xác tuyệt đối từng câu.
      Chế độ chấm: ${typeDesc}.
      Tệp bài làm nộp lên: "${params.submissionFileName}".
      ${params.examQuestionFileName ? `Đề bài gốc: "${params.examQuestionFileName}". Bắt buộc đối chiếu theo từng yêu cầu của đề bài này.` : ''}
      ${params.answerKeyFileName ? `Tệp đáp án chuẩn: "${params.answerKeyFileName}" (nếu có nhiều mã đề, bắt buộc tìm đúng mã đề của thí sinh để đối chiếu).` : 'LƯU Ý: Không có tệp đáp án riêng. Giám khảo AI tự giải chính xác từng câu của đề thi làm đáp án chuẩn, sau đó tiến hành đối chiếu và chấm điểm.'}

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
}

export function numberToVietnameseScore(num: number): string {
  const digitWords = ['Không', 'Một', 'Hai', 'Ba', 'Bốn', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười'];
  const rounded = Math.round(num * 100) / 100;
  const intPart = Math.floor(rounded);
  const decPart = Math.round((rounded - intPart) * 100);
  let res = digitWords[intPart] || intPart.toString();
  if (decPart > 0) {
    if (decPart % 10 === 0) {
      const d = decPart / 10;
      res += ' phẩy ' + (d === 5 ? 'năm' : (digitWords[d] ? digitWords[d].toLowerCase() : d));
    } else if (decPart < 10) {
      res += ' phẩy không ' + (digitWords[decPart] ? digitWords[decPart].toLowerCase() : decPart);
    } else {
      const d1 = Math.floor(decPart / 10);
      const d2 = decPart % 10;
      const w1 = d1 === 7 ? 'bảy' : (digitWords[d1] ? digitWords[d1].toLowerCase() : d1);
      const w2 = d2 === 5 ? 'lăm' : (digitWords[d2] ? digitWords[d2].toLowerCase() : d2);
      res += ' phẩy ' + w1 + ' ' + w2;
    }
  }
  return res;
}

export function extractExactScoreFromFeedback(md: string): number | null {
  if (!md || typeof md !== 'string') return null;

  // 1. Try extracting from Table "Điểm đạt"
  const lines = md.split(/\r?\n/);
  let headerCol = -1;
  const scores: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    if (/^\|\s*[: -]+\s*\|/.test(trimmed)) continue;

    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());

    if (headerCol === -1) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i].toLowerCase();
        if (c.includes('điểm đạt') || c.includes('điểm số') || (c.includes('điểm') && !c.includes('thang'))) {
          headerCol = i;
          break;
        }
      }
      continue;
    }

    const rowText = trimmed.toLowerCase();
    if (rowText.includes('tổng cộng') || rowText.includes('tổng điểm')) continue;

    if (cells.length > headerCol) {
      const clean = cells[headerCol].replace(/[^\d.,]/g, '').replace(',', '.');
      const val = parseFloat(clean);
      if (!isNaN(val)) {
        scores.push(val);
      }
    }
  }

  if (scores.length > 0) {
    const total = scores.reduce((a, b) => a + b, 0);
    return Math.max(0, Math.min(10, Math.round(total * 100) / 100));
  }

  // 2. Fallback: Try extracting from addition expression before "="
  const match = md.match(/-\s*\*\*Chi tiết cộng điểm:\*\*\s*(.*?)(?=\n|$)/i);
  if (match) {
    const lhs = match[1].split('=')[0];
    const nums = (lhs.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => parseFloat(n.replace(',', '.')));
    if (nums.length > 0) {
      const total = nums.reduce((a, b) => a + b, 0);
      return Math.max(0, Math.min(10, Math.round(total * 100) / 100));
    }
  }

  return null;
}

export function getGradeMetadata(exactScore: number): { gpa4: number; gradeLetter: string; rank: string } {
  if (exactScore >= 8.5) {
    return { gpa4: 4.0, gradeLetter: 'A', rank: 'Xuất sắc' };
  }
  if (exactScore >= 8.0) {
    return { gpa4: 3.5, gradeLetter: 'B+', rank: 'Giỏi' };
  }
  if (exactScore >= 7.0) {
    return { gpa4: 3.0, gradeLetter: 'B', rank: 'Khá' };
  }
  if (exactScore >= 6.5) {
    return { gpa4: 2.5, gradeLetter: 'C+', rank: 'Trung bình khá' };
  }
  if (exactScore >= 5.5) {
    return { gpa4: 2.0, gradeLetter: 'C', rank: 'Trung bình' };
  }
  if (exactScore >= 5.0) {
    return { gpa4: 1.5, gradeLetter: 'D+', rank: 'Trung bình yếu' };
  }
  if (exactScore >= 4.0) {
    return { gpa4: 1.0, gradeLetter: 'D', rank: 'Đạt (yếu)' };
  }
  return { gpa4: 0.0, gradeLetter: 'F', rank: 'Chưa đạt (Kém)' };
}

export function synchronizeStudentScores(students: any[]): void {
  for (const st of students) {
    const exactScore = extractExactScoreFromFeedback(st.feedback);
    if (exactScore !== null) {
      st.totalScoreNum = exactScore;
      st.score = `${exactScore}/10`;
      st.scoreText = numberToVietnameseScore(exactScore);

      let fb = st.feedback;
      fb = fb.replace(/(-\s*\*\*Chi tiết cộng điểm:\*\*.*?=)\s*[\d.,]+\s*đ?/i, `$1 ${exactScore}đ`);
      fb = fb.replace(/(-\s*\*\*(?:TỔNG ĐIỂM CHÍNH THỨC|Tổng điểm chính thức|Tổng điểm):\*\*\s*\*\*?).*?(\/\s*10\*\*?)/i, `$1${exactScore} $2`);
      fb = fb.replace(/(\*Bằng chữ:\s*)[^*]+(\*)/i, `$1${st.scoreText}$2`);

      const { gpa4, gradeLetter, rank } = getGradeMetadata(exactScore);

      fb = fb.replace(/(-\s*\*\*Thang điểm 4:\*\*\s*\*\*).*?(?=\n|$)/i, `- **Thang điểm 4:** **${gpa4.toFixed(1)} / 4.0** | **Điểm chữ:** **${gradeLetter}**`);
      fb = fb.replace(/(-\s*\*\*(?:Xếp loại|Xếp loại học lực):\*\*\s*\*\*).*?(?=\n|$)/i, `- **Xếp loại:** **${rank}**`);

      st.feedback = fb;
    } else if (typeof st.totalScoreNum === 'number') {
      const rounded = Math.round(st.totalScoreNum * 100) / 100;
      st.score = `${rounded}/10`;
    }
  }
}

export interface StructuredQuestionGradeRow {
  question: string;
  requirement?: string;
  expectedAnswer?: string;
  studentAnswer?: string;
  isFinalCorrect?: string;
  gradingMethod?: string;
  maxScore: number;
  earnedScore: number;
  comment?: string;
}

export interface StructuredGradedStudent {
  studentName?: string;
  studentId?: string;
  className?: string;
  examCode?: string;
  questionRows?: StructuredQuestionGradeRow[];
  strengths?: string;
  weaknesses?: string;
  feedback?: string;
  score?: string;
  totalScoreNum?: number;
  scoreText?: string;
}

const roundScore2 = (val: number): number => {
  const r = Math.round(val * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

const parseNumericScore = (val: any, fallback = 0): number => {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (cleaned) {
      const n = parseFloat(cleaned[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
};

const sanitizeTableCell = (val: any, fallback = ''): string => {
  const s = String(val ?? '').trim();
  if (!s) return fallback;
  return s.replace(/\r?\n/g, '<br>').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
};

export function sanitizeStudentField(value: any, kind: 'name' | 'meta' = 'name'): string {
  let raw = String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/^(?:họ và tên|họ tên|thí sinh|mssv|sbd|mã số sinh viên|lớp|mã đề)\s*[:：\-]?\s*/i, '')
    .trim();
  if (!raw) return '';

  const lower = raw.toLowerCase().replace(/[.:\-_[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const invalidExact = new Set([
    'không xác định',
    'không xác định được',
    'không rõ',
    'chưa xác định',
    'chưa rõ',
    'không tìm thấy',
    'không thấy',
    'không đọc được',
    'không có',
    'không ghi',
    'trống',
    'bỏ trống',
    'unknown',
    'n a',
    'na',
    'none',
    'null',
    'undefined',
  ]);
  if (invalidExact.has(lower)) return '';
  if (kind === 'name' && /^(?:không\s+(?:xác định|rõ|thấy|tìm thấy|ghi|có)|thí sinh|học sinh|sinh viên)$/i.test(lower)) {
    return '';
  }
  return raw;
}

const normalizeQuestionKey = (q: string): string => {
  return String(q || '')
    .replace(/\*\*/g, '')
    // Preserve sub-part letters like (a), (b), (c), (d) while stripping point/difficulty annotations
    .replace(/\(\s*([a-d])\s*\)/gi, ' $1 ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.:：\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const compactQuestionKey = (q: string): string => {
  return normalizeQuestionKey(q)
    .replace(/^(?:câu|bài|ý|phần)\s*/i, '')
    .replace(/\s+/g, '');
};

export function parseMasterRubricItems(masterRubric?: string): Array<{ question: string; maxScore: number }> {
  if (!masterRubric || typeof masterRubric !== 'string') return [];
  const items: Array<{ question: string; maxScore: number }> = [];
  const lines = masterRubric.split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(/^\s*[-*]?\s*(.+?)\s*:\s*Thang điểm tối đa\s*([^\s]+(?:\s*đ)?)/i);
    if (!m) continue;
    const rawName = m[1].replace(/\*\*/g, '').trim();
    const maxScore = roundScore2(Math.max(0, parseNumericScore(m[2], 0)));
    if (rawName && maxScore > 0) {
      items.push({ question: rawName, maxScore });
    }
  }

  return items;
}

export function extractDeterministicRubricFromText(rawText?: string): string {
  if (!rawText || typeof rawText !== 'string') return '';
  const lines = rawText.split(/\r?\n/);
  const items: Array<{ question: string; maxScore: number }> = [];
  let current: { question: string; maxScore: number } | null = null;

  const extractLinePoints = (line: string): number => {
    const clean = line.replace(/\*\*/g, '').trim();
    if (!clean || /tổng điểm|tổng cộng|thang điểm/i.test(clean)) return 0;

    // Pipe-delimited table row: inspect last cell first
    if (clean.includes('|')) {
      const cols = clean.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cols.length >= 2) {
        const lastCol = cols[cols.length - 1];
        const ptMatches = [...lastCol.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:đ|điểm)?(?=$|[\s.,;:)/|+\-])/gi)];
        if (ptMatches.length > 0 && /^[\d.,\sđđiểm/+\-]+$/i.test(lastCol)) {
          let sum = 0;
          for (const pm of ptMatches) {
            const v = parseFloat(pm[1].replace(',', '.'));
            if (Number.isFinite(v) && v > 0 && v <= 10) sum += v;
          }
          if (sum > 0) return roundScore2(sum);
        }
      }
    }

    // Explicit "... 0,75 đ" or "... (1.5 điểm)" (avoid \b after Unicode 'đ')
    const explicitMatches = [...clean.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:đ|điểm)(?=$|[\s.,;:)/|])/gi)];
    if (explicitMatches.length > 0) {
      let sum = 0;
      for (const em of explicitMatches) {
        const v = parseFloat(em[1].replace(',', '.'));
        if (Number.isFinite(v) && v > 0 && v <= 10) sum += v;
      }
      return roundScore2(sum);
    }

    // Standalone decimal point value on its own line (from table column extraction)
    if (/^\d+(?:[.,]\d+)$/.test(clean)) {
      const v = parseFloat(clean.replace(',', '.'));
      if (Number.isFinite(v) && v > 0 && v <= 5) return roundScore2(v);
    }

    return 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\*\*/g, '').trim();
    if (!line || /^\|?\s*[:\-| ]+\s*$/.test(line)) continue;
    if (/^(?:tổng điểm|tổng cộng)/i.test(line)) {
      if (current) {
        items.push(current);
        current = null;
      }
      continue;
    }

    const firstCell = line.includes('|') ? line.split('|').map((c) => c.trim()).find((c) => c.length > 0) || line : line;
    const headerMatch = firstCell.match(/^(?:Câu|Bài)\s*(\d+(?:\s*[.,]?\s*[a-d])?)(?=\s*(?:[:.\-|•(]|$))/i);

    if (headerMatch) {
      if (current) {
        items.push(current);
      }
      const qLabel = `Câu ${headerMatch[1].replace(/\s+/g, '')}`.replace(/\.$/, '');
      const linePts = extractLinePoints(line);
      current = { question: qLabel, maxScore: linePts };
    } else if (current) {
      const extraPts = extractLinePoints(line);
      if (extraPts > 0) {
        current.maxScore = roundScore2(current.maxScore + extraPts);
      }
    }
  }

  if (current) {
    items.push(current);
  }

  const valid = items.filter((it) => it.maxScore > 0 && it.maxScore <= 10);
  if (valid.length < 2) return '';

  const total = roundScore2(valid.reduce((acc, it) => acc + it.maxScore, 0));
  if (total < 9.0 || total > 10.5) return '';

  return valid.map((it) => `- ${it.question}: Thang điểm tối đa ${it.maxScore}`).join('\n');
}

export function enforceMasterRubricOnRows(
  rawRows: StructuredQuestionGradeRow[],
  masterRubric?: string
): StructuredQuestionGradeRow[] {
  const sanitized: StructuredQuestionGradeRow[] = (Array.isArray(rawRows) ? rawRows : []).map((r, idx) => {
    const question = sanitizeTableCell(r?.question, `Câu ${idx + 1}`);
    const maxScore = roundScore2(Math.max(0, parseNumericScore(r?.maxScore, 0)));
    let earnedScore = roundScore2(Math.max(0, parseNumericScore(r?.earnedScore, 0)));

    let finalEval = sanitizeTableCell(r?.isFinalCorrect, '');
    let method = sanitizeTableCell(r?.gradingMethod, '');
    const studentAns = sanitizeTableCell(r?.studentAnswer, '');

    const isBlank =
      /không làm|bỏ trống|chưa làm/i.test(finalEval) ||
      /^bỏ trống$/i.test(method) ||
      /^(?:bỏ trống|không làm|chưa làm|không thấy|không có bài|không ghi)$/i.test(studentAns);

    if (isBlank) {
      earnedScore = 0;
      finalEval = 'Không làm';
      method = 'Bỏ trống';
    } else if (/^(?:sai|thiếu)$/i.test(finalEval) && maxScore > 0 && earnedScore >= maxScore) {
      // Prevent small models from emitting "Sai" while still giving 100% of maxScore
      earnedScore = roundScore2(Math.max(0, maxScore - 0.25));
    }

    if (maxScore > 0) {
      earnedScore = Math.min(maxScore, earnedScore);
    } else {
      earnedScore = Math.min(10, earnedScore);
    }

    return {
      question,
      requirement: sanitizeTableCell(r?.requirement, 'Theo đề thi'),
      expectedAnswer: sanitizeTableCell(r?.expectedAnswer, ''),
      studentAnswer: studentAns || 'Bỏ trống',
      isFinalCorrect: finalEval || (earnedScore >= maxScore && maxScore > 0 ? 'Đúng' : earnedScore > 0 ? 'Sai / Thiếu' : 'Sai'),
      gradingMethod: method || (earnedScore >= maxScore && maxScore > 0 ? 'Trọn điểm (Đúng KQ cuối)' : earnedScore > 0 ? 'Chấm thành phần (Sai KQ cuối)' : 'Sai / Không có điểm'),
      maxScore,
      earnedScore,
      comment: sanitizeTableCell(r?.comment, earnedScore >= maxScore && maxScore > 0 ? 'Đạt điểm tối đa' : ''),
    };
  });

  const rubricItems = parseMasterRubricItems(masterRubric);
  if (rubricItems.length === 0) {
    return sanitized;
  }

  const usedIndices = new Set<number>();
  const matchedRows: StructuredQuestionGradeRow[] = [];

  for (const item of rubricItems) {
    const targetNorm = normalizeQuestionKey(item.question);
    const targetCompact = compactQuestionKey(item.question);

    let matchIdx = sanitized.findIndex((r, i) => !usedIndices.has(i) && normalizeQuestionKey(r.question) === targetNorm);
    if (matchIdx === -1 && targetCompact) {
      matchIdx = sanitized.findIndex((r, i) => !usedIndices.has(i) && compactQuestionKey(r.question) === targetCompact);
    }

    if (matchIdx !== -1) {
      usedIndices.add(matchIdx);
      const matched = sanitized[matchIdx];
      let clampedEarned = roundScore2(Math.max(0, Math.min(item.maxScore, matched.earnedScore)));
      if (/^(?:sai|thiếu)$/i.test(matched.isFinalCorrect || '') && clampedEarned >= item.maxScore && item.maxScore > 0) {
        clampedEarned = roundScore2(Math.max(0, item.maxScore - 0.25));
      }
      matchedRows.push({
        ...matched,
        question: item.question,
        maxScore: item.maxScore,
        earnedScore: clampedEarned,
      });
    } else {
      matchedRows.push({
        question: item.question,
        requirement: 'Theo đề thi & barem chuẩn',
        studentAnswer: 'Bỏ trống',
        isFinalCorrect: 'Không làm',
        gradingMethod: 'Bỏ trống',
        maxScore: item.maxScore,
        earnedScore: 0,
        comment: 'Thí sinh không làm câu này (0.0đ)',
      });
    }
  }

  const rubricTotalMax = rubricItems.reduce((acc, item) => acc + item.maxScore, 0);
  // Only append unmatched extra rows if rubric did not cover the full 10-point exam
  if (rubricTotalMax < 9.5) {
    sanitized.forEach((r, idx) => {
      if (!usedIndices.has(idx)) {
        matchedRows.push(r);
      }
    });
  }

  return matchedRows;
}

export function formatGradingFeedbackFromStructured(
  st: StructuredGradedStudent,
  fallbackStudentName?: string,
  masterRubric?: string
): {
  studentName: string;
  studentId: string;
  className: string;
  examCode: string;
  score: string;
  totalScoreNum: number;
  scoreText: string;
  feedback: string;
  questionRows: StructuredQuestionGradeRow[];
  strengths: string;
  weaknesses: string;
} {
  const normalizedRows = enforceMasterRubricOnRows(st.questionRows || [], masterRubric);
  const rawTotal = normalizedRows.reduce((sum, r) => sum + (Number.isFinite(r.earnedScore) ? r.earnedScore : 0), 0);
  const totalScoreNum = roundScore2(Math.max(0, Math.min(10, rawTotal)));
  const score = `${totalScoreNum}/10`;
  const scoreText = numberToVietnameseScore(totalScoreNum);
  const { gpa4, gradeLetter, rank } = getGradeMetadata(totalScoreNum);

  const cleanFallback = sanitizeStudentField(fallbackStudentName, 'name') || String(fallbackStudentName || '').trim() || 'Thí sinh';
  const studentName = sanitizeStudentField(st.studentName, 'name') || cleanFallback;
  const studentId = sanitizeStudentField(st.studentId, 'meta') || 'Không có';
  const className = sanitizeStudentField(st.className, 'meta') || 'Không có';
  const examCode = sanitizeStudentField(st.examCode, 'meta') || 'Không có';

  const strengths = String(st.strengths || '').trim() ||
    (totalScoreNum >= 5 ? 'Nắm được kiến thức cơ bản và trình bày được một số phần trọng tâm.' : 'Có cố gắng hoàn thành một phần bài làm.');
  const weaknesses = String(st.weaknesses || '').trim() ||
    (totalScoreNum >= 9 ? 'Không có sai sót đáng kể.' : 'Cần rà soát lại các câu làm sai, thiếu bước biến đổi hoặc bỏ trống.');

  const tableLines: string[] = [
    '| Câu / Ý | Yêu cầu đề bài | Kết quả cuối của HS | Đánh giá KQ cuối | Phương thức chấm | Thang điểm | Điểm đạt | Nhận xét chi tiết (Thành phần nếu sai) |',
    '| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |',
  ];

  for (const row of normalizedRows) {
    tableLines.push(
      `| ${row.question} | ${row.requirement || 'Theo đề thi'} | ${row.studentAnswer || 'Bỏ trống'} | ${row.isFinalCorrect || 'Không làm'} | ${row.gradingMethod || 'Bỏ trống'} | ${row.maxScore} | ${row.earnedScore} | ${row.comment || ''} |`
    );
  }

  const totalMaxSum = roundScore2(normalizedRows.reduce((sum, r) => sum + (Number.isFinite(r.maxScore) ? r.maxScore : 0), 0));
  tableLines.push(
    `| **TỔNG ĐIỂM** | | | | | **${totalMaxSum > 0 ? totalMaxSum : 10}** | **${totalScoreNum}** | |`
  );

  const feedback = [
    '# PHIẾU CHẤM ĐIỂM THI KẾT THÚC HỌC PHẦN',
    '',
    `- **Họ và tên thí sinh:** ${studentName}`,
    `- **Mã số sinh viên (MSSV / SBD):** ${studentId}`,
    `- **Lớp / Khóa:** ${className}`,
    `- **Mã đề thi:** ${examCode}`,
    '',
    '### BẢNG ĐIỂM CHI TIẾT TỪNG CÂU',
    ...tableLines,
    '',
    '### TỔNG KẾT ĐÁNH GIÁ & XẾP LOẠI',
    `- **TỔNG ĐIỂM CHÍNH THỨC:** **${totalScoreNum} / 10** (*Bằng chữ: ${scoreText}*)`,
    `- **Thang điểm 4:** **${gpa4.toFixed(1)} / 4.0** | **Điểm chữ:** **${gradeLetter}**`,
    `- **Xếp loại:** **${rank}**`,
    '- **Nhận xét chung:**',
    `  - **Ưu điểm:** ${strengths}`,
    `  - **Hạn chế / Lưu ý:** ${weaknesses}`,
    '',
    '| CÁN BỘ CHẤM THI 1 | CÁN BỘ CHẤM THI 2 |',
    '| :---: | :---: |',
    '| *(Ký và ghi rõ họ tên)* | *(Ký và ghi rõ họ tên)* |',
  ].join('\n');

  return {
    studentName,
    studentId,
    className,
    examCode,
    score,
    totalScoreNum,
    scoreText,
    feedback,
    questionRows: normalizedRows,
    strengths,
    weaknesses,
  };
}
