import React, { useState, useEffect } from 'react';
import {
  QuestionType,
  DifficultyLevel,
  ExamConfig,
  GradingConfig,
  AIProvider,
  OllamaConfig,
  OLLAMA_DEFAULT_MODELS,
  OllamaModelInfo
} from '../types';
import {
  Loader2,
  Upload,
  FileText,
  CheckCircle,
  GraduationCap,
  LayoutTemplate,
  X,
  Files,
  Layers,
  Cpu,
  Sparkles,
  Server,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  ExternalLink
} from 'lucide-react';
import { checkOllamaConnection, OllamaConnectionResult } from '../services/ollamaService';

interface ControlPanelProps {
  onGenerate: (config: ExamConfig) => void;
  onGrade: (config: GradingConfig) => void;
  isLoading: boolean;
  provider: AIProvider;
  setProvider: (provider: AIProvider) => void;
  ollamaConfig: OllamaConfig;
  setOllamaConfig: React.Dispatch<React.SetStateAction<OllamaConfig>>;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  onGenerate,
  onGrade,
  isLoading,
  provider,
  setProvider,
  ollamaConfig,
  setOllamaConfig,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'grade'>('create');
  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  const [showOllamaHelp, setShowOllamaHelp] = useState(false);

  // Ollama Connection State
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<OllamaConnectionResult | null>(null);
  const [customModelTag, setCustomModelTag] = useState('');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Header Info State
  const [faculty, setFaculty] = useState('Công nghệ thông tin');
  const [department, setDepartment] = useState('Khoa học máy tính');
  const [targetAudience, setTargetAudience] = useState('Sinh viên đại học chính quy');
  const [duration, setDuration] = useState('60');
  const [signerTitle, setSignerTitle] = useState('TRƯỞNG BỘ MÔN');
  const [signerName, setSignerName] = useState('Nguyễn Văn A');

  // Generation State
  const [subject, setSubject] = useState<string>('Vật lý');
  const [topic, setTopic] = useState('');
  const [specific, setSpecific] = useState('');
  const [qType, setQType] = useState<QuestionType>(QuestionType.MULTIPLE_CHOICE);
  const [level, setLevel] = useState<DifficultyLevel>(DifficultyLevel.RECOGNITION);
  const [quantity, setQuantity] = useState(5);

  // Matrix State (For Essay)
  const [variantCount, setVariantCount] = useState(1);
  const [matrixCounts, setMatrixCounts] = useState({
    [DifficultyLevel.RECOGNITION]: 1,
    [DifficultyLevel.UNDERSTANDING]: 1,
    [DifficultyLevel.APPLICATION]: 1,
    [DifficultyLevel.ADVANCED_APPLICATION]: 0,
  });

  // Source Files State (Array)
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);

  // Grading State
  const [gradingType, setGradingType] = useState<'trac-nghiem' | 'tu-luan'>('trac-nghiem');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);

  // Auto-check connection when switching to Ollama or changing base URL
  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    try {
      const res = await checkOllamaConnection(ollamaConfig.baseUrl, ollamaConfig.connectionMode);
      setConnectionStatus(res);
      if (res.ok && res.models && res.models.length > 0) {
        // If current model not selected or not in list, keep current
      }
    } catch {
      setConnectionStatus({ ok: false, models: [], error: 'Không thể kết nối' });
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleGenerate = () => {
    const isEssay = qType === QuestionType.ESSAY;
    const finalQuantity = isEssay
      ? Object.values(matrixCounts).reduce((a: number, b: number) => a + b, 0)
      : quantity;

    onGenerate({
      subject,
      topic,
      specificRequirement: specific,
      questionType: qType,
      difficulty: level,
      quantity: finalQuantity,
      sourceFiles,
      faculty,
      department,
      targetAudience,
      duration,
      signerTitle,
      signerName,
      levelDistribution: isEssay ? matrixCounts : undefined,
      variantCount: isEssay ? variantCount : 1,
    });
  };

  const handleGrade = () => {
    if (!submissionFile || !answerKeyFile) {
      setGradeError('Vui lòng tải lên cả bài thi và đáp án.');
      return;
    }
    setGradeError(null);
    onGrade({
      submissionFile,
      answerKeyFile,
      gradingType,
    });
  };

  const handleAddSourceFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSourceFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const removeSourceFile = (index: number) => {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateMatrixCount = (lvl: DifficultyLevel, val: number) => {
    setMatrixCounts((prev) => ({ ...prev, [lvl]: val >= 0 ? val : 0 }));
  };

  const FileInput = ({
    label,
    file,
    setFile,
  }: {
    label: string;
    file: File | null;
    setFile: (f: File | null) => void;
  }) => (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      <div className="relative group">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div
          className={`border-2 border-dashed rounded-lg p-3 flex items-center justify-center transition-colors ${
            file ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          {file ? (
            <div className="flex items-center text-green-700 truncate max-w-full">
              <CheckCircle size={16} className="mr-2 flex-shrink-0" />
              <span className="text-sm truncate">{file.name}</span>
            </div>
          ) : (
            <div className="flex items-center text-gray-500">
              <Upload size={16} className="mr-2" />
              <span className="text-sm">Chọn file tài liệu...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-white border-r border-gray-200 shadow-xl overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
              <GraduationCap className="w-5 h-5 text-yellow-300" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">UniExam AI</h2>
              <p className="text-blue-100 text-[11px] opacity-90">Ngân hàng đề thi & Chấm tự động</p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-white/20">
            v2.0
          </span>
        </div>
      </div>

      {/* AI ENGINE SELECTOR (Gemini Cloud vs Ollama Cục Bộ) */}
      <div className="p-3 bg-slate-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
            <Cpu size={13} className="text-indigo-600" />
            Công cụ AI Xử lý
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              provider === 'ollama'
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-blue-100 text-blue-800 border border-blue-300'
            }`}
          >
            {provider === 'ollama' ? '🖥️ Chạy cục bộ (Ollama)' : '⚡ Cloud (Gemini)'}
          </span>
        </div>

        {/* Toggle buttons */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-200/80 rounded-lg">
          <button
            type="button"
            onClick={() => setProvider('gemini')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
              provider === 'gemini'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Sparkles size={13} className="text-blue-600" />
            Gemini Cloud
          </button>
          <button
            type="button"
            onClick={() => setProvider('ollama')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
              provider === 'ollama'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Server size={13} className="text-indigo-600" />
            Ollama Cục bộ
          </button>
        </div>

        {/* Ollama Configuration Panel */}
        {provider === 'ollama' && (
          <div className="mt-3 p-3 bg-white rounded-lg border border-indigo-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                <Server size={14} className="text-indigo-600" />
                Cấu hình Ollama Cục bộ
              </div>
              <button
                type="button"
                onClick={() => setIsConfigExpanded(!isConfigExpanded)}
                className="text-gray-400 hover:text-gray-600 p-0.5"
                title={isConfigExpanded ? "Thu gọn" : "Mở rộng"}
              >
                {isConfigExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {isConfigExpanded && (
              <>
                {/* Endpoint & Test Connection */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">
                      Địa chỉ Ollama (URL)
                    </label>
                    <button
                      type="button"
                      onClick={handleCheckConnection}
                      disabled={isCheckingConnection}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={10} className={isCheckingConnection ? 'animate-spin' : ''} />
                      {isCheckingConnection ? 'Đang test...' : 'Kiểm tra kết nối'}
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={ollamaConfig.baseUrl}
                      onChange={(e) =>
                        setOllamaConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                      }
                      placeholder="http://localhost:11434"
                      className="flex-1 p-1.5 text-xs border rounded bg-slate-50 font-mono text-gray-700 focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Connection Status indicator */}
                  {connectionStatus && (
                    <div
                      className={`mt-1.5 p-2 rounded text-[11px] flex items-start gap-1.5 ${
                        connectionStatus.ok
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}
                    >
                      {connectionStatus.ok ? (
                        <>
                          <CheckCircle size={13} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="font-semibold">Đã kết nối thành công!</span>
                            <span className="block text-[10px] text-emerald-700">
                              {connectionStatus.models.length > 0
                                ? `Tìm thấy ${connectionStatus.models.length} model trên máy (${connectionStatus.source === 'browser' ? 'Direct' : 'Proxy'}).`
                                : 'Đã kết nối máy chủ Ollama.'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <Info size={13} className="text-red-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <span className="font-semibold">Chưa kết nối được.</span>
                            <p className="text-[10px] text-red-700 mt-0.5 leading-snug">
                              {connectionStatus.error || 'Hãy khởi động Ollama hoặc kiểm tra CORS.'}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Connection Mode Selection */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Chế độ kết nối
                  </label>
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setOllamaConfig((prev) => ({ ...prev, connectionMode: 'browser' }))
                      }
                      className={`py-1 px-2 rounded border text-left transition-colors ${
                        ollamaConfig.connectionMode === 'browser'
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-900 font-semibold'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Trình duyệt (Direct)
                      <span className="block text-[9px] text-gray-400 font-normal">
                        Gọi trực tiếp từ client
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOllamaConfig((prev) => ({ ...prev, connectionMode: 'proxy' }))
                      }
                      className={`py-1 px-2 rounded border text-left transition-colors ${
                        ollamaConfig.connectionMode === 'proxy'
                          ? 'bg-indigo-50 border-indigo-400 text-indigo-900 font-semibold'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Proxy Backend
                      <span className="block text-[9px] text-gray-400 font-normal">
                        Qua Express server
                      </span>
                    </button>
                  </div>
                </div>

                {/* MODEL SELECTION WITH SPECIFIC REQUIRED MODELS */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5 flex items-center justify-between">
                    <span>Chọn Model Ollama</span>
                    <span className="text-indigo-600 text-[10px] font-semibold">
                      {ollamaConfig.model}
                    </span>
                  </label>

                  {/* 4 Required Models Grid */}
                  <div className="space-y-1.5">
                    {OLLAMA_DEFAULT_MODELS.map((modelItem: OllamaModelInfo) => {
                      const isSelected = ollamaConfig.model === modelItem.tag;
                      return (
                        <div
                          key={modelItem.tag}
                          onClick={() =>
                            setOllamaConfig((prev) => ({ ...prev, model: modelItem.tag }))
                          }
                          className={`p-2 rounded-lg border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500 text-indigo-950'
                              : 'bg-slate-50 border-gray-200 hover:border-indigo-300 text-gray-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{modelItem.name}</span>
                            <div className="flex items-center gap-1">
                              {isSelected && (
                                <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.2 rounded font-semibold">
                                  Đang chọn
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(`ollama run ${modelItem.tag}`, modelItem.tag);
                                }}
                                title={`Sao chép lệnh cài: ollama run ${modelItem.tag}`}
                                className="text-gray-400 hover:text-indigo-600 p-1 rounded hover:bg-white transition-colors"
                              >
                                {copiedCmd === modelItem.tag ? (
                                  <Check size={12} className="text-green-600" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] font-mono text-gray-500">
                              {modelItem.tag}
                            </span>
                            <span className="text-[9px] text-gray-400 truncate max-w-[170px]">
                              {modelItem.description}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Discovered models dropdown if available */}
                  {connectionStatus?.ok &&
                    connectionStatus.models &&
                    connectionStatus.models.length > 0 && (
                      <div className="mt-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                          Hoặc chọn model phát hiện trên máy:
                        </label>
                        <select
                          value={ollamaConfig.model}
                          onChange={(e) =>
                            setOllamaConfig((prev) => ({ ...prev, model: e.target.value }))
                          }
                          className="w-full p-1.5 text-xs border rounded bg-white font-mono text-gray-800"
                        >
                          {connectionStatus.models.map((tag) => (
                            <option key={tag} value={tag}>
                              {tag}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {/* Custom Model Input */}
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">
                      Nhập tag model tùy chỉnh khác:
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={customModelTag}
                        onChange={(e) => setCustomModelTag(e.target.value)}
                        placeholder="vd: llama3.3:70b hoặc deepseek-r1:14b"
                        className="flex-1 p-1 text-xs border rounded text-gray-700 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (customModelTag.trim()) {
                            setOllamaConfig((prev) => ({
                              ...prev,
                              model: customModelTag.trim(),
                            }));
                            setCustomModelTag('');
                          }
                        }}
                        disabled={!customModelTag.trim()}
                        className="px-2 py-1 bg-gray-200 hover:bg-indigo-600 hover:text-white rounded text-xs font-semibold disabled:opacity-40 transition-colors"
                      >
                        Dùng
                      </button>
                    </div>
                  </div>
                </div>

                {/* Collapsible Help / Terminal Guide */}
                <div className="pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowOllamaHelp(!showOllamaHelp)}
                    className="w-full flex items-center justify-between text-[11px] text-indigo-700 hover:text-indigo-900 font-medium py-1"
                  >
                    <span className="flex items-center gap-1">
                      <Terminal size={12} /> Hướng dẫn khởi chạy & CORS Ollama
                    </span>
                    {showOllamaHelp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {showOllamaHelp && (
                    <div className="mt-2 p-2.5 bg-slate-900 text-slate-100 rounded-lg text-[10px] space-y-2 font-mono">
                      <p className="text-slate-300 font-sans">
                        💡 Để trình duyệt web gọi được Ollama local, hãy bật cờ CORS khi chạy Ollama:
                      </p>
                      <div>
                        <span className="text-amber-400 font-sans font-bold">1. Windows (PowerShell):</span>
                        <div className="mt-0.5 p-1.5 bg-black/50 rounded flex justify-between items-center text-green-400">
                          <code>$env:OLLAMA_ORIGINS="*" ; ollama serve</code>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard('$env:OLLAMA_ORIGINS="*" ; ollama serve', 'win_cors')
                            }
                            className="text-gray-400 hover:text-white"
                          >
                            {copiedCmd === 'win_cors' ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <span className="text-amber-400 font-sans font-bold">2. MacOS / Linux (Bash):</span>
                        <div className="mt-0.5 p-1.5 bg-black/50 rounded flex justify-between items-center text-green-400">
                          <code>OLLAMA_ORIGINS="*" ollama serve</code>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard('OLLAMA_ORIGINS="*" ollama serve', 'mac_cors')
                            }
                            className="text-gray-400 hover:text-white"
                          >
                            {copiedCmd === 'mac_cors' ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <span className="text-amber-400 font-sans font-bold">3. Cài nhanh model:</span>
                        <div className="mt-0.5 p-1.5 bg-black/50 rounded flex justify-between items-center text-cyan-300">
                          <code>ollama pull {ollamaConfig.model}</code>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(`ollama pull ${ollamaConfig.model}`, 'pull_cmd')
                            }
                            className="text-gray-400 hover:text-white"
                          >
                            {copiedCmd === 'pull_cmd' ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('create')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'create'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
              : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          Cấu hình Đề thi
        </button>
        <button
          onClick={() => setActiveTab('grade')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'grade'
              ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50'
              : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          Chấm thi tự động
        </button>
      </div>

      <div className="p-4 flex-1 space-y-5">
        {activeTab === 'create' ? (
          <div className="space-y-4 animate-fadeIn">
            {/* Header Info Section */}
            <div className="bg-blue-50/60 p-3 rounded-lg border border-blue-100">
              <h3 className="text-xs font-bold text-blue-700 uppercase mb-3 flex items-center gap-1">
                <LayoutTemplate size={14} /> Thông tin tiêu đề (Header)
              </h3>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Khoa
                  </label>
                  <input
                    type="text"
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                    placeholder="VD: CNTT"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Bộ môn
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                    placeholder="VD: KHMT"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Đối tượng
                  </label>
                  <input
                    type="text"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Thời gian (phút)
                  </label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Chức danh người ký
                  </label>
                  <input
                    type="text"
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                    placeholder="VD: TRƯỞNG BỘ MÔN"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Họ tên người ký
                  </label>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    className="w-full p-1.5 text-xs border rounded bg-white"
                    placeholder="VD: Nguyễn Văn A"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Môn học
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ví dụ: Vật lý, Toán học đại cương..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm text-gray-800 font-medium"
              />
            </div>

            {/* Multiple File Upload Section */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Tài liệu nguồn ({sourceFiles.length} file)
              </label>
              <div className="relative group mb-2">
                <input
                  type="file"
                  multiple
                  onChange={handleAddSourceFiles}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-lg p-3 flex items-center justify-center transition-colors bg-white">
                  <div className="flex items-center text-gray-500">
                    <Files size={16} className="mr-2" />
                    <span className="text-sm">Chọn nhiều tài liệu...</span>
                  </div>
                </div>
              </div>

              {/* File List */}
              {sourceFiles.length > 0 && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded border border-gray-100">
                  {sourceFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-white p-1.5 rounded shadow-sm border border-gray-100 text-xs"
                    >
                      <div className="flex items-center truncate">
                        <FileText size={12} className="text-blue-500 mr-2 flex-shrink-0" />
                        <span className="truncate max-w-[180px]" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      <button
                        onClick={() => removeSourceFile(index)}
                        className="text-gray-400 hover:text-red-500 ml-2"
                        title="Xóa file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Chủ đề / Nội dung
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ví dụ: Từ trường, Tích phân..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Yêu cầu cụ thể
              </label>
              <textarea
                value={specific}
                onChange={(e) => setSpecific(e.target.value)}
                placeholder="VD: Xác định véc tơ cảm ứng từ..."
                rows={2}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Loại câu hỏi
              </label>
              <select
                value={qType}
                onChange={(e) => setQType(e.target.value as QuestionType)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm font-medium text-indigo-900 bg-indigo-50/50"
              >
                {Object.values(QuestionType).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* CONDITIONAL RENDERING: Matrix Mode for Essay vs Simple Mode for others */}
            {qType === QuestionType.ESSAY ? (
              <div className="bg-gradient-to-br from-indigo-50 to-white p-3 rounded-lg border border-indigo-200 animate-fadeIn">
                <h3 className="text-xs font-bold text-indigo-700 uppercase mb-3 flex items-center gap-1">
                  <Layers size={14} /> Cấu trúc Ma trận Đề
                </h3>

                <div className="space-y-2 mb-3">
                  {Object.values(DifficultyLevel).map((lvl) => (
                    <div key={lvl} className="flex justify-between items-center">
                      <label className="text-xs text-gray-600 font-medium">{lvl}</label>
                      <input
                        type="number"
                        min={0}
                        value={matrixCounts[lvl]}
                        onChange={(e) => updateMatrixCount(lvl, Number(e.target.value))}
                        className="w-16 p-1 text-center text-sm border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-indigo-100 flex justify-between items-center">
                  <label className="text-xs font-bold text-indigo-800 uppercase">
                    Số lượng mã đề
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={variantCount}
                    onChange={(e) => setVariantCount(Number(e.target.value))}
                    className="w-16 p-1 text-center text-sm font-bold border border-indigo-300 rounded bg-white"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 italic text-right">
                  *Tối đa 5 đề một lần
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Mức độ
                  </label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as DifficultyLevel)}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm"
                  >
                    {Object.values(DifficultyLevel).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Tổng số câu
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className={`w-full mt-4 font-semibold py-3 px-4 rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed ${
                provider === 'ollama'
                  ? 'bg-purple-700 hover:bg-purple-800 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileText size={18} />
              )}
              {isLoading
                ? 'Đang khởi tạo...'
                : provider === 'ollama'
                ? `Tạo Đề với Ollama (${ollamaConfig.model})`
                : 'Tạo Đề với Gemini Cloud'}
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 mb-4">
              Tải lên file ảnh hoặc văn bản/PDF của bài làm và đáp án để chấm điểm tự động.
            </div>

            {gradeError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                {gradeError}
              </div>
            )}

            <FileInput
              label="1. Tải lên bài thi (HS làm)"
              file={submissionFile}
              setFile={(f) => {
                setSubmissionFile(f);
                setGradeError(null);
              }}
            />
            <FileInput
              label="2. Tải lên đáp án chuẩn"
              file={answerKeyFile}
              setFile={(f) => {
                setAnswerKeyFile(f);
                setGradeError(null);
              }}
            />

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Loại bài thi
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setGradingType('trac-nghiem')}
                  className={`flex-1 py-2 text-xs rounded border ${
                    gradingType === 'trac-nghiem'
                      ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  Trắc nghiệm
                </button>
                <button
                  onClick={() => setGradingType('tu-luan')}
                  className={`flex-1 py-2 text-xs rounded border ${
                    gradingType === 'tu-luan'
                      ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  Tự luận
                </button>
              </div>
            </div>

            <button
              onClick={handleGrade}
              disabled={isLoading}
              className={`w-full mt-6 font-semibold py-3 px-4 rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed ${
                provider === 'ollama'
                  ? 'bg-purple-700 hover:bg-purple-800 text-white'
                  : 'bg-teal-600 hover:bg-teal-700 text-white'
              }`}
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CheckCircle size={18} />
              )}
              {isLoading
                ? 'Đang chấm thi...'
                : provider === 'ollama'
                ? `Chấm với Ollama (${ollamaConfig.model})`
                : 'Chấm Bài Tự Động (Gemini)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;