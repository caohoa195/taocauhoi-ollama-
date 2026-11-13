import express from "express";
import path from "path";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import {
    formatExamFromVariants,
    getExamSystemInstruction,
    GRADING_SYSTEM_INSTRUCTION,
    synchronizeStudentScores
} from "./utils/examHelpers";

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
            const { parts, examMeta } = req.body || {};
            if (!Array.isArray(parts) || parts.length === 0) {
                return res.status(400).json({ error: "Thiếu dữ liệu yêu cầu tạo đề thi." });
            }
            const ai = getAI();
            const sanitizedParts = await sanitizePartsForGemini(parts);

            const parseExamJson = (raw: string) => {
                const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
                try {
                    return JSON.parse(cleaned);
                } catch {
                    const start = cleaned.indexOf('{');
                    const end = cleaned.lastIndexOf('}');
                    if (start !== -1 && end > start) {
                        return JSON.parse(cleaned.slice(start, end + 1));
                    }
                    throw new Error("Phản hồi tạo đề từ AI không đúng định dạng JSON.");
                }
            };

            const useStructuredVariants = Boolean(examMeta && typeof examMeta === 'object');
            const examSystemInstruction = getExamSystemInstruction(examMeta);

            const responseSchema = useStructuredVariants
                ? {
                    type: Type.OBJECT,
                    properties: {
                        variants: {
                            type: Type.ARRAY,
                            description: "Danh sách các mã đề thi và đáp án tương ứng",
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    variantNumber: { type: Type.INTEGER, description: "Số thứ tự mã đề (1, 2, 3...)" },
                                    questions: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                sectionTitle: { type: Type.STRING, description: "Tiêu đề phần nếu là đề nhiều phần (vd: PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN), để trống nếu không chia phần" },
                                                questionLabel: { type: Type.STRING, description: "Ví dụ: Câu 1 (Nhận biết - 0.5 điểm):" },
                                                questionContent: { type: Type.STRING, description: "Nội dung câu hỏi (có đủ A., B., C., D. nếu 4 đáp án; ý a), b), c), d) nếu tự luận hoặc đúng/sai; ...... nếu điền khuyết)" }
                                            },
                                            required: ["questionLabel", "questionContent"]
                                        }
                                    },
                                    answerRows: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                content: { type: Type.STRING, description: "Tiêu đề câu/phần hoặc nội dung 1 dòng đáp án/bước giải cụ thể" },
                                                points: { type: Type.STRING, description: "Để '' cho dòng tiêu đề; chỉ ghi '0.25' hoặc '0.5' cho từng dòng chấm điểm (tuyệt đối không ghi >= 0.75)" }
                                            },
                                            required: ["content", "points"]
                                        }
                                    }
                                },
                                required: ["variantNumber", "questions", "answerRows"]
                            }
                        }
                    },
                    required: ["variants"]
                }
                : {
                    type: Type.OBJECT,
                    properties: {
                        questions: { type: Type.STRING },
                        answers: { type: Type.STRING }
                    },
                    required: ["questions", "answers"]
                };

            let parsedResult: any = null;
            const candidateModels = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];
            let lastModelError: any = null;
            for (const modelName of candidateModels) {
                try {
                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: [{ role: "user", parts: sanitizedParts }],
                        config: {
                            temperature: 0.1,
                            systemInstruction: examSystemInstruction,
                            responseMimeType: "application/json",
                            responseSchema
                        }
                    });
                    const responseText = response.text || "";
                    if (!responseText) throw new Error(`Empty response from ${modelName}`);
                    parsedResult = parseExamJson(responseText);
                    break;
                } catch (err: any) {
                    lastModelError = err;
                    console.warn(`Model ${modelName} failed for exam generation:`, err.message);
                }
            }
            if (!parsedResult) {
                throw lastModelError || new Error("AI không phản hồi nội dung đề thi.");
            }

            if (useStructuredVariants && Array.isArray(parsedResult?.variants) && parsedResult.variants.length > 0) {
                return res.json(formatExamFromVariants(parsedResult.variants, examMeta));
            }

            res.json(parsedResult);
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

            const gradingSystemInstruction = GRADING_SYSTEM_INSTRUCTION;

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

            // Programmatically calculate exact score sum from individual questions in table
            synchronizeStudentScores(students);

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



    // Ensure /api/* errors always return JSON instead of Express default HTML 500 page
    app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        console.error("Express API middleware error:", err);
        const status = err.status || err.statusCode || 500;
        res.status(status).json({ error: err.message || "Lỗi máy chủ API" });
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
