import React, { useState, useEffect } from 'react';
import {
  QuestionType,
  DifficultyLevel,
  DifficultyMatrixCounts,
  ObjectiveSubQuestionType,
  ObjectiveMatrixSection,
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
  ExternalLink,
  FileCheck
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

interface FileInputProps {
  label?: string;
  file: File | null;
  setFile: (f: File | null) => void;
  subtext?: string;
}

const FileInput: React.FC<FileInputProps> = ({
  label,
  file,
  setFile,
  subtext,
}) => (
  <div className="mb-3">
    {label && (
      <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wider">
        {label}
      </label>
    )}
    {subtext && <p className="text-[11px] text-gray-500 mb-1.5">{subtext}</p>}
    <div className="relative group">
      {!file ? (
        <>
          <input
            type="file"
            accept=".docx,.doc,.pdf,.png,.jpg,.jpeg,.txt,.md"
            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="border-2 border-dashed border-gray-300 hover:border-teal-400 rounded-lg p-3 flex items-center justify-center transition-colors bg-gray-50">
            <div className="flex items-center text-gray-500 text-xs gap-1.5">
              <Upload size={15} />
              <span>Chọn file (Word .docx, PDF, Ảnh, Text)...</span>
            </div>
          </div>
        </>
      ) : (
        <div className="border border-emerald-300 bg-emerald-50 rounded-lg p-2.5 flex items-center justify-between text-xs text-emerald-900 shadow-xs">
          <div className="flex items-center truncate gap-2 flex-1 mr-2">
            <CheckCircle size={16} className="text-emerald-600 flex-shrink-0" />
            <div className="truncate">
              <span className="font-semibold block truncate" title={file.name}>{file.name}</span>
              <span className="text-[10px] text-emerald-700 block">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-emerald-100 transition-colors cursor-pointer"
            title="Xóa tệp này"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  </div>
);

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
  const [faculty, setFaculty] = useState('Cơ bản');
  const [department, setDepartment] = useState('Toán - Lý');
  const [targetAudience, setTargetAudience] = useState('ĐHCN6');
  const [duration, setDuration] = useState('60');
  const [signerTitle, setSignerTitle] = useState('TRƯỞNG BỘ MÔN');
  const [signerName, setSignerName] = useState('Nguyễn Văn A');

  // Generation State
  const [subject, setSubject] = useState<string>('Vật lý đại cương');
  const [topic, setTopic] = useState('');
  const [specific, setSpecific] = useState('');
  const [qType, setQType] = useState<QuestionType>(QuestionType.MULTIPLE_CHOICE);
  const [level, setLevel] = useState<DifficultyLevel>(DifficultyLevel.RECOGNITION);
  const [quantity, setQuantity] = useState(5);

  // Matrix State (For Essay)
  const [variantCount, setVariantCount] = useState(1);
  const [matrixCounts, setMatrixCounts] = useState<DifficultyMatrixCounts>({
    [DifficultyLevel.RECOGNITION]: 1,
    [DifficultyLevel.UNDERSTANDING]: 1,
    [DifficultyLevel.APPLICATION]: 1,
    [DifficultyLevel.ADVANCED_APPLICATION]: 0,
  });

  // Objective Matrix State (For Combined Mixed Objective Exam: 4 options, True/False, Fill-blank x 4 difficulty levels)
  const [objectiveMatrix, setObjectiveMatrix] = useState<
    Record<ObjectiveSubQuestionType, DifficultyMatrixCounts>
  >({
    [QuestionType.MULTIPLE_CHOICE]: {
      [DifficultyLevel.RECOGNITION]: 4,
      [DifficultyLevel.UNDERSTANDING]: 3,
      [DifficultyLevel.APPLICATION]: 2,
      [DifficultyLevel.ADVANCED_APPLICATION]: 1,
    },
    [QuestionType.TRUE_FALSE]: {
      [DifficultyLevel.RECOGNITION]: 1,
      [DifficultyLevel.UNDERSTANDING]: 1,
      [DifficultyLevel.APPLICATION]: 1,
      [DifficultyLevel.ADVANCED_APPLICATION]: 1,
    },
    [QuestionType.FILL_BLANK]: {
      [DifficultyLevel.RECOGNITION]: 2,
      [DifficultyLevel.UNDERSTANDING]: 1,
      [DifficultyLevel.APPLICATION]: 1,
      [DifficultyLevel.ADVANCED_APPLICATION]: 0,
    },
  });
  const [genError, setGenError] = useState<string | null>(null);

  // Source Files State (Array)
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);

  // Grading State (supports multiple student submissions)
  const [gradingType, setGradingType] = useState<'auto' | 'trac-nghiem' | 'tu-luan' | 'hon-hop'>('auto');
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([]);
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [examQuestionFile, setExamQuestionFile] = useState<File | null>(null);
  const [examQuestionText, setExamQuestionText] = useState<string>('');
  const [showQuestionTextInput, setShowQuestionTextInput] = useState<boolean>(false);
  const [fastFinalResultGrading, setFastFinalResultGrading] = useState<boolean>(true);
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

  const OBJECTIVE_SUB_TYPES: ObjectiveSubQuestionType[] = [
    QuestionType.MULTIPLE_CHOICE,
    QuestionType.TRUE_FALSE,
    QuestionType.FILL_BLANK,
  ];

  const getObjectiveTypeTotal = (type: ObjectiveSubQuestionType): number => {
    const counts = objectiveMatrix[type];
    return (
      (counts[DifficultyLevel.RECOGNITION] || 0) +
      (counts[DifficultyLevel.UNDERSTANDING] || 0) +
      (counts[DifficultyLevel.APPLICATION] || 0) +
      (counts[DifficultyLevel.ADVANCED_APPLICATION] || 0)
    );
  };

  const totalObjectiveQuestions = OBJECTIVE_SUB_TYPES.reduce(
    (sum, type) => sum + getObjectiveTypeTotal(type),
    0
  );

  const handleGenerate = () => {
    const isEssay = qType === QuestionType.ESSAY;
    const isMixedObjective = qType === QuestionType.MIXED_OBJECTIVE;

    const objectiveSections: ObjectiveMatrixSection[] = OBJECTIVE_SUB_TYPES.map((type) => ({
      type,
      counts: objectiveMatrix[type],
    }));

    const finalQuantity = isEssay
      ? Object.values(matrixCounts).reduce((a: number, b: number) => a + b, 0)
      : isMixedObjective
      ? totalObjectiveQuestions
      : quantity;

    if (finalQuantity <= 0) {
      setGenError('Vui lòng nhập ít nhất 1 câu hỏi để tạo đề.');
      return;
    }

    setGenError(null);
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
      objectiveMatrix: isMixedObjective ? objectiveSections : undefined,
      variantCount: isEssay || isMixedObjective ? variantCount : 1,
    });
  };

  const handleGrade = () => {
    if (submissionFiles.length === 0) {
      setGradeError('Vui lòng tải lên ít nhất một bài thi học sinh để chấm.');
      return;
    }
    if (!answerKeyFile && !examQuestionFile && !examQuestionText.trim()) {
      setGradeError('Vui lòng cung cấp Đề bài (Đề thi gốc) hoặc file Đáp án chuẩn để đối chiếu.');
      return;
    }
    setGradeError(null);
    onGrade({
      submissionFiles,
      examQuestionFile,
      examQuestionText: examQuestionText.trim() || undefined,
      answerKeyFile,
      gradingType,
      fastFinalResultGrading,
    });
  };

  const handleAddSubmissionFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSubmissionFiles((prev) => [...prev, ...newFiles]);
      setGradeError(null);
    }
  };

  const removeSubmissionFile = (index: number) => {
    setSubmissionFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllSubmissionFiles = () => {
    setSubmissionFiles([]);
  };

  const [isLoadingSample, setIsLoadingSample] = useState(false);

  const loadSampleExam = async () => {
    setIsLoadingSample(true);
    setGradeError(null);
    try {
      const [subRes, keyRes] = await Promise.all([
        fetch('/assets/aistudio/B_i_thi_1_19613f1c.pdf'),
        fetch('/assets/aistudio/De_thi_Vat_ly_45_phut_De_2_358b78f3.pdf')
      ]);

      if (!subRes.ok || !keyRes.ok) {
        throw new Error("Không thể tải tệp mẫu từ hệ thống.");
      }

      const subBlob = await subRes.blob();
      const keyBlob = await keyRes.blob();

      const sampleSubmission = new File([subBlob], "Bài thi viết tay - SV Ngô Quang Huy (Đề 2).pdf", {
        type: 'application/pdf',
      });
      const sampleQuestion = new File([keyBlob], "Đề thi Vật lý Đại cương 45 phút (Đề 02).pdf", {
        type: 'application/pdf',
      });
      const sampleKey = new File([keyBlob], "Đáp án & Thang điểm chi tiết (Đề 02).pdf", {
        type: 'application/pdf',
      });

      setExamQuestionFile(sampleQuestion);
      setSubmissionFiles([sampleSubmission]);
      setAnswerKeyFile(sampleKey);
      setGradingType('auto');
      setFastFinalResultGrading(true);
    } catch (err: any) {
      console.error("Lỗi nạp bài thi mẫu:", err);
      setGradeError("Không thể nạp bài thi mẫu: " + err.message);
    } finally {
      setIsLoadingSample(false);
    }
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
    setGenError(null);
    setMatrixCounts((prev) => ({ ...prev, [lvl]: val >= 0 ? Math.floor(val) : 0 }));
  };

  const updateObjectiveMatrixCount = (
    type: ObjectiveSubQuestionType,
    lvl: DifficultyLevel,
    val: number
  ) => {
    setGenError(null);
    const safeVal = Number.isFinite(val) && val >= 0 ? Math.floor(val) : 0;
    setObjectiveMatrix((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [lvl]: safeVal,
      },
    }));
  };


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
                    placeholder="VD: Cơ bản"
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
                    placeholder="VD: Toán - Lý"
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
                placeholder="Ví dụ: Vật lý đại cương, Toán học đại cương..."
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

            {/* CONDITIONAL RENDERING: Essay Matrix vs Combined Objective Matrix vs Simple Single-Type Mode */}
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
                    onChange={(e) => setVariantCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-16 p-1 text-center text-sm font-bold border border-indigo-300 rounded bg-white"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 italic text-right">
                  *Tối đa 5 đề một lần
                </p>
              </div>
            ) : qType === QuestionType.MIXED_OBJECTIVE ? (
              <div className="bg-gradient-to-br from-blue-50 to-white p-3 rounded-lg border border-blue-200 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-blue-800 uppercase flex items-center gap-1">
                    <Layers size={14} /> Ma trận Trắc nghiệm tổng hợp
                  </h3>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    Tổng: {totalObjectiveQuestions} câu
                  </span>
                </div>

                <div className="space-y-2.5">
                  {OBJECTIVE_SUB_TYPES.map((subType) => {
                    const subTotal = getObjectiveTypeTotal(subType);
                    return (
                      <div
                        key={subType}
                        className="bg-white p-2.5 rounded-lg border border-blue-100 shadow-xs"
                      >
                        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-100">
                          <span className="text-xs font-bold text-gray-800">{subType}</span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              subTotal > 0
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {subTotal} câu
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {Object.values(DifficultyLevel).map((lvl) => (
                            <div key={lvl} className="flex items-center justify-between gap-1">
                              <label
                                className="text-[11px] text-gray-600 truncate"
                                title={lvl}
                              >
                                {lvl}
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={50}
                                value={objectiveMatrix[subType][lvl]}
                                onChange={(e) =>
                                  updateObjectiveMatrixCount(subType, lvl, Number(e.target.value))
                                }
                                className="w-12 p-1 text-center text-xs font-medium border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-blue-100 flex justify-between items-center">
                  <label className="text-xs font-bold text-blue-800 uppercase">
                    Số lượng mã đề
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={variantCount}
                    onChange={(e) => setVariantCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-16 p-1 text-center text-sm font-bold border border-blue-300 rounded bg-white"
                  />
                </div>
                <p className="text-[10px] text-gray-500 italic text-right">
                  *Đặt 0 ở dạng/mức độ không dùng • Tối đa 5 mã đề
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
                    onChange={(e) => {
                      setGenError(null);
                      setQuantity(Number(e.target.value));
                    }}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none text-sm"
                  />
                </div>
              </div>
            )}

            {genError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                {genError}
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
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-900 mb-4">
              <p className="font-semibold flex items-center gap-1.5 mb-1 text-teal-800">
                <Files size={14} className="text-teal-600" />
                Chấm thi hàng loạt nhiều học sinh
              </p>
              Tải lên cùng lúc nhiều bài làm của học sinh (ảnh bài chụp, PDF, text, Word) và file đáp án chuẩn. Hệ thống sẽ tự động chấm điểm tuần tự từng em và tổng hợp bảng điểm.
            </div>

            {/* Quick Sample Button: Nạp bài thi viết tay & đáp án mẫu thực tế */}
            <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-blue-600" />
                  Mẫu bài thi, đề bài & đáp án
                </span>
                <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">
                  Vật lý Đại cương
                </span>
              </div>
              <p className="text-[11px] text-gray-600 mb-2.5 leading-snug">
                Nạp tự động đề bài, bài thi viết tay thực tế (SV Ngô Quang Huy) và bareme điểm Đề 02 để thử nghiệm ngay.
              </p>
              <button
                type="button"
                onClick={loadSampleExam}
                disabled={isLoadingSample}
                className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoadingSample ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <FileCheck size={13} />
                )}
                <span>🎯 Nạp bài thi viết tay, đề bài & đáp án mẫu</span>
              </button>
            </div>

            {gradeError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                {gradeError}
              </div>
            )}

            {/* 1. CUNG CẤP ĐỀ BÀI (ĐỀ THI GỐC) */}
            <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider">
                  1. Cung cấp Đề bài (Đề thi gốc)
                </label>
                <button
                  type="button"
                  onClick={() => setShowQuestionTextInput(!showQuestionTextInput)}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                >
                  {showQuestionTextInput ? "📁 Tải lên tệp đề bài" : "✏️ Nhập văn bản đề bài"}
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mb-2">
                Cung cấp đề thi để AI nắm rõ yêu cầu, giả thiết và câu hỏi của đề bài khi chấm.
              </p>

              {!showQuestionTextInput ? (
                <FileInput
                  file={examQuestionFile}
                  setFile={(f) => {
                    setExamQuestionFile(f);
                    setGradeError(null);
                  }}
                  subtext=""
                />
              ) : (
                <div className="space-y-1">
                  <textarea
                    value={examQuestionText}
                    onChange={(e) => setExamQuestionText(e.target.value)}
                    placeholder="Dán hoặc gõ nội dung đề bài (Câu 1, Câu 2... và các yêu cầu)..."
                    rows={4}
                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:border-teal-500 focus:bg-white bg-white outline-none"
                  />
                  {examQuestionText && (
                    <div className="flex items-center justify-between text-[10px] text-gray-400">
                      <span>Đã nhập: {examQuestionText.length} ký tự</span>
                      <button
                        type="button"
                        onClick={() => setExamQuestionText('')}
                        className="text-red-500 hover:underline"
                      >
                        Xóa văn bản
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Multiple Student Submissions Upload */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  2. Danh sách bài làm học sinh ({submissionFiles.length} bài)
                </label>
                {submissionFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAllSubmissionFiles}
                    className="text-[10px] text-red-500 hover:text-red-700 underline cursor-pointer"
                  >
                    Xóa tất cả
                  </button>
                )}
              </div>

              <div className="relative group mb-2">
                <input
                  type="file"
                  multiple
                  accept=".docx,.doc,.pdf,.png,.jpg,.jpeg,.txt,.md"
                  onChange={handleAddSubmissionFiles}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`border-2 border-dashed rounded-lg p-3 flex flex-col items-center justify-center transition-colors ${
                  submissionFiles.length > 0
                    ? 'border-teal-500 bg-teal-50/50 hover:bg-teal-50'
                    : 'border-gray-300 hover:border-teal-400 bg-gray-50'
                }`}>
                  <div className="flex items-center text-teal-700 font-medium text-xs gap-1.5">
                    <Upload size={15} />
                    <span>Chọn bài thi (Word .docx, PDF, Ảnh bài chụp...)</span>
                  </div>
                  <span className="text-[10px] text-gray-500 mt-1">
                    Nhấn giữ <b>Ctrl</b> hoặc <b>Shift</b> để chọn cùng lúc nhiều bài thi của học sinh
                  </span>
                </div>
              </div>

              {/* Uploaded Files List */}
              {submissionFiles.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <div className="text-[11px] font-semibold text-gray-600 px-1 pb-1 border-b border-gray-200 flex justify-between">
                    <span>Học sinh / Tên file bài làm</span>
                    <span className="text-teal-700 font-bold">{submissionFiles.length} thí sinh</span>
                  </div>
                  {submissionFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-white p-2 rounded shadow-xs border border-gray-100 text-xs"
                    >
                      <div className="flex items-center truncate gap-2 flex-1 mr-2">
                        <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <span className="font-semibold text-gray-800 block truncate" title={file.name}>
                            {file.name.replace(/\.[^/.]+$/, '')}
                          </span>
                          <span className="text-[10px] text-gray-400 block truncate">
                            {file.name} ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSubmissionFile(idx)}
                        className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                        title="Xóa bài thi này"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Answer Key File Upload */}
            <FileInput
              label="3. Tải lên đáp án chuẩn & thang điểm"
              file={answerKeyFile}
              setFile={(f) => {
                setAnswerKeyFile(f);
                setGradeError(null);
              }}
              subtext="Tệp chứa lời giải chuẩn và barem điểm từng câu (PDF, Word, Ảnh...)"
            />

            {/* 4. QUY TẮC CHẤM: ĐÚNG ĐÁP ÁN CUỐI CHO TRỌN ĐIỂM */}
            <div className={`p-3 rounded-xl border transition-all ${
              fastFinalResultGrading 
                ? 'bg-amber-50/80 border-amber-300 shadow-xs ring-1 ring-amber-200' 
                : 'bg-gray-50 border-gray-200 opacity-80'
            }`}>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="fastFinalResult"
                  checked={fastFinalResultGrading}
                  onChange={(e) => setFastFinalResultGrading(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500 cursor-pointer accent-teal-600"
                />
                <label htmlFor="fastFinalResult" className="text-xs text-amber-950 font-bold cursor-pointer select-none flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>⭐ Quy tắc ưu tiên kết quả cuối cùng</span>
                    <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded font-semibold">Khuyên dùng</span>
                  </div>
                  <span className="block text-[11px] font-normal text-amber-900 mt-1 leading-snug">
                    Nếu bài làm <b>đúng đáp án cuối cùng</b> (kèm lời giải hợp lệ) ➔ Cho <b>điểm cuối cùng trọn vẹn</b>. Chỉ khi <b>không đúng đáp án cuối cùng</b> ➔ Mới rà soát chấm điểm các thành phần (công thức, biến đổi, thay số).
                  </span>
                </label>
              </div>
            </div>

            {/* Chống lệch điểm / Ổn định tuyệt đối */}
            <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-900 shadow-xs">
              <div className="flex items-center gap-1.5 mb-1 text-xs font-bold text-emerald-800">
                <CheckCircle size={14} className="text-emerald-600" />
                <span>Khóa chuẩn hóa cố định (Deterministic = 100%)</span>
              </div>
              <p className="text-[10px] text-emerald-700 leading-snug">
                Nhiệt độ mô hình được khóa cứng (<code>Temperature: 0.0</code>) cùng một bảng barem đồng nhất. Mọi lần chấm trên cùng một bài nộp luôn cho kết quả giống hệt nhau 100%, chống đảo ngược điểm số giữa các thí sinh.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Chế độ chấm thi
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setGradingType('auto')}
                  className={`py-2 px-1 text-[11px] rounded border transition-colors text-center ${
                    gradingType === 'auto'
                      ? 'bg-teal-100 border-teal-500 text-teal-800 font-bold shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                  title="Tự động nhận diện Trắc nghiệm, Tự luận hoặc Đề thi hỗn hợp"
                >
                  ⚡ Tự động (Chuẩn)
                </button>
                <button
                  type="button"
                  onClick={() => setGradingType('trac-nghiem')}
                  className={`py-2 px-1 text-[11px] rounded border transition-colors text-center ${
                    gradingType === 'trac-nghiem'
                      ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Trắc nghiệm
                </button>
                <button
                  type="button"
                  onClick={() => setGradingType('tu-luan')}
                  className={`py-2 px-1 text-[11px] rounded border transition-colors text-center ${
                    gradingType === 'tu-luan'
                      ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Tự luận
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1 italic">
                *Chế độ "Tự động" tự đối chiếu bảng trắc nghiệm, bài tự luận, đề hỗn hợp và bareme điểm.
              </p>
            </div>

            {/* Tốc độ chấm / Luồng song song */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                  ⚡ Tốc độ quét & chấm:
                </span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Chấm song song siêu tốc
                </span>
              </div>
              <p className="text-[10px] text-gray-500 leading-tight">
                Tự động tối ưu hóa tài liệu và xử lý đồng thời nhiều học sinh để rút ngắn thời gian chấm từ vài phút xuống vài giây.
              </p>
            </div>


            <button
              onClick={handleGrade}
              disabled={isLoading || submissionFiles.length === 0}
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
                ? `Đang chấm ${submissionFiles.length} bài thi...`
                : submissionFiles.length > 1
                ? `Chấm tự động cùng lúc (${submissionFiles.length} học sinh)`
                : submissionFiles.length === 1
                ? 'Chấm bài học sinh này'
                : 'Tải lên bài thi để bắt đầu chấm'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;