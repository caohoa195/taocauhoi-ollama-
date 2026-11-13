import React, { useState, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import MarkdownRenderer from './components/MarkdownRenderer';
import { generateExamContent, gradeSingleSubmission, fileToGenerativePart } from './services/geminiService';
import { generateExamContentOllama, gradeSingleSubmissionOllama } from './services/ollamaService';
import { ExamConfig, GeneratedContent, GradingConfig, GradingResult, StudentGradingResult, AIProvider, OllamaConfig } from './types';
import { BookOpen, FileCheck, AlertCircle, FileText, FileType, Cpu, Server, Sparkles, Users, Award, CheckCircle2, Clock, XCircle, Search, Download, RotateCw, AlertTriangle, X } from 'lucide-react';
import { generateWordDocxBlob, normalizeExamMarkdown } from './utils/wordExporter';

interface DownloadActionsProps {
  content: string;
  prefix: string;
  onDownload: (content: string, filename: string, type: 'txt' | 'doc') => void;
}

const DownloadActions: React.FC<DownloadActionsProps> = ({ content, prefix, onDownload }) => (
  <div className="flex gap-2">
    <button 
      type="button"
      onClick={() => onDownload(content, `${prefix}.docx`, 'doc')}
      className="flex items-center gap-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded transition-colors cursor-pointer"
      title="Tải về file Word (.docx)"
    >
      <FileType size={14} /> Word
    </button>
    <button 
      type="button"
      onClick={() => onDownload(content, `${prefix}.txt`, 'txt')}
      className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1 rounded transition-colors cursor-pointer"
      title="Tải về file Text"
    >
      <FileText size={14} /> .txt
    </button>
  </div>
);

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  
  // Grading State (supports multi-student)
  const [studentResults, setStudentResults] = useState<StudentGradingResult[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [gradingProgress, setGradingProgress] = useState<{ current: number; total: number; currentFileName?: string }>({
    current: 0,
    total: 0
  });

  const [mode, setMode] = useState<'generate' | 'grade'>('generate');
  const [error, setError] = useState<string | null>(null);
  const [searchStudent, setSearchStudent] = useState<string>('');
  const [sortBy, setSortBy] = useState<'default' | 'score-desc' | 'score-asc' | 'name'>('default');
  const [ollamaFallbackNotice, setOllamaFallbackNotice] = useState<string | null>(null);
  const [fileUrlMap, setFileUrlMap] = useState<Record<string, string>>({});
  const [viewingFileUrl, setViewingFileUrl] = useState<{ url: string; name: string } | null>(null);

  // AI Provider & Ollama Configuration with persistence (default to Gemini Cloud for out-of-the-box reliability)
  const [provider, setProvider] = useState<AIProvider>(() => {
    return (localStorage.getItem('uniexam_provider') as AIProvider) || 'gemini';
  });

  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>(() => {
    return {
      baseUrl: localStorage.getItem('uniexam_ollama_url') || 'http://localhost:11434',
      model: localStorage.getItem('uniexam_ollama_model') || 'gemma4:e4b',
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
    setOllamaFallbackNotice(null);

    try {
      let result: GeneratedContent;
      if (provider === 'ollama') {
        try {
          result = await generateExamContentOllama(config, ollamaConfig);
        } catch (ollamaErr: any) {
          console.warn("Ollama tạo đề gặp lỗi, thử chuyển sang Gemini Cloud:", ollamaErr.message);
          try {
            result = await generateExamContent(config);
            setOllamaFallbackNotice(
              ollamaErr?.message?.includes('không hỗ trợ đọc ảnh')
                ? `${ollamaErr.message} Hệ thống đã tạm dùng Gemini Cloud để hoàn tất.`
                : `Ollama cục bộ tại ${ollamaConfig.baseUrl} không phản hồi. Hệ thống đã tự động chuyển sang Gemini Cloud AI để hoàn tất tạo đề.`
            );
          } catch (geminiErr: any) {
            throw new Error(
              `Ollama lỗi: ${ollamaErr?.message || 'Không phản hồi'}\n\nĐồng thời Gemini Cloud cũng lỗi: ${geminiErr?.message || 'Không xác định'}`
            );
          }
        }
      } else {
        result = await generateExamContent(config);
      }
      setGeneratedContent({
        questions: normalizeExamMarkdown(result.questions),
        answers: normalizeExamMarkdown(result.answers),
      });
    } catch (err: any) {
      console.error("Lỗi khi tạo đề:", err);
      setError(err.message || "Đã xảy ra lỗi khi tạo đề.");
    } finally {
      setIsLoading(false);
    }
  };

  const extractMasterRubric = (feedback: string): string => {
    if (!feedback) return '';
    const lines = feedback.split(/\r?\n/);
    const rows: string[] = [];
    let inTable = false;
    let nameCol = 1;
    let maxCol = 2;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
        if (inTable && rows.length > 0) break;
        continue;
      }
      if (/^\|\s*[: -]+\s*\|/.test(trimmed)) continue;

      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      const lower = trimmed.toLowerCase();

      if (lower.includes('câu hỏi') || lower.includes('câu / ý') || lower.includes('thang điểm')) {
        inTable = true;
        for (let cIdx = 0; cIdx < cells.length; cIdx++) {
          const cLower = cells[cIdx].toLowerCase();
          if (cLower.includes('câu hỏi') || cLower.includes('câu / ý') || cLower === 'câu') nameCol = cIdx;
          if (cLower.includes('thang điểm') || cLower.includes('thang')) maxCol = cIdx;
        }
        continue;
      }

      if (inTable) {
        if (lower.includes('tổng cộng') || lower.includes('tổng điểm')) continue;
        if (cells.length > Math.max(nameCol, maxCol)) {
          const qName = cells[nameCol];
          const qMax = cells[maxCol];
          if (qName && qMax && /\d/.test(qMax)) {
            rows.push(`- ${qName}: Thang điểm tối đa ${qMax}`);
          }
        }
      }
    }

    return rows.length > 0 ? rows.join('\n') : '';
  };

  const [lastGradingConfig, setLastGradingConfig] = useState<GradingConfig | null>(null);

  const handleRetryStudent = async (studentId: string, forceProvider?: 'gemini' | 'ollama') => {
    if (!lastGradingConfig) return;
    const target = studentResults.find(s => s.id === studentId);
    if (!target) return;
    const file = lastGradingConfig.submissionFiles.find(f => f.name === target.fileName || target.fileName.startsWith(f.name));
    if (!file) return;

    setStudentResults(prev => prev.map(s => s.id === studentId ? { ...s, status: 'grading', error: undefined } : s));

    const activeProvider = forceProvider || provider;
    
    // Find master rubric from any already completed student to ensure consistency
    const existingDone = studentResults.find(s => s.id !== studentId && s.status === 'done' && s.feedback);
    const retryMasterRubric = existingDone ? extractMasterRubric(existingDone.feedback) : undefined;

    const retryOptions = {
      examQuestionFile: lastGradingConfig.examQuestionFile,
      examQuestionText: lastGradingConfig.examQuestionText,
      answerKeyText: lastGradingConfig.answerKeyText,
      fastFinalResultGrading: lastGradingConfig.fastFinalResultGrading,
      masterRubric: retryMasterRubric,
    };

    try {
      let res: any;
      if (activeProvider === 'ollama') {
        try {
          res = await gradeSingleSubmissionOllama(file, lastGradingConfig.answerKeyFile, lastGradingConfig.gradingType, ollamaConfig, target.studentName, retryOptions);
        } catch (ollamaErr: any) {
          if (!forceProvider) {
            console.warn("Ollama không phản hồi, tự động thử với Gemini Cloud:", ollamaErr.message);
            try {
              res = await gradeSingleSubmission(file, lastGradingConfig.answerKeyFile, lastGradingConfig.gradingType, target.studentName, retryOptions);
              setOllamaFallbackNotice(
                ollamaErr?.message?.includes('không hỗ trợ đọc ảnh')
                  ? `${ollamaErr.message} Hệ thống đã tạm dùng Gemini Cloud để hoàn tất.`
                  : "Ollama cục bộ không phản hồi. Đã hoàn tất chấm điểm bằng Gemini Cloud AI."
              );
            } catch (geminiErr: any) {
              throw new Error(
                `Ollama lỗi: ${ollamaErr?.message || 'Không phản hồi'} | Gemini Cloud cũng lỗi: ${geminiErr?.message || 'Không xác định'}`
              );
            }
          } else {
            throw ollamaErr;
          }
        }
      } else {
        res = await gradeSingleSubmission(file, lastGradingConfig.answerKeyFile, lastGradingConfig.gradingType, target.studentName, retryOptions);
      }

      const st = res.students && res.students.length > 0 ? res.students[0] : res;
      setStudentResults(prev => prev.map(s => s.id === studentId ? {
        ...s,
        studentName: st.studentName || s.studentName,
        studentId: st.studentId || s.studentId,
        className: st.className || s.className,
        examCode: st.examCode || s.examCode,
        score: st.score || res.score || 'Đã chấm',
        feedback: st.feedback || res.content,
        status: 'done'
      } : s));
    } catch (err: any) {
      console.error(`Lỗi chấm lại thí sinh ${target.fileName}:`, err);
      setStudentResults(prev => prev.map(s => s.id === studentId ? {
        ...s,
        score: 'Lỗi',
        feedback: `Lỗi chấm bài: ${err.message || 'Không thể xử lý bài làm này.'}`,
        status: 'error',
        error: err.message
      } : s));
    }
  };

  const handleGrade = async (config: GradingConfig) => {
    const files = config.submissionFiles;
    if (!files || files.length === 0) {
      setError("Vui lòng chọn ít nhất một file bài làm của học sinh.");
      return;
    }

    setLastGradingConfig(config);
    setIsLoading(true);
    setError(null);
    setMode('grade');

    // Create object URLs for previewing student files and question file directly
    try {
      const urls: Record<string, string> = {};
      for (const f of files) {
        urls[f.name] = URL.createObjectURL(f);
      }
      if (config.examQuestionFile) {
        urls[config.examQuestionFile.name] = URL.createObjectURL(config.examQuestionFile);
      }
      setFileUrlMap(prev => ({ ...prev, ...urls }));
    } catch (e) {
      console.warn("Could not create object URLs:", e);
    }

    // Initialize list of students
    const initialStudents: StudentGradingResult[] = files.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      studentName: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      fileName: file.name,
      score: '...',
      feedback: '',
      status: 'pending'
    }));

    setStudentResults(initialStudents);
    setSelectedStudentId(initialStudents[0].id);
    setGradingProgress({ current: 0, total: files.length, currentFileName: files[0].name });

    const gradingOptions = {
      examQuestionFile: config.examQuestionFile,
      examQuestionText: config.examQuestionText,
      answerKeyText: config.answerKeyText,
      fastFinalResultGrading: config.fastFinalResultGrading,
    };

    let sharedMasterRubric = '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const placeholderStudentId = initialStudents[i].id;

      setGradingProgress({
        current: i + 1,
        total: files.length,
        currentFileName: file.name
      });

      // Mark current student placeholder as grading
      setStudentResults(prev => prev.map(s => s.id === placeholderStudentId ? { ...s, status: 'grading' } : s));

      const currentGradingOptions = {
        ...gradingOptions,
        masterRubric: sharedMasterRubric || undefined,
      };

      try {
        let res: any;
        if (provider === 'ollama') {
          try {
            res = await gradeSingleSubmissionOllama(file, config.answerKeyFile, config.gradingType, ollamaConfig, file.name, currentGradingOptions);
          } catch (ollamaErr: any) {
            console.warn(`Ollama gặp lỗi cho file ${file.name}, tự động thử Gemini Cloud AI:`, ollamaErr.message);
            try {
              res = await gradeSingleSubmission(file, config.answerKeyFile, config.gradingType, file.name, currentGradingOptions);
              setOllamaFallbackNotice(
                ollamaErr?.message?.includes('không hỗ trợ đọc ảnh')
                  ? `${ollamaErr.message} Hệ thống đã tạm dùng Gemini Cloud AI để hoàn tất.`
                  : "Ollama cục bộ tại localhost:11434 không phản hồi (chưa khởi chạy hoặc chặn kết nối). Hệ thống đã tự động chuyển sang Gemini Cloud AI để hoàn tất chấm bài mà không bị gián đoạn."
              );
            } catch (geminiErr: any) {
              throw new Error(
                `Ollama lỗi: ${ollamaErr?.message || 'Không phản hồi'} | Gemini Cloud cũng lỗi: ${geminiErr?.message || 'Không xác định'}`
              );
            }
          }
        } else {
          res = await gradeSingleSubmission(file, config.answerKeyFile, config.gradingType, file.name, currentGradingOptions);
        }

        // Anchor master rubric from first completed student so all subsequent students share the EXACT same rubric
        if (!sharedMasterRubric && (res.content || res.feedback)) {
          const extracted = extractMasterRubric(res.content || res.feedback);
          if (extracted) {
            sharedMasterRubric = extracted;
            console.log("Anchored shared master rubric across all submissions in batch:\n", sharedMasterRubric);
          }
        }

        const detectedStudents = res.students && res.students.length > 0 ? res.students : [{
          studentName: res.studentName || file.name.replace(/\.[^/.]+$/, ''),
          studentId: res.studentId,
          className: res.className,
          examCode: res.examCode,
          score: res.score || 'Đã chấm',
          feedback: res.content
        }];

        if (detectedStudents.length > 1) {
          // Document contained 2 or more student papers: split into distinct separate cards!
          const newStudentItems: StudentGradingResult[] = detectedStudents.map((st: any, sIdx: number) => ({
            id: `${placeholderStudentId}-${sIdx}`,
            studentName: st.studentName || `Thí sinh ${sIdx + 1}`,
            studentId: st.studentId,
            className: st.className,
            examCode: st.examCode,
            fileName: `${file.name} (Bài ${sIdx + 1})`,
            score: st.score || 'Đã chấm',
            feedback: st.feedback,
            status: 'done' as const
          }));

          setStudentResults(prev => {
            const index = prev.findIndex(s => s.id === placeholderStudentId);
            if (index !== -1) {
              const updated = [...prev];
              updated.splice(index, 1, ...newStudentItems);
              return updated;
            }
            return [...prev, ...newStudentItems];
          });
          setSelectedStudentId(newStudentItems[0].id);
        } else {
          // Single student: update real student name, studentId, className, and formal grade sheet
          const st = detectedStudents[0];
          setStudentResults(prev => prev.map(s => s.id === placeholderStudentId ? {
            ...s,
            studentName: st.studentName || s.studentName,
            studentId: st.studentId || s.studentId,
            className: st.className || s.className,
            examCode: st.examCode || s.examCode,
            score: st.score || 'Đã chấm',
            feedback: st.feedback || res.content,
            status: 'done' as const
          } : s));
        }
      } catch (studentErr: any) {
        console.error(`Lỗi chấm bài thí sinh ${file.name}:`, studentErr);
        setStudentResults(prev => prev.map(s => s.id === placeholderStudentId ? {
          ...s,
          score: 'Lỗi',
          feedback: `Lỗi chấm bài: ${studentErr.message || 'Không thể xử lý bài làm này.'}`,
          status: 'error',
          error: studentErr.message
        } : s));
      }
    }

    setIsLoading(false);
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

  const downloadFile = async (content: string, filename: string, type: 'txt' | 'doc') => {
    const cleanContent = typeof content === 'string' ? content.trim() : '';
    if (!cleanContent) {
        console.warn("Attempted to download empty content");
        setError("Nội dung trống, không thể tải về.");
        return;
    }

    try {
      let blob: Blob;
      let targetFilename = filename;

      if (type === 'doc') {
          targetFilename = filename.endsWith('.doc') ? `${filename}x` : filename;
          blob = await generateWordDocxBlob(cleanContent);
          if (!blob || blob.size === 0) {
              const fallbackHtml = markdownToHtml(cleanContent);
              blob = new Blob(['\ufeff', fallbackHtml], { type: 'application/msword;charset=utf-8' });
              targetFilename = filename.replace(/\.docx$/i, '.doc');
          }
      } else {
          blob = new Blob(['\ufeff', cleanContent], { type: 'text/plain;charset=utf-8' });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = targetFilename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
          if (a.parentNode) {
              a.parentNode.removeChild(a);
          }
          URL.revokeObjectURL(url);
      }, 15000);
    } catch (dlErr: any) {
      console.error("Download error:", dlErr);
      setError(`Không thể tạo tệp tải về: ${dlErr?.message || 'Lỗi không xác định'}`);
    }
  };

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

              {mode === 'grade' && studentResults.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="bg-teal-100 text-teal-800 px-3 py-1 rounded-full text-xs font-bold border border-teal-200 flex items-center gap-1.5">
                    <Users size={13} />
                    {studentResults.filter(s => s.status === 'done').length}/{studentResults.length} Đã chấm
                  </span>
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

            {!generatedContent && studentResults.length === 0 && !isLoading && !error && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                    <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                        <BookOpen size={40} />
                    </div>
                    <p className="text-lg font-medium">Chưa có dữ liệu</p>
                    <p className="text-sm">Vui lòng sử dụng bảng điều khiển bên trái để bắt đầu tạo đề hoặc tải danh sách bài làm để chấm.</p>
                </div>
            )}

            {isLoading && mode === 'generate' && (
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
                            <DownloadActions content={generatedContent.questions} prefix="de_thi" onDownload={downloadFile} />
                        </div>
                        <div className="p-6">
                            <MarkdownRenderer content={generatedContent.questions} />
                        </div>
                    </div>

                    {/* Column 2: Answers */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-fit min-h-full">
                         <div className="p-4 border-b border-gray-100 bg-blue-50 rounded-t-xl flex justify-between items-center">
                            <h3 className="font-bold text-blue-700 uppercase text-sm tracking-wide">Đáp án & Thang điểm</h3>
                            <DownloadActions content={generatedContent.answers} prefix="dap_an" onDownload={downloadFile} />
                        </div>
                        <div className="p-6">
                            <MarkdownRenderer content={generatedContent.answers} />
                        </div>
                    </div>
                </div>
            )}

            {/* MULTI-STUDENT GRADING VIEW */}
            {mode === 'grade' && studentResults.length > 0 && (
                <div className="space-y-6">
                  {/* Ollama fallback alert banner */}
                  {ollamaFallbackNotice && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex items-start justify-between gap-3 text-amber-900 shadow-xs animate-fadeIn">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-bold text-xs">Thông báo chuyển đổi luồng xử lý:</p>
                          <p className="text-xs text-amber-800 mt-0.5">
                            {ollamaFallbackNotice}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setOllamaFallbackNotice(null)}
                        className="text-amber-700 hover:text-amber-900 text-xs font-bold px-2 py-0.5 rounded hover:bg-amber-100"
                      >
                        ✕ Đóng
                      </button>
                    </div>
                  )}
                  {/* Progress Banner if grading in progress */}
                  {isLoading && (
                    <div className="bg-gradient-to-r from-teal-500 to-emerald-600 rounded-xl p-4 text-white shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          <span className="font-semibold text-sm">
                            Đang chấm bài thi ({gradingProgress.current}/{gradingProgress.total})...
                          </span>
                        </div>
                        <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-bold">
                          {Math.round((gradingProgress.current / (gradingProgress.total || 1)) * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-white/20 rounded-full h-2 mb-2 overflow-hidden">
                        <div 
                          className="bg-white h-full transition-all duration-300 rounded-full" 
                          style={{ width: `${Math.round((gradingProgress.current / (gradingProgress.total || 1)) * 100)}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-teal-100 truncate">
                        Đang xử lý bài làm: <b>{gradingProgress.currentFileName}</b> với {provider === 'ollama' ? `Ollama (${ollamaConfig.model})` : 'Gemini AI'}
                      </p>
                    </div>
                  )}

                  {/* Summary Bar & Batch Actions */}
                  <div className="bg-white rounded-xl p-4 shadow-xs border border-gray-200 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-teal-50 text-teal-700">
                          <Users size={22} />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Tổng số bài nộp</p>
                          <p className="text-xl font-bold text-gray-800">{studentResults.length} học sinh</p>
                        </div>
                      </div>

                      <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>

                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700">
                          <CheckCircle2 size={22} />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Hoàn thành</p>
                          <p className="text-xl font-bold text-emerald-700">
                            {studentResults.filter(s => s.status === 'done').length} bài
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Export Actions for all students */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          const csvHeader = "\uFEFFSTT,Họ và tên thí sinh,MSSV/SBD,Lớp,Mã đề,Điểm số,Tên tệp bài nộp,Trạng thái\n";
                          const csvRows = studentResults.map((s, idx) => 
                            `"${idx + 1}","${(s.studentName || '').replace(/"/g, '""')}","${(s.studentId || '').replace(/"/g, '""')}","${(s.className || '').replace(/"/g, '""')}","${(s.examCode || '').replace(/"/g, '""')}","${(s.score || '').replace(/"/g, '""')}","${(s.fileName || '').replace(/"/g, '""')}","${s.status === 'done' ? 'Đã chấm xong' : s.status}"`
                          ).join("\n");
                          const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `bang_diem_tong_hop_${new Date().toISOString().slice(0, 10)}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          setTimeout(() => {
                            if (a.parentNode) a.parentNode.removeChild(a);
                            URL.revokeObjectURL(url);
                          }, 15000);
                        }}
                        className="flex items-center gap-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer"
                        title="Tải bảng điểm tổng hợp CSV"
                      >
                        <Download size={14} /> Xuất bảng điểm (.csv)
                      </button>

                      <button
                        onClick={() => {
                          const allFeedback = studentResults.map((s, idx) => `
# BÀI THI THÍ SINH SỐ ${idx + 1}: ${s.studentName}
${s.studentId ? `- **Mã số sinh viên / SBD:** ${s.studentId}` : ''}
${s.className ? `- **Lớp / Khóa:** ${s.className}` : ''}
${s.examCode ? `- **Mã đề thi:** ${s.examCode}` : ''}
- **Tệp bài nộp:** ${s.fileName}
- **Điểm số chính thức:** ${s.score}
- **Trạng thái:** ${s.status === 'done' ? 'Đã hoàn thành chấm thi' : s.status}

${s.feedback || 'Chưa có nội dung phiếu chấm'}

<div class="word-page-break"></div>
                          `).join("\n\n---\n\n");
                          downloadFile(allFeedback, `tong_hop_phieu_cham_thi_tat_ca_thi_sinh.docx`, 'doc');
                        }}
                        className="flex items-center gap-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer"
                        title="Tải toàn bộ phiếu chấm thi Word của tất cả thí sinh"
                      >
                        <FileType size={14} /> Xuất tất cả bài làm (.docx)
                      </button>
                    </div>
                  </div>

                  {/* Main Grid: Student List & Detail Viewer */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Left: Student List (4 Cols) */}
                    <div className="lg:col-span-4 bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                          <Users size={14} className="text-teal-600" />
                          Danh sách học sinh
                        </span>
                        <span className="text-[11px] text-gray-500 font-medium">
                          {studentResults.length} bài
                        </span>
                      </div>

                      {/* Search and Sort toolbar */}
                      <div className="p-2.5 border-b border-gray-100 bg-white space-y-2">
                        <div className="relative">
                          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Tìm kiếm học sinh / file..."
                            value={searchStudent}
                            onChange={(e) => setSearchStudent(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-gray-50 focus:bg-white outline-none"
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-gray-500 px-0.5">
                          <span className="font-semibold text-gray-600 text-[10px]">Thứ tự:</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setSortBy('default')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                sortBy === 'default' ? 'bg-teal-100 text-teal-800 font-bold' : 'hover:bg-gray-100 text-gray-600'
                              }`}
                            >
                              Gốc
                            </button>
                            <button
                              type="button"
                              onClick={() => setSortBy('score-desc')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                sortBy === 'score-desc' ? 'bg-teal-100 text-teal-800 font-bold' : 'hover:bg-gray-100 text-gray-600'
                              }`}
                              title="Điểm cao xuống thấp"
                            >
                              Điểm ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => setSortBy('score-asc')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                sortBy === 'score-asc' ? 'bg-teal-100 text-teal-800 font-bold' : 'hover:bg-gray-100 text-gray-600'
                              }`}
                              title="Điểm thấp lên cao"
                            >
                              Điểm ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => setSortBy('name')}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                sortBy === 'name' ? 'bg-teal-100 text-teal-800 font-bold' : 'hover:bg-gray-100 text-gray-600'
                              }`}
                              title="Tên A - Z"
                            >
                              Tên A-Z
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Student Cards */}
                      <div className="divide-y divide-gray-100 max-h-[550px] overflow-y-auto">
                        {[...studentResults]
                          .filter(s => s.studentName.toLowerCase().includes(searchStudent.toLowerCase()) || s.fileName.toLowerCase().includes(searchStudent.toLowerCase()))
                          .sort((a, b) => {
                            const getNum = (str?: string) => {
                              if (!str) return -1;
                              const m = str.match(/(\d+(?:\.\d+)?)/);
                              return m ? parseFloat(m[1]) : -1;
                            };
                            if (sortBy === 'score-desc') return getNum(b.score) - getNum(a.score);
                            if (sortBy === 'score-asc') return getNum(a.score) - getNum(b.score);
                            if (sortBy === 'name') return a.studentName.localeCompare(b.studentName);
                            return 0;
                          })
                          .map((student, idx) => {
                            const isSelected = student.id === selectedStudentId;
                            return (
                              <div
                                key={student.id}
                                onClick={() => setSelectedStudentId(student.id)}
                                className={`p-3 cursor-pointer transition-colors flex items-center justify-between ${
                                  isSelected 
                                    ? 'bg-teal-50/80 border-l-4 border-teal-600' 
                                    : 'hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                    isSelected ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {idx + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="text-xs font-bold text-gray-800 truncate" title={student.studentName}>
                                        {student.studentName}
                                      </p>
                                      {student.studentId && (
                                        <span className="text-[9px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded-full">
                                          {student.studentId}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                                      {student.className ? `${student.className} • ` : ''}{student.fileName}
                                    </p>
                                  </div>
                                </div>

                                {/* Score & Status Badge */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {student.status === 'done' && (
                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                      {student.score}
                                    </span>
                                  )}
                                  {student.status === 'grading' && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1 animate-pulse">
                                      <Clock size={10} /> Đang chấm
                                    </span>
                                  )}
                                  {student.status === 'pending' && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                      Chờ
                                    </span>
                                  )}
                                  {student.status === 'error' && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
                                      <XCircle size={10} /> Lỗi
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                        })}
                      </div>
                    </div>

                    {/* Right: Selected Student Detail Feedback (8 Cols) */}
                    <div className="lg:col-span-8 bg-white rounded-xl shadow-xs border border-gray-200 min-h-[550px] flex flex-col">
                      {selectedStudentId && (() => {
                        const current = studentResults.find(s => s.id === selectedStudentId);
                        if (!current) return null;

                        return (
                          <>
                            {/* Detail Header */}
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="text-base font-extrabold text-gray-800">
                                    {current.studentName}
                                  </h3>
                                  {current.studentId && (
                                    <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-indigo-200">
                                      MSSV/SBD: {current.studentId}
                                    </span>
                                  )}
                                  {current.className && (
                                    <span className="bg-gray-100 text-gray-700 text-xs font-medium px-2 py-0.5 rounded-full">
                                      Lớp: {current.className}
                                    </span>
                                  )}
                                  {current.examCode && (
                                    <span className="bg-purple-50 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full border border-purple-200">
                                      {current.examCode}
                                    </span>
                                  )}
                                  {current.status === 'done' && (
                                    <span className="bg-emerald-100 text-emerald-800 font-extrabold text-xs px-2.5 py-0.5 rounded-full border border-emerald-300">
                                      Điểm: {current.score}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-400 mt-1">
                                  Tệp bài làm gốc: <span className="font-mono text-gray-600">{current.fileName}</span>
                                </p>
                              </div>

                              {current.status === 'done' && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  {lastGradingConfig?.examQuestionFile && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const url = fileUrlMap[lastGradingConfig.examQuestionFile!.name] || '/assets/aistudio/De_thi_Vat_ly_45_phut_De_2_358b78f3.pdf';
                                        setViewingFileUrl({ url, name: `Đề bài: ${lastGradingConfig.examQuestionFile!.name}` });
                                      }}
                                      className="flex items-center gap-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-semibold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                      title="Xem tệp đề bài gốc"
                                    >
                                      <BookOpen size={14} className="text-indigo-600" /> Xem đề bài
                                    </button>
                                  )}
                                  {(fileUrlMap[current.fileName] || current.fileName.includes("B_i_thi") || current.fileName.includes("Ngô Quang Huy")) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const url = fileUrlMap[current.fileName] || '/assets/aistudio/B_i_thi_1_19613f1c.pdf';
                                        setViewingFileUrl({ url, name: `Bài làm: ${current.fileName}` });
                                      }}
                                      className="flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-semibold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                      title="Xem tệp bài thi viết tay gốc"
                                    >
                                      <FileText size={14} className="text-teal-600" /> Xem bài làm gốc
                                    </button>
                                  )}
                                  <DownloadActions 
                                    content={`# PHIẾU CHẤM ĐIỂM THI: ${current.studentName}\n${current.studentId ? `- **MSSV / SBD:** ${current.studentId}\n` : ''}${current.className ? `- **Lớp:** ${current.className}\n` : ''}${current.examCode ? `- **Mã đề:** ${current.examCode}\n` : ''}- **Tệp bài làm gốc:** ${current.fileName}\n- **Điểm số chính thức:** ${current.score}\n\n${current.feedback}`} 
                                    prefix={`phieu_cham_${current.studentName.replace(/\s+/g, '_')}`} 
                                    onDownload={downloadFile}
                                  />
                                </div>
                              )}
                            </div>

                            {/* Detail Content */}
                            <div className="p-6 flex-1 overflow-y-auto">
                              {current.status === 'pending' && (
                                <div className="h-64 flex flex-col items-center justify-center text-gray-400">
                                  <Clock size={32} className="mb-2 text-gray-300" />
                                  <p className="text-sm font-medium">Bài làm này đang chờ tới lượt chấm...</p>
                                </div>
                              )}

                              {current.status === 'grading' && (
                                <div className="h-64 flex flex-col items-center justify-center text-teal-600">
                                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent mb-3"></div>
                                  <p className="text-sm font-medium animate-pulse">Đang phân tích và chấm bài của {current.studentName}...</p>
                                </div>
                              )}

                              {current.status === 'error' && (
                                <div className="p-5 bg-red-50 border border-red-200 rounded-xl text-red-700 shadow-xs">
                                  <div className="flex items-start gap-2.5 mb-3">
                                    <AlertCircle size={20} className="mt-0.5 text-red-600 flex-shrink-0" />
                                    <div className="flex-1">
                                      <p className="font-bold text-sm">Có sự cố khi chấm bài của thí sinh này:</p>
                                      <div className="text-xs mt-1.5 text-red-700 font-mono bg-red-100/70 p-2.5 rounded-lg whitespace-pre-wrap leading-relaxed border border-red-200">
                                        {current.error || current.feedback}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2.5 mt-4 flex-wrap pt-2 border-t border-red-200/60">
                                    <button
                                      type="button"
                                      onClick={() => handleRetryStudent(current.id, 'gemini')}
                                      disabled={isLoading}
                                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <Sparkles size={14} />
                                      ⚡ Chấm ngay bằng Gemini Cloud AI (Khuyên dùng)
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleRetryStudent(current.id, 'ollama')}
                                      disabled={isLoading}
                                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-100 active:bg-gray-200 text-gray-700 border border-gray-300 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <RotateCw size={12} className={current.status === 'grading' ? "animate-spin" : ""} />
                                      Thử lại với Ollama
                                    </button>
                                  </div>
                                </div>
                              )}

                              {current.status === 'done' && (
                                <div className="prose max-w-none">
                                  <MarkdownRenderer content={current.feedback} />
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
            )}
        </div>
      </div>

      {/* Modal xem bài làm gốc / tài liệu */}
      {viewingFileUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200">
            <div className="px-5 py-3.5 bg-gray-900 text-white flex items-center justify-between border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <FileText size={18} className="text-teal-400" />
                <span className="font-semibold text-sm truncate max-w-lg">
                  Xem bài làm gốc: {viewingFileUrl.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={viewingFileUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 font-medium transition-colors"
                >
                  Mở tab mới
                </a>
                <button
                  type="button"
                  onClick={() => setViewingFileUrl(null)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer"
                  title="Đóng xem trước"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-gray-100 p-2 overflow-hidden">
              <iframe
                src={viewingFileUrl.url}
                className="w-full h-full rounded-lg border border-gray-200 bg-white"
                title={viewingFileUrl.name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;