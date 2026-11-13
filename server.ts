import express from "express";
import path from "path";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

async function startServer() {
    const app = express();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

    app.use(express.json({ limit: '50mb' }));

    // Gemini AI client helper with fast responsive timeout
    const getAI = () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY chưa được cấu hình. Vui lòng kiểm tra lại API key trong Settings > Secrets.");
        }
        return new GoogleGenAI({
            apiKey,
            httpOptions: {
                timeout: 45000, // 45 seconds max timeout per request
                headers: {
                    'User-Agent': 'aistudio-build',
                }
            }
        });
    };


    // Health check for deployment
    app.get("/api/health", (req, res) => {
        res.json({ status: "ok" });
    });

    // Helper to robustly extract text from Buffer (mammoth HTML conversion preserving tables, cells & paragraphs)
    const extractTextFromBuffer = async (buffer: Buffer, fileName?: string): Promise<string> => {
        const lowerName = (fileName || '').toLowerCase();

        // 1. Mammoth convertToHtml: preserves tables, columns, rows, bold text, and paragraphs
        try {
            const mammoth = await import('mammoth');
            const convertToHtml = mammoth.default?.convertToHtml || mammoth.convertToHtml;
            if (typeof convertToHtml === 'function') {
                const result = await convertToHtml({ buffer });
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
                    if (structured.length > 0) return structured;
                }
            }
        } catch (mErr) {
            console.warn("Mammoth convertToHtml notice:", mErr);
        }

        // 2. Fallback: Mammoth extractRawText
        try {
            const mammoth = await import('mammoth');
            const extractRawText = mammoth.default?.extractRawText || mammoth.extractRawText;
            if (typeof extractRawText === 'function') {
                const result = await extractRawText({ buffer });
                const text = (result?.value || '').trim();
                if (text.length > 0) return text;
            }
        } catch (mRawErr) {
            console.warn("Mammoth extractRawText notice:", mRawErr);
        }

        // 3. Fallback: UTF-8 scan
        try {
            const text = buffer.toString('utf-8');
            if (!/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
                return text.trim();
            }
        } catch {}

        return '';
    };

    // Server-side Document Parser (handles DOCX, TXT reliably without browser bundler issues)
    app.post("/api/parse-document", async (req, res) => {
        try {
            const { base64, fileName } = req.body;
            if (!base64) {
                return res.status(400).json({ error: "Thiếu dữ liệu file" });
            }

            const buffer = Buffer.from(base64, 'base64');
            const extractedText = await extractTextFromBuffer(buffer, fileName);

            if (extractedText && extractedText.length > 0) {
                return res.json({ text: extractedText, type: 'text' });
            }

            return res.json({ text: null, type: 'binary' });
        } catch (err: any) {
            console.error("Document parse error:", err);
            res.status(500).json({ error: err.message || "Lỗi đọc file" });
        }
    });

    // Helper to sanitize parts for Gemini API
    const sanitizePartsForGemini = async (parts: any[]): Promise<any[]> => {
        const sanitized: any[] = [];
        for (const part of (parts || [])) {
            if (typeof part.text === 'string') {
                let text = part.text.trim();
                if (text.length > 25000) {
                    text = text.slice(0, 25000) + "\n\n[Lưu ý: Hệ thống đã tối ưu trích xuất 25.000 ký tự đầu tiên của tài liệu để chấm bài]";
                }
                sanitized.push({ text });
                continue;
            }

            if (part.inlineData && part.inlineData.data) {
                const mime = (part.inlineData.mimeType || '').toLowerCase();
                // Gemini supports image and PDF natively
                if (mime.startsWith('image/') || mime === 'application/pdf') {
                    sanitized.push(part);
                    continue;
                }

                // If it's docx, doc, octet-stream, or text-like binary: extract to text
                try {
                    const buffer = Buffer.from(part.inlineData.data, 'base64');
                    const text = await extractTextFromBuffer(buffer, part.name);
                    if (text && text.length > 0) {
                        let cleanText = text;
                        if (cleanText.length > 25000) {
                            cleanText = cleanText.slice(0, 25000) + "\n\n[Đã tối ưu trích xuất 25.000 ký tự đầu]";
                        }
                        sanitized.push({ text: `[Nội dung tài liệu/bài thi được trích xuất]:\n${cleanText}\n` });
                        continue;
                    }
                } catch (e) {
                    console.warn("Could not extract inlineData to text:", e);
                }

                // NEVER pass unsupported application/octet-stream to Gemini:
                sanitized.push({ text: `[Tệp đính kèm không thể đọc dạng văn bản trực tiếp. Hệ thống chấm dựa trên thông tin bài nộp có sẵn.]` });
            }
        }
        return sanitized;
    };

    // Ollama Proxy Routes (to support local connection without CORS issues)
    app.get("/api/ollama/tags", async (req, res) => {
        const targetUrl = (req.query.url as string) || process.env.OLLAMA_HOST || "http://localhost:11434";
        const cleanUrl = targetUrl.replace(/\/+$/, '');
        const isLocal = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1');

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${cleanUrl}/api/tags`, { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                return res.status(response.status).json({ error: `Ollama trả về mã lỗi: ${response.status}`, models: [] });
            }
            const data: any = await response.json();
            const models = (data.models || []).map((m: any) => m.name || m.model);
            res.json({ models });
        } catch (err: any) {
            const msg = isLocal
                ? `Ollama chạy cục bộ trên máy cá nhân của bạn (${cleanUrl}). Hãy bật Ollama trên máy tính ('ollama serve') và chọn chế độ 'Trình duyệt (Direct)' kèm OLLAMA_ORIGINS="*".`
                : `Không thể kết nối đến Ollama tại ${cleanUrl}: ${err.message || 'Lỗi mạng'}`;
            res.status(502).json({ error: msg, models: [] });
        }
    });

    app.post("/api/ollama/call", async (req, res) => {
        const { url, endpoint, payload } = req.body;
        const targetUrl = (url || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, '');
        const targetEndpoint = endpoint || '/api/chat';
        const isLocal = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
            const response = await fetch(`${targetUrl}${targetEndpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const text = await response.text();
                return res.status(response.status).json({ error: `Ollama API lỗi (${response.status}): ${text}` });
            }

            const data = await response.json();
            res.json(data);
        } catch (err: any) {
            const errMsg = isLocal
                ? `Không thể kết nối đến Ollama trên máy của bạn (${targetUrl}). Máy chủ Cloud không thể truy cập trực tiếp 'localhost' qua proxy. Vui lòng chuyển sang chế độ 'Trình duyệt (Direct)' và bật OLLAMA_ORIGINS="*" hoặc dùng Gemini Cloud.`
                : `Không thể kết nối Ollama tại ${targetUrl}: ${err.message || 'Lỗi mạng'}`;
            res.status(502).json({ error: errMsg });
        }
    });

    // API routes
    app.post("/api/generate-exam", async (req, res) => {
        try {
            const { parts } = req.body;
            const ai = getAI();
            const sanitizedParts = await sanitizePartsForGemini(parts);
            
            let responseText = "";
            try {
                const response = await ai.models.generateContent({ 
                    model: "gemini-3.8-flash",
                    contents: [{ role: "user", parts: sanitizedParts }],
                    config: {
                        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                questions: { type: Type.STRING },
                                answers: { type: Type.STRING }
                            },
                            required: ["questions", "answers"]
                        }
                    }
                });
                responseText = response.text || "";
            } catch (err: any) {
                const isTimeout = err.status === 504 || err.message?.includes("504") || err.message?.includes("DEADLINE_EXCEEDED");
                if (isTimeout) {
                    console.log("gemini-3.8-flash timed out for exam generation. Retrying with gemini-3.1-flash-lite...");
                    const fallback = await ai.models.generateContent({ 
                        model: "gemini-3.1-flash-lite",
                        contents: [{ role: "user", parts: sanitizedParts }],
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: Type.OBJECT,
                                properties: {
                                    questions: { type: Type.STRING },
                                    answers: { type: Type.STRING }
                                },
                                required: ["questions", "answers"]
                            }
                        }
                    });
                    responseText = fallback.text || "";
                } else {
                    throw err;
                }
            }

            if (!responseText) {
                throw new Error("AI không phản hồi nội dung đề thi.");
            }

            const cleanText = responseText.replace(/```json\n?|\n?```/g, '').trim();
            res.json(JSON.parse(cleanText));
        } catch (error: any) {
            console.error("Error generating exam:", error);
            let message = error.message || "Lỗi không xác định";
            if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
                message = "API key không hợp lệ hoặc đã hết hạn. Vui lòng chọn hoặc cấu hình lại API key.";
            } else if (message.includes("DEADLINE_EXCEEDED") || message.includes("504")) {
                message = "Thời gian phản hồi từ AI quá dài (DEADLINE_EXCEEDED). Vui lòng thử lại với cấu hình gọn hơn hoặc dùng Ollama cục bộ.";
            }
            res.status(500).json({ error: message });
        }
    });

    app.post("/api/grade-submission", async (req, res) => {
        try {
            const { 
                prompt, 
                parts: rawParts, 
                submissionPart, 
                examQuestionPart,
                examQuestionText,
                answerKeyPart, 
                answerKeyText,
                masterRubric,
                fastFinalResultGrading = true,
                gradingType = 'auto'
            } = req.body;

            const parts: any[] = Array.isArray(rawParts) ? [...rawParts] : [];
            
            // If a shared master rubric is provided, force it as the top priority anchoring
            if (masterRubric && typeof masterRubric === 'string' && masterRubric.trim()) {
                parts.push({ text: `[BẢNG BAREM THANG ĐIỂM BẮT BUỘC DÙNG CHUNG CHO TẤT CẢ CÁC BÀI THI]:\n${masterRubric.trim()}\n\nQUY TẮC CỐ ĐỊNH BAREM: Bắt buộc liệt kê đầy đủ tất cả các câu trên vào bảng điểm của thí sinh này. Câu nào thí sinh không giải/bỏ trống bắt buộc ghi rõ vào bảng và cho 0.0đ. Tuyệt đối không được thay đổi thang điểm tối đa của từng câu.` });
            }

            // Add exam question paper if provided
            if (examQuestionText && typeof examQuestionText === 'string' && examQuestionText.trim()) {
                parts.push({ text: `[NỘI DUNG ĐỀ BÀI (ĐỀ THI GỐC) ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${examQuestionText.trim()}\n` });
            }
            if (examQuestionPart) parts.push(examQuestionPart);

            // Add answer key & rubric
            if (answerKeyText && typeof answerKeyText === 'string' && answerKeyText.trim()) {
                parts.push({ text: `[NỘI DUNG ĐÁP ÁN CHUẨN & THANG ĐIỂM ĐƯỢC GIÁO VIÊN CUNG CẤP]:\n${answerKeyText.trim()}\n` });
            }
            if (answerKeyPart) parts.push(answerKeyPart);

            // Add student submission
            if (submissionPart) parts.push(submissionPart);
            
            if (prompt && typeof prompt === 'string') {
                parts.unshift({ text: prompt });
            }

            if (parts.length === 0) {
                return res.status(400).json({ error: "Không tìm thấy nội dung bài thi hoặc yêu cầu chấm thi." });
            }

            const ai = getAI();
            const sanitizedParts = await sanitizePartsForGemini(parts);

            const gradingSystemInstruction = `
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

            const gradingSchema = {
                type: Type.OBJECT,
                properties: {
                    students: {
                        type: Type.ARRAY,
                        description: "Danh sách kết quả chấm thi của từng thí sinh",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                studentName: { type: Type.STRING, description: "Họ và tên thí sinh trích xuất từ bài thi" },
                                studentId: { type: Type.STRING, description: "MSSV hoặc SBD nếu có" },
                                className: { type: Type.STRING, description: "Lớp nếu có" },
                                examCode: { type: Type.STRING, description: "Mã đề nếu có" },
                                score: { type: Type.STRING, description: "Điểm số thang 10, ví dụ: 6.75/10" },
                                totalScoreNum: { type: Type.NUMBER, description: "Tổng điểm số dạng số thực, ví dụ: 6.75" },
                                scoreText: { type: Type.STRING, description: "Điểm ghi bằng chữ tiếng Việt, ví dụ: Sáu phẩy bảy lăm" },
                                feedback: { type: Type.STRING, description: "Phiếu chấm điểm Markdown chuyên nghiệp chuẩn đại học theo đúng khuôn mẫu cố định" }
                            },
                            required: ["studentName", "score", "totalScoreNum", "scoreText", "feedback"]
                        }
                    }
                },
                required: ["students"]
            };

            let responseText = "";

            // Primary model: gemini-3.1-flash-lite with DETERMINISTIC decoding (temperature: 0.0, seed: 42)
            try {
                const response = await ai.models.generateContent({ 
                    model: "gemini-3.1-flash-lite",
                    contents: [{ role: "user", parts: sanitizedParts }],
                    config: {
                        temperature: 0.0,
                        seed: 42,
                        systemInstruction: gradingSystemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: gradingSchema
                    }
                });

                responseText = response.text || "";
            } catch (liteErr: any) {
                console.warn("Primary gemini-3.1-flash-lite error, trying fallback gemini-flash-latest:", liteErr.message);
                const fallbackRes = await ai.models.generateContent({ 
                    model: "gemini-flash-latest",
                    contents: [{ role: "user", parts: sanitizedParts }],
                    config: {
                        temperature: 0.0,
                        seed: 42,
                        systemInstruction: gradingSystemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: gradingSchema
                    }
                });
                responseText = fallbackRes.text || "";
            }

            if (!responseText) {
                throw new Error("AI không phản hồi kết quả chấm thi.");
            }

            const cleanText = responseText.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleanText);

            const students = Array.isArray(parsed.students) && parsed.students.length > 0
                ? parsed.students
                : [
                    {
                        studentName: parsed.studentName || "Thí sinh",
                        studentId: parsed.studentId || "",
                        className: parsed.className || "",
                        examCode: parsed.examCode || "",
                        score: parsed.score || "N/A",
                        totalScoreNum: parsed.totalScoreNum,
                        scoreText: parsed.scoreText || "",
                        feedback: parsed.feedback || cleanText
                    }
                ];

    function numberToVietnameseScore(num: number): string {
        const digitWords = ["Không", "Một", "Hai", "Ba", "Bốn", "Năm", "Sáu", "Bảy", "Tám", "Chín", "Mười"];
        const rounded = Math.round(num * 100) / 100;
        const intPart = Math.floor(rounded);
        const decPart = Math.round((rounded - intPart) * 100);
        let res = digitWords[intPart] || intPart.toString();
        if (decPart > 0) {
            if (decPart % 10 === 0) {
                const d = decPart / 10;
                res += " phẩy " + (d === 5 ? "năm" : (digitWords[d] ? digitWords[d].toLowerCase() : d));
            } else if (decPart < 10) {
                res += " phẩy không " + (digitWords[decPart] ? digitWords[decPart].toLowerCase() : decPart);
            } else {
                const d1 = Math.floor(decPart / 10);
                const d2 = decPart % 10;
                const w1 = d1 === 7 ? "bảy" : (digitWords[d1] ? digitWords[d1].toLowerCase() : d1);
                const w2 = d2 === 5 ? "lăm" : (digitWords[d2] ? digitWords[d2].toLowerCase() : d2);
                res += " phẩy " + w1 + " " + w2;
            }
        }
        return res;
    }

    function extractExactScoreFromFeedback(md: string): number | null {
        if (!md || typeof md !== 'string') return null;

        // 1. Try extracting from Table "Điểm đạt"
        const lines = md.split(/\r?\n/);
        let headerCol = -1;
        const scores: number[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
            if (/^\|\s*[: -]+\s*\|/.test(trimmed)) continue;

            const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());

            if (headerCol === -1) {
                for (let i = 0; i < cells.length; i++) {
                    const c = cells[i].toLowerCase();
                    if (c.includes("điểm đạt") || c.includes("điểm số") || (c.includes("điểm") && !c.includes("thang"))) {
                        headerCol = i;
                        break;
                    }
                }
                continue;
            }

            const rowText = trimmed.toLowerCase();
            if (rowText.includes("tổng cộng") || rowText.includes("tổng điểm")) continue;

            if (cells.length > headerCol) {
                const clean = cells[headerCol].replace(/[^\d.,]/g, "").replace(",", ".");
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
            const lhs = match[1].split("=")[0];
            const nums = (lhs.match(/\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(",", ".")));
            if (nums.length > 0) {
                const total = nums.reduce((a, b) => a + b, 0);
                return Math.max(0, Math.min(10, Math.round(total * 100) / 100));
            }
        }

        return null;
    }

            // Programmatically calculate exact score sum from individual questions in table
            for (const st of students) {
                const exactScore = extractExactScoreFromFeedback(st.feedback);
                if (exactScore !== null) {
                    st.totalScoreNum = exactScore;
                    st.score = `${exactScore}/10`;
                    st.scoreText = numberToVietnameseScore(exactScore);

                    // Synchronize feedback markdown
                    let fb = st.feedback;
                    fb = fb.replace(/(-\s*\*\*Chi tiết cộng điểm:\*\*.*?=)\s*[\d.,]+\s*đ?/i, `$1 ${exactScore}đ`);
                    fb = fb.replace(/(-\s*\*\*(?:TỔNG ĐIỂM CHÍNH THỨC|Tổng điểm chính thức|Tổng điểm):\*\*\s*\*\*?).*?(\/\s*10\*\*?)/i, `$1${exactScore} $2`);
                    fb = fb.replace(/(\*Bằng chữ:\s*)[^*]+(\*)/i, `$1${st.scoreText}$2`);

                    let gpa4 = 0.0;
                    let gradeLetter = 'F';
                    let rank = 'Chưa đạt';

                    if (exactScore >= 8.5) {
                        gpa4 = 4.0; gradeLetter = 'A'; rank = 'Xuất sắc';
                    } else if (exactScore >= 8.0) {
                        gpa4 = 3.5; gradeLetter = 'B+'; rank = 'Giỏi';
                    } else if (exactScore >= 7.0) {
                        gpa4 = 3.0; gradeLetter = 'B'; rank = 'Khá';
                    } else if (exactScore >= 6.5) {
                        gpa4 = 2.5; gradeLetter = 'C+'; rank = 'Trung bình khá';
                    } else if (exactScore >= 5.5) {
                        gpa4 = 2.0; gradeLetter = 'C'; rank = 'Trung bình';
                    } else if (exactScore >= 5.0) {
                        gpa4 = 1.5; gradeLetter = 'D+'; rank = 'Trung bình yếu';
                    } else if (exactScore >= 4.0) {
                        gpa4 = 1.0; gradeLetter = 'D'; rank = 'Đạt (yếu)';
                    } else {
                        gpa4 = 0.0; gradeLetter = 'F'; rank = 'Chưa đạt (Kém)';
                    }

                    fb = fb.replace(/(-\s*\*\*Thang điểm 4:\*\*\s*\*\*).*?(?=\n|$)/i, `- **Thang điểm 4:** **${gpa4.toFixed(1)} / 4.0** | **Điểm chữ:** **${gradeLetter}**`);
                    fb = fb.replace(/(-\s*\*\*(?:Xếp loại|Xếp loại học lực):\*\*\s*\*\*).*?(?=\n|$)/i, `- **Xếp loại:** **${rank}**`);

                    st.feedback = fb;
                } else if (typeof st.totalScoreNum === 'number') {
                    const rounded = Math.round(st.totalScoreNum * 100) / 100;
                    st.score = `${rounded}/10`;
                }
            }

            return res.json({
                students,
                studentName: students[0].studentName,
                score: students[0].score,
                feedback: students[0].feedback
            });
        } catch (error: any) {
            console.error("Final error grading submission:", error);
            let message = error.message || "Lỗi không xác định khi chấm thi";
            if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
                message = "API key không hợp lệ hoặc đã hết hạn. Vui lòng chọn hoặc cấu hình lại API key.";
            } else if (message.includes("DEADLINE_EXCEEDED") || message.includes("504") || message.includes("Headers Timeout") || message.includes("fetch failed")) {
                message = "Thời gian xử lý của Gemini API quá hạn. Hệ thống đã tối ưu hóa, vui lòng bấm chấm lại hoặc chuyển sang mô hình Ollama cục bộ.";
            }
            res.status(500).json({ error: message });
        }
    });



    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const { createServer } = await import("vite");
        const vite = await createServer({
            configFile: path.resolve(process.cwd(), 'vite.config.ts'),
            root: process.cwd(),
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer().catch(console.error);
