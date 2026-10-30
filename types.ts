export enum Subject {
  PHYSICS = 'Vật lý',
  MATH = 'Toán học đại cương',
  ENGLISH = 'Tiếng Anh',
}

export enum QuestionType {
  MULTIPLE_CHOICE = 'Trắc nghiệm 4 phương án',
  TRUE_FALSE = 'Đúng/Sai',
  FILL_BLANK = 'Điền vào chỗ trống',
  ESSAY = 'Tự luận',
}

export enum DifficultyLevel {
  RECOGNITION = 'Nhận biết',
  UNDERSTANDING = 'Thông hiểu',
  APPLICATION = 'Vận dụng',
  ADVANCED_APPLICATION = 'Vận dụng nâng cao',
}

export interface ExamConfig {
  subject: string;
  topic: string;
  specificRequirement: string;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  quantity: number;
  sourceFiles: File[];
  // New Header Fields
  faculty: string;
  department: string;
  targetAudience: string;
  duration: string;
  signerTitle: string;
  signerName: string;
  // Matrix Fields
  levelDistribution?: {
    [DifficultyLevel.RECOGNITION]: number;
    [DifficultyLevel.UNDERSTANDING]: number;
    [DifficultyLevel.APPLICATION]: number;
    [DifficultyLevel.ADVANCED_APPLICATION]: number;
  };
  variantCount?: number;
}

export interface GeneratedContent {
  questions: string;
  answers: string;
}

export interface GradingConfig {
  submissionFile: File | null;
  answerKeyFile: File | null;
  gradingType: 'trac-nghiem' | 'tu-luan';
}

export interface GradingResult {
  feedback: string;
  score: string;
}

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export type AIProvider = 'gemini' | 'ollama';

export interface OllamaModelInfo {
  name: string;
  tag: string;
  description?: string;
  size?: string;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  connectionMode: 'browser' | 'proxy';
}

export const OLLAMA_DEFAULT_MODELS: OllamaModelInfo[] = [
  {
    name: 'Qwen3.6 35B-A3B (Q4)',
    tag: 'qwen3.6:35b-a3b-q4',
    description: 'Bản lượng tử hóa Q4, tư duy toán & khoa học đa lĩnh vực'
  },
  {
    name: 'Gemma 4 12B',
    tag: 'gemma4:12b',
    description: 'Mô hình Google thế hệ mới 12 tỷ tham số mạnh mẽ'
  },
  {
    name: 'qwen2.5-coder:7b',
    tag: 'qwen2.5-coder:7b',
    description: 'Chuyên môn hóa lập trình, giải thuật và bài toán logic'
  },
  {
    name: 'gemma4:e4b',
    tag: 'gemma4:e4b',
    description: 'Phiên bản Gemma tối ưu hóa gọn nhẹ, phản hồi nhanh'
  }
];