import React, { useState, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import MarkdownRenderer from './components/MarkdownRenderer';
import { generateExamContent, gradeSubmission } from './services/geminiService';
import { generateExamContentOllama, gradeSubmissionOllama } from './services/ollamaService';
import { ExamConfig, GeneratedContent, GradingConfig, GradingResult, AIProvider, OllamaConfig } from './types';
import { BookOpen, FileCheck, AlertCircle, FileText, FileType, Cpu, Server, Sparkles } from 'lucide-react';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);
  const [mode, setMode] = useState<'generate' | 'grade'>('generate');
  const [error, setError] = useState<string | null>(null);

  // AI Provider & Ollama Configuration with persistence
  const [provider, setProvider] = useState<AIProvider>(() => {
    return (localStorage.getItem('uniexam_provider') as AIProvider) || 'ollama';
  });

  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(() => {
    return {
      baseUrl: localStorage.getItem('uniexam_ollama_url') || 'http://localhost:11434',
      model: localStorage.getItem('uniexam_ollama_model') || 'qwen2.5-coder:7b',
      connectionMode: (localStorage.getItem('uniexam_ollama_mode') as 'browser' | 'proxy') || 'browser',
    };
  });

  useEffect(() => {
    localStorage.setItem('uniexam_provider', provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem('uniexam_ollama_url', ollamaConfig.baseUrl);
    localStorage.setItem('uniexam_ollama_model', ollamaConfig.model);
    localStorage.setItem('uniexam_ollama_mode', ollamaConfig.connectionMode);
  }, [ollamaConfig]);

  const handleGenerate = async (config: ExamConfig) => {
    setIsLoading(true);
    setError(null);
    setMode('generate');
    setGeneratedContent(null);
    try {
      let result: GeneratedContent;
      if (provider === 'ollama') {
        result = await generateExamContentOllama(config, ollamaConfig);
      } else {
        result = await generateExamContent(config);
      }
      setGeneratedContent(result);
    } catch (err: any) {
      console.error("Lỗi khi tạo đề:", err);
      setError(err.message || "Đã xảy ra lỗi khi tạo đề.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrade = async (config: GradingConfig) => {
    setIsLoading(true);
    setError(null);
    setMode('grade');
    setGradingResult(null);
    try {
      let result: { content: string; score: string };
      if (provider === 'ollama') {
        result = await gradeSubmissionOllama(config, ollamaConfig);
      } else {
        result = await gradeSubmission(config);
      }
      setGradingResult({ feedback: result.content, score: result.score });
    } catch (err: any) {
      console.error("Lỗi chấm thi:", err);
      setError(err.message || "Đã xảy ra lỗi khi chấm thi.");
    } finally {
      setIsLoading(false);
    }
  };

  // Helper chuyển đổi Markdown sang HTML cho file Word
  const markdownToHtml = (md: string) => {
    if (!md || typeof md !== 'string') return "<p>Không có nội dung</p>";
    
    // 1. Pre-process: handle bold, italic, and lists
    let html = md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
      .replace(/\*(.*?)\*/gim, '<i>$1</i>')
      .replace(/<br\s*\/?>/gim, '<br/>');

    // 2. Custom Table and List Parser
    const lines = html.split(/\r?\n/);
    let inTable = false;
    let tableRows: string[] = [];
    let isHeaderLayoutTable = false;
    let hasSeenSeparator = false;
    let inList = false;

    const finalLines: string[] = [];
    
    const checkIsHeaderLayout = (row: string) => {
        const r = row.toUpperCase();
        return r.includes("KHOA") || r.includes("BỘ MÔN") || r.includes("SUBJECT") || r.includes("FACULTY") || r.includes("DEPARTMENT");
    };
    
    const checkIsDataTableHeader = (row: string) => {
        const r = row.toLowerCase();
        return r.includes("nội dung") || r.includes("điểm") || r.includes("đáp án") || r.includes("câu hỏi") || r.includes("thang điểm") || r.includes("content") || r.includes("score");
    };

    const flushTable = () => {
        if (tableRows.length === 0) return;
        
        let tableStyle = 'width:100%; border-collapse: collapse; margin-bottom: 12pt;';
        let borderStyle = '';
        
        if (isHeaderLayoutTable) {
            borderStyle = 'border: none;';
            tableStyle += 'line-height: 1.0; mso-line-height-rule: exactly;'; 
        } else {
            borderStyle = 'border: 1px solid black;';
            tableStyle += 'line-height: 1.2;';
        }
        
        finalLines.push(`<table style="${tableStyle} ${borderStyle}">`);
        
        tableRows.forEach((row) => {
            finalLines.push('<tr>');
            const cells = row.split('|').filter((c, idx, arr) => {
                if (idx === 0 && c.trim() === '') return false;
                if (idx === arr.length - 1 && c.trim() === '') return false;
                return true;
            });

            cells.forEach((cell) => {
                let cellContent = cell.trim();
                cellContent = cellContent.replace(/^(<br\s*\/?>)+/i, '').replace(/(<br\s*\/?>)+$/i, '').trim();

                let cellStyle = 'vertical-align: top;';
                if (isHeaderLayoutTable) {
                    cellStyle += 'border: none; padding: 0in 5.4pt 0in 5.4pt;';
                    finalLines.push(`<td style="${cellStyle}">${cellContent}</td>`);
                } else {
                    cellStyle += 'border: 1px solid black; padding: 5px;';
                    finalLines.push(`<td style="${cellStyle}"><p style="margin: 0; padding: 0; line-height: 1.2;">${cellContent}</p></td>`);
                }
            });
            finalLines.push('</tr>');
        });
        
        finalLines.push('</table>');
        tableRows = [];
        inTable = false;
        isHeaderLayoutTable = false;
        hasSeenSeparator = false;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Handle Lists
      if (line.match(/^[-*]\s+(.*)/) || line.match(/^\d+\.\s+(.*)/)) {
          if (!inList) {
              finalLines.push('<ul>');
              inList = true;
          }
          const content = line.replace(/^[-*]\s+(.*)/, '$1').replace(/^\d+\.\s+(.*)/, '$1');
          finalLines.push(`<li>${content}</li>`);
          continue;
      } else if (inList) {
          finalLines.push('</ul>');
          inList = false;
      }

      if (line === '' && !inTable) continue;

      if (line.includes('word-page-break') || line.includes('page-break') || line === '---') {
          if (inTable) flushTable();
          finalLines.push('<p style="margin:0; page-break-before:always;"><br clear="all" style="mso-special-character:line-break;page-break-before:always"></p>');
          continue;
      }

      if (line.startsWith('|')) {
          if (inTable && isHeaderLayoutTable && checkIsDataTableHeader(line)) {
               flushTable();
               inTable = true;
               isHeaderLayoutTable = false;
               hasSeenSeparator = false;
          }

          const isSeparator = line.match(/^\|\s*[: -]+\s*\|/);
          if (isSeparator) {
              if (hasSeenSeparator && tableRows.length > 0) {
                      const newTableHeader = tableRows.pop()!;
                      flushTable();
                      tableRows.push(newTableHeader);
                      inTable = true;
                      isHeaderLayoutTable = checkIsHeaderLayout(newTableHeader);
                      hasSeenSeparator = true;
                      continue;
              } else {
                  hasSeenSeparator = true;
              }
              continue;
          }

          if (!inTable) {
              inTable = true;
              hasSeenSeparator = false;
              isHeaderLayoutTable = checkIsHeaderLayout(line);
          }
          tableRows.push(line);
      } else {
          if (inTable) flushTable();
          if (line !== '') {
              if (line.startsWith('<')) {
                  finalLines.push(line); 
              } else {
                  finalLines.push(`<p style="margin: 0; padding: 0; margin-bottom: 6pt;">${line}</p>`);
              }
          }
      }
    }
    if (inTable) flushTable();
    if (inList) finalLines.push('</ul>');
    
    html = finalLines.join('\n');
    html = html.replace(/<center>/g, '<div style="text-align: center;">').replace(/<\/center>/g, '</div>');

    return `<!DOCTYPE html>
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
          <meta charset='utf-8'>
          <title>Export</title>
          <!--[if gte mso 9]>
          <xml>
              <w:WordDocument>
                  <w:View>Print</w:View>
                  <w:Zoom>100</w:Zoom>
                  <w:DoNotOptimizeForBrowser/>
              </w:WordDocument>
          </xml>
          <![endif]-->
          <style>
              body { 
                  font-family: 'Times New Roman', serif; 
                  font-size: 12pt; 
                  line-height: 1.15; 
              }
              p { margin: 0; padding: 0; margin-bottom: 6pt; }
              h1, h2, h3 { margin-top: 12pt; margin-bottom: 6pt; font-weight: bold; }
              table { border-collapse: collapse; width: 100%; border: 1px solid black; }
              td { vertical-align: top; }
              ul, li { margin: 0; padding-left: 20pt; }
          </style>
      </head>
      <body>
      ${html}
      </body></html>
    `;
  };

  const downloadFile = (content: string, filename: string, type: 'txt' | 'doc') => {
    console.log(`Downloading ${filename}, type: ${type}, content length: ${content?.length}`);
    
    if (!content) {
        console.warn("Attempted to download empty content");
        setError("Nội dung trống, không thể tải về.");
        return;
    }

    let blob: Blob;
    if (type === 'doc') {
        const finalContent = markdownToHtml(content);
        console.log("Word content parsed length:", finalContent.length);
        blob = new Blob([finalContent], { type: 'application/msword;charset=utf-8' });
    } else {
        blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
  };

  const DownloadActions = ({ content, prefix }: { content: string, prefix: string }) => (
      <div className="flex gap-2">
          <button 
            onClick={() => downloadFile(content, `${prefix}.doc`, 'doc')}
            className="flex items-center gap-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded transition-colors"
            title="Tải về file Word"
          >
            <FileType size={14} /> Word
          </button>
          <button 
            onClick={() => downloadFile(content, `${prefix}.txt`, 'txt')}
            className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1 rounded transition-colors"
            title="Tải về file Text"
          >
            <FileText size={14} /> .txt
          </button>
      </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-50">
      {/* Left Sidebar (30%) - Control Panel now on the left */}
      {/* Left Sidebar (30%) - Control Panel on the left */}
      <div className="w-[350px] md:w-[420px] flex-shrink-0 h-full relative z-20">
        <ControlPanel 
            onGenerate={handleGenerate} 
            onGrade={handleGrade}
            isLoading={isLoading}
            provider={provider}
            setProvider={setProvider}
            ollamaConfig={ollamaConfig}
            setOllamaConfig={setOllamaConfig}
        />
      </div>

      {/* Right Content Area (70%) - Main content on the right */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Bar for Right Area */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center px-6 shadow-sm justify-between z-10">
           <div className="flex items-center gap-2 text-gray-700 font-semibold">
                {mode === 'generate' ? <BookOpen className="text-blue-600" /> : <FileCheck className="text-teal-600" />}
                <span>{mode === 'generate' ? 'Nội dung Đề thi & Đáp án' : 'Kết quả Chấm thi'}</span>
           </div>
           
           <div className="flex items-center gap-3">
              {provider === 'ollama' ? (
                <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 px-3 py-1 rounded-full text-xs font-semibold shadow-xs">
                  <Server size={13} className="text-indigo-600" />
                  <span>Ollama: <strong className="font-mono text-indigo-900">{ollamaConfig.model}</strong></span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold shadow-xs">
                  <Sparkles size={13} className="text-blue-600" />
                  <span>Gemini 3.8 Flash</span>
                </div>
              )}

              {gradingResult && mode === 'grade' && (
                  <div className="bg-teal-100 text-teal-800 px-4 py-1 rounded-full text-sm font-bold border border-teal-200">
                      Điểm số: {gradingResult.score}
                  </div>
              )}
           </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start gap-3">
                    <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-red-600" />
                    <div>
                      <p className="font-semibold text-sm">Có lỗi phát sinh trong quá trình xử lý:</p>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{error}</p>
                      {provider === 'ollama' && (
                        <p className="text-xs text-red-600 mt-2 bg-red-100/60 p-2 rounded">
                          💡 Gợi ý: Hãy đảm bảo bạn đã chạy <code>ollama run {ollamaConfig.model}</code> trên máy tính và bật CORS nếu kết nối trực tiếp (<code>OLLAMA_ORIGINS="*" ollama serve</code>). Bạn cũng có thể thử đổi sang chế độ <b>Proxy Backend</b> trong bảng cấu hình Ollama bên trái.
                        </p>
                      )}
                    </div>
                </div>
            )}

            {!generatedContent && !gradingResult && !isLoading && !error && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                    <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                        <BookOpen size={40} />
                    </div>
                    <p className="text-lg font-medium">Chưa có dữ liệu</p>
                    <p className="text-sm">Vui lòng sử dụng bảng điều khiển bên trái để bắt đầu.</p>
                </div>
            )}

            {isLoading && (
                 <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <div className={`animate-spin rounded-full h-12 w-12 border-b-2 mb-4 ${provider === 'ollama' ? 'border-indigo-600' : 'border-blue-600'}`}></div>
                    <p className="animate-pulse font-medium text-gray-700">
                      {provider === 'ollama' 
                        ? `Đang xử lý yêu cầu với Ollama (${ollamaConfig.model})...`
                        : 'Đang xử lý yêu cầu với Gemini AI...'}
                    </p>
                    {provider === 'ollama' && (
                      <p className="text-xs text-gray-400 mt-1 max-w-sm text-center">
                        Mô hình chạy cục bộ tại {ollamaConfig.baseUrl} ({ollamaConfig.connectionMode === 'browser' ? 'Direct Browser' : 'Proxy Server'})
                      </p>
                    )}
                 </div>
            )}

            {mode === 'generate' && generatedContent && !isLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                    {/* Column 1: Questions */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-fit min-h-full">
                        <div className="p-4 border-b border-gray-100 bg-gray-50 rounded-t-xl flex justify-between items-center">
                            <h3 className="font-bold text-gray-700 uppercase text-sm tracking-wide">Nội dung Đề bài</h3>
                            <DownloadActions content={generatedContent.questions} prefix="de_thi" />
                        </div>
                        <div className="p-6">
                            <MarkdownRenderer content={generatedContent.questions} />
                        </div>
                    </div>

                    {/* Column 2: Answers */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-fit min-h-full">
                         <div className="p-4 border-b border-gray-100 bg-blue-50 rounded-t-xl flex justify-between items-center">
                            <h3 className="font-bold text-blue-700 uppercase text-sm tracking-wide">Đáp án & Thang điểm</h3>
                            <DownloadActions content={generatedContent.answers} prefix="dap_an" />
                        </div>
                        <div className="p-6">
                            <MarkdownRenderer content={generatedContent.answers} />
                        </div>
                    </div>
                </div>
            )}

            {mode === 'grade' && gradingResult && !isLoading && (
                 <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-4xl mx-auto">
                     <div className="mb-6 pb-4 border-b border-gray-100 flex justify-between items-center">
                         <div>
                            <h2 className="text-2xl font-bold text-gray-800 mb-2">Chi tiết Chấm điểm</h2>
                            <p className="text-gray-500 text-sm">Phân tích tự động dựa trên bài làm và đáp án cung cấp.</p>
                         </div>
                         <DownloadActions content={gradingResult.feedback} prefix="ket_qua_cham_thi" />
                     </div>
                     <MarkdownRenderer content={gradingResult.feedback} />
                 </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default App;