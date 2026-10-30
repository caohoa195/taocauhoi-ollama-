import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
    const app = express();
    const PORT = 3000;

    app.use(express.json({ limit: '50mb' }));

    // Gemini AI client helper
    const getAI = () => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY chưa được cấu hình. Vui lòng kiểm tra lại API key trong Settings > Secrets.");
        }
        return new GoogleGenAI({
            apiKey,
            httpOptions: {
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

    // Ollama Proxy Routes (to support local connection without CORS issues)
    app.get("/api/ollama/tags", async (req, res) => {
        const targetUrl = (req.query.url as string) || process.env.OLLAMA_HOST || "http://localhost:11434";
        try {
            const cleanUrl = targetUrl.replace(/\/+$/, '');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${cleanUrl}/api/tags`, { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                return res.status(response.status).json({ error: `Ollama trả về mã lỗi: ${response.status}` });
            }
            const data: any = await response.json();
            const models = (data.models || []).map((m: any) => m.name || m.model);
            res.json({ models });
        } catch (err: any) {
            res.status(502).json({
                error: `Không thể kết nối đến Ollama tại ${targetUrl}: ${err.message || 'Lỗi mạng'}`,
                models: []
            });
        }
    });

    app.post("/api/ollama/call", async (req, res) => {
        try {
            const { url, endpoint, payload } = req.body;
            const targetUrl = (url || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, '');
            const targetEndpoint = endpoint || '/api/chat';

            const controller = new AbortController();
            // Generation might take up to a few minutes for 35B models
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
            console.error("Ollama proxy call error:", err);
            res.status(500).json({ error: `Lỗi kết nối Ollama: ${err.message || 'Không phản hồi'}` });
        }
    });

    // API routes
    app.post("/api/generate-exam", async (req, res) => {
        try {
            const { parts } = req.body;
            const ai = getAI();
            
            const response = await ai.models.generateContent({ 
                model: "gemini-3.8-flash",
                contents: [{ role: "user", parts }],
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

            if (!response.text) {
                throw new Error("AI không phản hồi nội dung đề thi.");
            }

            const cleanText = response.text.replace(/```json\n?|\n?```/g, '').trim();
            res.json(JSON.parse(cleanText));
        } catch (error: any) {
            console.error("Error generating exam:", error);
            let message = error.message || "Lỗi không xác định";
            if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
                message = "API key không hợp lệ hoặc đã hết hạn. Vui lòng chọn hoặc cấu hình lại API key.";
            }
            res.status(500).json({ error: message });
        }
    });

    app.post("/api/grade-submission", async (req, res) => {
        try {
            const { parts } = req.body;
            const ai = getAI();
            
            const response = await ai.models.generateContent({ 
                model: "gemini-3.8-flash",
                contents: [{ role: "user", parts }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            feedback: { type: Type.STRING },
                            score: { type: Type.STRING }
                        },
                        required: ["feedback", "score"]
                    }
                }
            });

            if (!response.text) {
                throw new Error("AI không phản hồi kết quả chấm thi.");
            }

            const cleanText = response.text.replace(/```json\n?|\n?```/g, '').trim();
            res.json(JSON.parse(cleanText));
        } catch (error: any) {
            console.error("Error grading submission:", error);
            let message = error.message || "Lỗi không xác định";
            if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
                message = "API key không hợp lệ hoặc đã hết hạn. Vui lòng chọn hoặc cấu hình lại API key.";
            }
            res.status(500).json({ error: message });
        }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const { createServer } = await import("vite");
        const vite = await createServer({
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
