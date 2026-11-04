import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  BookOpen,
  Layers,
  PenTool,
  LayoutDashboard,
  Sun,
  Moon,
  Search,
  Shuffle,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Volume2,
  Eye,
  EyeOff,
  Undo2,
  Trash2,
  Sparkles,
  Filter,
  ArrowRight,
  Check,
  X,
  PlusCircle,
  Download,
  Upload,
  RefreshCw,
  Award,
  BookMarked,
  GraduationCap,
  Keyboard,
  ListFilter,
  HelpCircle
} from 'lucide-react';

// ============================================================================
// 1. DATA LAYER (SEPARATED FROM UI - LOADED DIRECTLY FROM hsk5.json)
// ============================================================================

export interface VocabularyRaw {
  zh: string;
  pinyin: string;
  hanViet: string;
  vi: string;
  wordType: string;
}

export interface GrammarExample {
  zh: string;
  vi: string;
}

export interface GrammarRaw {
  structure: string;
  meaning: string;
  usage: string;
  examples: GrammarExample[];
}

export interface LessonRaw {
  lessonNumber: number;
  lessonTitle: string;
  objectives: string;
  vocabulary: VocabularyRaw[];
  grammar: GrammarRaw[];
}

export interface HSK5Dataset {
  translation: Record<string, LessonRaw>;
}

export interface VocabularyItem extends VocabularyRaw {
  id: string;
  lessonKey: string;
  lessonNumber: number;
  indexInLesson: number;
}

export interface GrammarItem extends GrammarRaw {
  id: string;
  lessonKey: string;
  lessonNumber: number;
  indexInLesson: number;
}

export interface ParsedLesson {
  key: string;
  lessonNumber: number;
  rawTitle: string;
  zhTitle: string;
  viTitle: string;
  objectives: string;
  vocabulary: VocabularyItem[];
  grammar: GrammarItem[];
}

import hsk5RawData from './data/hsk5.json';
export const INITIAL_HSK5_DATA: HSK5Dataset = hsk5RawData as HSK5Dataset;

/**
 * Helper to extract clean Chinese & Vietnamese titles from raw lessonTitle
 * Supports formats like: "Bài 1: Những chi tiết nhỏ trong tình yêu (第一课：爱的细节)"
 * as well as any future lesson title format added to JSON.
 */
export function parseLessonTitles(rawTitle: string, lessonNumber: number): { zhTitle: string; viTitle: string } {
  if (!rawTitle) {
    return { zhTitle: `第${lessonNumber}课`, viTitle: `Bài ${lessonNumber}` };
  }
  const parenMatch = rawTitle.match(/\(([^)]+)\)/);
  let zhPart = '';
  if (parenMatch && parenMatch[1]) {
    const inside = parenMatch[1].trim();
    const colonSplit = inside.split(/[：:]/);
    zhPart = colonSplit.length > 1 ? colonSplit.slice(1).join('：').trim() : inside;
  }

  let viPart = rawTitle.replace(/\s*\([^)]*\)\s*/, '').trim();
  const viColonSplit = viPart.split(/[:：]/);
  if (viColonSplit.length > 1 && /^bài\s*\d+/i.test(viColonSplit[0].trim())) {
    viPart = viColonSplit.slice(1).join(':').trim();
  }

  if (!zhPart) {
    const cjkMatch = rawTitle.match(/[\u4e00-\u9fff，。！？、]+/g);
    zhPart = cjkMatch ? cjkMatch.join(' ') : viPart;
  }

  return {
    zhTitle: zhPart || rawTitle,
    viTitle: viPart || rawTitle
  };
}

/**
 * Extracts individual valid Chinese characters (Hanzi) from a vocabulary word
 * Ignores parentheses like （）() or punctuation so each character can be practiced.
 */
export function extractHanziChars(zhText: string): string[] {
  if (!zhText) return [];
  const chars = Array.from(zhText).filter((ch) => /[\u4e00-\u9fff]/.test(ch));
  return chars.length > 0 ? chars : [zhText.trim().charAt(0)].filter(Boolean);
}

/**
 * Normalizes a string for Vietnamese and Pinyin accent-insensitive search
 */
export function normalizeSearchText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/**
 * Transforms raw JSON dataset into normalized Lesson, Vocabulary, and Grammar structures.
 * Adding new lessons to translation JSON automatically populates across the entire app.
 */
export function normalizeDataset(dataset: HSK5Dataset): ParsedLesson[] {
  if (!dataset || !dataset.translation || typeof dataset.translation !== 'object') {
    return [];
  }
  const entries = Object.entries(dataset.translation);
  return entries
    .map(([key, raw], idx) => {
      const lessonNum = typeof raw.lessonNumber === 'number' ? raw.lessonNumber : idx + 1;
      const { zhTitle, viTitle } = parseLessonTitles(raw.lessonTitle || '', lessonNum);
      const vocabList: VocabularyItem[] = Array.isArray(raw.vocabulary)
        ? raw.vocabulary.map((v, vIdx) => ({
            zh: v.zh || '',
            pinyin: v.pinyin || '',
            hanViet: v.hanViet || '',
            vi: v.vi || '',
            wordType: v.wordType || '',
            id: `${key}_vocab_${vIdx}_${v.zh || vIdx}`,
            lessonKey: key,
            lessonNumber: lessonNum,
            indexInLesson: vIdx + 1
          }))
        : [];

      const grammarList: GrammarItem[] = Array.isArray(raw.grammar)
        ? raw.grammar.map((g, gIdx) => ({
            structure: g.structure || '',
            meaning: g.meaning || '',
            usage: g.usage || '',
            examples: Array.isArray(g.examples) ? g.examples : [],
            id: `${key}_grammar_${gIdx}_${g.structure || gIdx}`,
            lessonKey: key,
            lessonNumber: lessonNum,
            indexInLesson: gIdx + 1
          }))
        : [];

      return {
        key,
        lessonNumber: lessonNum,
        rawTitle: raw.lessonTitle || `Bài ${lessonNum}`,
        zhTitle,
        viTitle,
        objectives: raw.objectives || '',
        vocabulary: vocabList,
        grammar: grammarList
      };
    })
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
}

// ============================================================================
// 2. PROGRESS & STORAGE LAYER (LOCALSTORAGE WITH SAFE FALLBACK)
// ============================================================================

export type MemoryStatus = 'unlearned' | 'remembered' | 'needs_review';

export interface WritingRecord {
  practicedCount: number;
  lastPracticedAt: number;
  mastered: boolean;
}

export interface LearningProgressState {
  vocabStatus: Record<string, MemoryStatus>;
  grammarStatus: Record<string, MemoryStatus>;
  writingProgress: Record<string, WritingRecord>;
  lastActiveLessonKey: string;
  updatedAt: number;
}

const STORAGE_KEY_PROGRESS = 'hsk5_by_quyky_progress_v1';
const STORAGE_KEY_THEME = 'hsk5_by_quyky_theme_v1';
const STORAGE_KEY_CUSTOM_DATA = 'hsk5_by_quyky_custom_json_v1';

const DEFAULT_PROGRESS: LearningProgressState = {
  vocabStatus: {},
  grammarStatus: {},
  writingProgress: {},
  lastActiveLessonKey: 'bai1',
  updatedAt: Date.now()
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or sandbox restrictions gracefully
  }
}

export function useLearningProgress() {
  const [progress, setProgress] = useState<LearningProgressState>(() =>
    loadFromStorage<LearningProgressState>(STORAGE_KEY_PROGRESS, DEFAULT_PROGRESS)
  );

  useEffect(() => {
    saveToStorage(STORAGE_KEY_PROGRESS, progress);
  }, [progress]);

  const setVocabMemory = useCallback((vocabId: string, status: MemoryStatus) => {
    setProgress((prev) => ({
      ...prev,
      vocabStatus: {
        ...prev.vocabStatus,
        [vocabId]: status
      },
      updatedAt: Date.now()
    }));
  }, []);

  const setGrammarMemory = useCallback((grammarId: string, status: MemoryStatus) => {
    setProgress((prev) => ({
      ...prev,
      grammarStatus: {
        ...prev.grammarStatus,
        [grammarId]: status
      },
      updatedAt: Date.now()
    }));
  }, []);

  const recordWritingPractice = useCallback((vocabId: string, markMastered = true) => {
    setProgress((prev) => {
      const existing = prev.writingProgress[vocabId] || {
        practicedCount: 0,
        lastPracticedAt: 0,
        mastered: false
      };
      return {
        ...prev,
        writingProgress: {
          ...prev.writingProgress,
          [vocabId]: {
            practicedCount: existing.practicedCount + 1,
            lastPracticedAt: Date.now(),
            mastered: markMastered ? true : existing.mastered
          }
        },
        updatedAt: Date.now()
      };
    });
  }, []);

  const toggleWritingMastered = useCallback((vocabId: string) => {
    setProgress((prev) => {
      const existing = prev.writingProgress[vocabId] || {
        practicedCount: 0,
        lastPracticedAt: Date.now(),
        mastered: false
      };
      return {
        ...prev,
        writingProgress: {
          ...prev.writingProgress,
          [vocabId]: {
            ...existing,
            practicedCount: Math.max(1, existing.practicedCount),
            lastPracticedAt: Date.now(),
            mastered: !existing.mastered
          }
        },
        updatedAt: Date.now()
      };
    });
  }, []);

  const setLastActiveLesson = useCallback((lessonKey: string) => {
    setProgress((prev) => ({
      ...prev,
      lastActiveLessonKey: lessonKey
    }));
  }, []);

  const resetAllProgress = useCallback(() => {
    const fresh: LearningProgressState = {
      vocabStatus: {},
      grammarStatus: {},
      writingProgress: {},
      lastActiveLessonKey: 'bai1',
      updatedAt: Date.now()
    };
    setProgress(fresh);
    saveToStorage(STORAGE_KEY_PROGRESS, fresh);
  }, []);

  return {
    progress,
    setVocabMemory,
    setGrammarMemory,
    recordWritingPractice,
    toggleWritingMastered,
    setLastActiveLesson,
    resetAllProgress
  };
}

// ============================================================================
// 3. SPEECH SYNTHESIS HELPER (PRONUNCIATION)
// ============================================================================

export function speakChinese(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/（.*?）|\(.*?\)/g, '').trim() || text;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors on unsupported browsers
  }
}

// ============================================================================
// 4. FLASHCARD LOGIC ENGINE (SEPARATED FROM COMPONENT VIEW)
// ============================================================================

export type FlashcardType = 'vocabulary' | 'grammar';
export type FlashcardStudyMode =
  | 'all'
  | 'unremembered'
  | 'needs_review'
  | 'random'
  | 'sequential';

export interface UseFlashcardEngineProps {
  lessons: ParsedLesson[];
  selectedLessonKey: string; // 'all' or lesson.key
  cardType: FlashcardType;
  studyMode: FlashcardStudyMode;
  vocabStatus: Record<string, MemoryStatus>;
  grammarStatus: Record<string, MemoryStatus>;
  initialTargetId?: string | null;
}

export function useFlashcardEngine({
  lessons,
  selectedLessonKey,
  cardType,
  studyMode,
  vocabStatus,
  grammarStatus,
  initialTargetId
}: UseFlashcardEngineProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [isManualShuffled, setIsManualShuffled] = useState(false);
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [autoPlaySpeedMs, setAutoPlaySpeedMs] = useState(3500);

  // Gather base items from lessons
  const basePool = useMemo(() => {
    const targetLessons =
      selectedLessonKey === 'all'
        ? lessons
        : lessons.filter((l) => l.key === selectedLessonKey);

    if (cardType === 'vocabulary') {
      return targetLessons.flatMap((l) => l.vocabulary);
    } else {
      return targetLessons.flatMap((l) => l.grammar);
    }
  }, [lessons, selectedLessonKey, cardType]);

  // Filter & order according to studyMode without mutating during active browsing unless mode/filter changes
  const [deckIds, setDeckIds] = useState<string[]>([]);

  const rebuildDeck = useCallback(
    (forceRandom = false) => {
      const statusMap = cardType === 'vocabulary' ? vocabStatus : grammarStatus;
      let filtered = [...basePool];

      if (studyMode === 'unremembered') {
        filtered = filtered.filter((item) => (statusMap[item.id] || 'unlearned') !== 'remembered');
      } else if (studyMode === 'needs_review') {
        filtered = filtered.filter((item) => statusMap[item.id] === 'needs_review');
      }

      if (studyMode === 'random' || forceRandom) {
        // Fisher-Yates shuffle
        const copy = [...filtered];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        filtered = copy;
      }

      const ids = filtered.map((item) => item.id);
      setDeckIds(ids);

      if (initialTargetId && ids.includes(initialTargetId)) {
        setCurrentIndex(ids.indexOf(initialTargetId));
      } else {
        setCurrentIndex(0);
      }
      setIsFlipped(false);
    },
    [basePool, cardType, studyMode, vocabStatus, grammarStatus, initialTargetId]
  );

  // Rebuild deck only when scope, cardType, studyMode, or manual shuffle triggers
  useEffect(() => {
    rebuildDeck(isManualShuffled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLessonKey, cardType, studyMode, shuffleSeed, basePool.length]);

  // Jump to initialTargetId when requested from Lesson view
  useEffect(() => {
    if (initialTargetId && deckIds.includes(initialTargetId)) {
      setCurrentIndex(deckIds.indexOf(initialTargetId));
      setIsFlipped(false);
    }
  }, [initialTargetId, deckIds]);

  const deckItems = useMemo(() => {
    const map = new Map(basePool.map((item) => [item.id, item]));
    return deckIds.map((id) => map.get(id)).filter(Boolean) as (VocabularyItem | GrammarItem)[];
  }, [basePool, deckIds]);

  const safeIndex = deckItems.length > 0 ? Math.min(currentIndex, deckItems.length - 1) : 0;
  const currentCard = deckItems[safeIndex] || null;

  const nextCard = useCallback(() => {
    if (deckItems.length === 0) return;
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % deckItems.length);
  }, [deckItems.length]);

  const prevCard = useCallback(() => {
    if (deckItems.length === 0) return;
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + deckItems.length) % deckItems.length);
  }, [deckItems.length]);

  const flipCard = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  const shuffleDeck = useCallback(() => {
    setIsManualShuffled(true);
    setShuffleSeed((s) => s + 1);
  }, []);

  // Auto-play timer: first flips card to show answer, then moves to next card
  useEffect(() => {
    if (!isAutoPlay || deckItems.length === 0) return;
    const timer = window.setTimeout(() => {
      if (!isFlipped) {
        setIsFlipped(true);
      } else {
        setIsFlipped(false);
        setCurrentIndex((prev) => (prev + 1) % deckItems.length);
      }
    }, autoPlaySpeedMs);

    return () => window.clearTimeout(timer);
  }, [isAutoPlay, isFlipped, currentIndex, deckItems.length, autoPlaySpeedMs]);

  return {
    deckItems,
    currentCard,
    currentIndex: safeIndex,
    totalCards: deckItems.length,
    isFlipped,
    isAutoPlay,
    autoPlaySpeedMs,
    setIsAutoPlay,
    setAutoPlaySpeedMs,
    setIsFlipped,
    flipCard,
    nextCard,
    prevCard,
    shuffleDeck,
    refreshDeck: () => rebuildDeck(isManualShuffled)
  };
}

// ============================================================================
// 5. WRITING PRACTICE LOGIC ENGINE (SEPARATED FROM COMPONENT VIEW)
// ============================================================================

export type WritingPracticeMode = 'all_lesson' | 'single_word' | 'unremembered' | 'random';

export interface Point {
  x: number;
  y: number;
}

export function useWritingEngine({
  lessons,
  selectedLessonKey,
  practiceMode,
  vocabStatus,
  initialVocabId
}: {
  lessons: ParsedLesson[];
  selectedLessonKey: string;
  practiceMode: WritingPracticeMode;
  vocabStatus: Record<string, MemoryStatus>;
  initialVocabId?: string | null;
}) {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [activeCharIndex, setActiveCharIndex] = useState(0);
  const [showModelChar, setShowModelChar] = useState(false);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [randomSeed, setRandomSeed] = useState(0);

  const baseVocab = useMemo(() => {
    const targetLessons =
      selectedLessonKey === 'all'
        ? lessons
        : lessons.filter((l) => l.key === selectedLessonKey);
    return targetLessons.flatMap((l) => l.vocabulary);
  }, [lessons, selectedLessonKey]);

  const [wordIds, setWordIds] = useState<string[]>([]);

  useEffect(() => {
    let list = [...baseVocab];
    if (practiceMode === 'unremembered') {
      list = list.filter((w) => (vocabStatus[w.id] || 'unlearned') !== 'remembered');
    } else if (practiceMode === 'random') {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      list = copy;
    }

    const ids = list.map((w) => w.id);
    setWordIds(ids);

    if (initialVocabId && ids.includes(initialVocabId)) {
      setCurrentWordIndex(ids.indexOf(initialVocabId));
    } else {
      setCurrentWordIndex(0);
    }
    setActiveCharIndex(0);
    setStrokes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLessonKey, practiceMode, randomSeed, baseVocab.length]);

  useEffect(() => {
    if (initialVocabId && wordIds.includes(initialVocabId)) {
      setCurrentWordIndex(wordIds.indexOf(initialVocabId));
      setActiveCharIndex(0);
      setStrokes([]);
    }
  }, [initialVocabId, wordIds]);

  const wordList = useMemo(() => {
    const map = new Map(baseVocab.map((w) => [w.id, w]));
    return wordIds.map((id) => map.get(id)).filter(Boolean) as VocabularyItem[];
  }, [baseVocab, wordIds]);

  const safeWordIndex = wordList.length > 0 ? Math.min(currentWordIndex, wordList.length - 1) : 0;
  const currentWord = wordList[safeWordIndex] || null;

  const hanziChars = useMemo(() => {
    return currentWord ? extractHanziChars(currentWord.zh) : [];
  }, [currentWord]);

  const safeCharIndex = hanziChars.length > 0 ? Math.min(activeCharIndex, hanziChars.length - 1) : 0;
  const targetChar = hanziChars[safeCharIndex] || '';

  const selectWordById = useCallback(
    (id: string) => {
      const idx = wordList.findIndex((w) => w.id === id);
      if (idx !== -1) {
        setCurrentWordIndex(idx);
        setActiveCharIndex(0);
        setStrokes([]);
      }
    },
    [wordList]
  );

  const nextCharOrWord = useCallback(() => {
    setStrokes([]);
    if (safeCharIndex < hanziChars.length - 1) {
      setActiveCharIndex((prev) => prev + 1);
    } else if (wordList.length > 0) {
      setActiveCharIndex(0);
      setCurrentWordIndex((prev) => (prev + 1) % wordList.length);
    }
  }, [safeCharIndex, hanziChars.length, wordList.length]);

  const prevCharOrWord = useCallback(() => {
    setStrokes([]);
    if (safeCharIndex > 0) {
      setActiveCharIndex((prev) => prev - 1);
    } else if (wordList.length > 0) {
      const prevIdx = (safeWordIndex - 1 + wordList.length) % wordList.length;
      const prevWord = wordList[prevIdx];
      const prevChars = prevWord ? extractHanziChars(prevWord.zh) : [];
      setCurrentWordIndex(prevIdx);
      setActiveCharIndex(Math.max(0, prevChars.length - 1));
    }
  }, [safeCharIndex, safeWordIndex, wordList]);

  const nextWord = useCallback(() => {
    if (wordList.length === 0) return;
    setStrokes([]);
    setActiveCharIndex(0);
    setCurrentWordIndex((prev) => (prev + 1) % wordList.length);
  }, [wordList.length]);

  const prevWord = useCallback(() => {
    if (wordList.length === 0) return;
    setStrokes([]);
    setActiveCharIndex(0);
    setCurrentWordIndex((prev) => (prev - 1 + wordList.length) % wordList.length);
  }, [wordList.length]);

  const undoLastStroke = useCallback(() => {
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const clearStrokes = useCallback(() => {
    setStrokes([]);
  }, []);

  const reshuffleWords = useCallback(() => {
    setRandomSeed((s) => s + 1);
  }, []);

  return {
    wordList,
    currentWord,
    currentWordIndex: safeWordIndex,
    hanziChars,
    activeCharIndex: safeCharIndex,
    targetChar,
    showModelChar,
    strokes,
    setStrokes,
    setShowModelChar,
    setActiveCharIndex: (idx: number) => {
      setActiveCharIndex(idx);
      setStrokes([]);
    },
    selectWordById,
    nextCharOrWord,
    prevCharOrWord,
    nextWord,
    prevWord,
    undoLastStroke,
    clearStrokes,
    reshuffleWords
  };
}

// ============================================================================
// 6. HANZI WRITER STROKE GUIDE COMPONENT (WITH OFFLINE/MISSING FALLBACK)
// ============================================================================

declare global {
  interface Window {
    HanziWriter?: any;
  }
}

interface HanziStrokeGuideProps {
  character: string;
  isDark: boolean;
  onNextChar: () => void;
  onQuizComplete?: () => void;
}

const HanziStrokeGuide: React.FC<HanziStrokeGuideProps> = ({
  character,
  isDark,
  onNextChar,
  onQuizComplete
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const writerInstanceRef = useRef<any>(null);
  const [scriptLoaded, setScriptLoaded] = useState<boolean>(() => Boolean(window.HanziWriter));
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(true);
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [quizFeedback, setQuizFeedback] = useState<string>('');

  // Load HanziWriter script from CDN once
  useEffect(() => {
    if (window.HanziWriter) {
      setScriptLoaded(true);
      return;
    }
    const existingScript = document.getElementById('hanzi-writer-cdn');
    if (existingScript) {
      const handleLoad = () => setScriptLoaded(true);
      const handleError = () => setLoadStatus('unavailable');
      existingScript.addEventListener('load', handleLoad);
      existingScript.addEventListener('error', handleError);
      return () => {
        existingScript.removeEventListener('load', handleLoad);
        existingScript.removeEventListener('error', handleError);
      };
    }

    const script = document.createElement('script');
    script.id = 'hanzi-writer-cdn';
    script.src = 'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.2/dist/hanzi-writer.min.js';
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => setLoadStatus('unavailable');
    document.head.appendChild(script);
  }, []);

  // Initialize HanziWriter for current character
  useEffect(() => {
    if (!character) return;
    if (!scriptLoaded || !window.HanziWriter) {
      const timeout = window.setTimeout(() => {
        if (!window.HanziWriter) setLoadStatus('unavailable');
      }, 3500);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    setLoadStatus('loading');
    setIsAnimating(false);
    setIsPaused(false);
    setIsQuizMode(false);
    setQuizFeedback('');

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    try {
      const writer = window.HanziWriter.create(containerRef.current, character, {
        width: 240,
        height: 240,
        padding: 16,
        showOutline: outlineVisible,
        showCharacter: true,
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 220,
        strokeColor: isDark ? '#f8fafc' : '#0f172a',
        radicalColor: '#e11d48',
        outlineColor: isDark ? '#334155' : '#cbd5e1',
        drawingColor: '#e11d48',
        drawingWidth: 18,
        onLoadCharDataSuccess: () => {
          if (!cancelled) {
            setLoadStatus('ready');
          }
        },
        onLoadCharDataError: () => {
          if (!cancelled) {
            setLoadStatus('unavailable');
          }
        }
      });
      writerInstanceRef.current = writer;
    } catch {
      if (!cancelled) setLoadStatus('unavailable');
    }

    return () => {
      cancelled = true;
      writerInstanceRef.current = null;
    };
  }, [character, scriptLoaded, isDark]);

  const handleAnimateStrokes = () => {
    const writer = writerInstanceRef.current;
    if (!writer || loadStatus !== 'ready') return;
    setIsQuizMode(false);
    setQuizFeedback('');
    setIsAnimating(true);
    setIsPaused(false);
    writer.showCharacter();
    writer.animateCharacter({
      onComplete: () => {
        setIsAnimating(false);
        setIsPaused(false);
      }
    });
  };

  const handleTogglePause = () => {
    const writer = writerInstanceRef.current;
    if (!writer || loadStatus !== 'ready') return;
    if (isPaused) {
      writer.resumeAnimation();
      setIsPaused(false);
      setIsAnimating(true);
    } else {
      writer.pauseAnimation();
      setIsPaused(true);
    }
  };

  const handleToggleOutline = () => {
    const writer = writerInstanceRef.current;
    const nextState = !outlineVisible;
    setOutlineVisible(nextState);
    if (!writer || loadStatus !== 'ready') return;
    if (nextState) {
      writer.showOutline();
      if (!isQuizMode) writer.showCharacter();
    } else {
      writer.hideOutline();
      writer.hideCharacter();
    }
  };

  const handleStartInteractiveQuiz = () => {
    const writer = writerInstanceRef.current;
    if (!writer || loadStatus !== 'ready') return;
    setIsAnimating(false);
    setIsPaused(false);
    setIsQuizMode(true);
    setQuizFeedback('Hãy dùng chuột hoặc ngón tay viết theo thứ tự nét trên ô này!');
    writer.quiz({
      onMistake: () => {
        setQuizFeedback('Chưa đúng thứ tự hoặc hướng nét, hãy thử lại nét này nhé!');
      },
      onCorrectStroke: (strokeData: any) => {
        setQuizFeedback(
          `Chính xác! Còn ${strokeData.strokesRemaining} nét nữa.`
        );
      },
      onComplete: (summaryData: any) => {
        setQuizFeedback(
          `Hoàn thành xuất sắc chữ "${character}"! (Sai ${summaryData.totalMistakes} lần)`
        );
        setIsQuizMode(false);
        if (onQuizComplete) onQuizComplete();
      }
    });
  };

  return (
    <div className="flex flex-col items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 sm:p-5">
      <div className="w-full flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Hướng dẫn thứ tự nét
          </span>
        </div>
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            loadStatus === 'ready'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
              : loadStatus === 'loading'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {loadStatus === 'ready'
            ? 'Đã tải dữ liệu nét'
            : loadStatus === 'loading'
            ? 'Đang tải dữ liệu nét...'
            : 'Chế độ chữ mẫu tĩnh'}
        </span>
      </div>

      {/* Tianzige / Mizige Stroke Box */}
      <div className="relative w-[240px] h-[240px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-inner flex items-center justify-center overflow-hidden">
        {/* Background Rice Grid (Mizige) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 240 240"
        >
          <line
            x1="120"
            y1="0"
            x2="120"
            y2="240"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-rose-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="120"
            x2="240"
            y2="120"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-rose-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="0"
            x2="240"
            y2="240"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-rose-100 dark:text-slate-800/70"
            strokeWidth="1"
          />
          <line
            x1="240"
            y1="0"
            x2="0"
            y2="240"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-rose-100 dark:text-slate-800/70"
            strokeWidth="1"
          />
        </svg>

        {/* HanziWriter Target Mount */}
        <div
          ref={containerRef}
          className={`relative z-10 w-[240px] h-[240px] flex items-center justify-center ${
            loadStatus === 'ready' ? 'block' : 'hidden'
          }`}
        />

        {/* Fallback Static Character if HanziWriter data is unavailable/offline */}
        {loadStatus !== 'ready' && (
          <div className="relative z-10 flex flex-col items-center justify-center text-center p-4 select-none">
            {outlineVisible ? (
              <span className="font-hanzi text-[150px] leading-none text-slate-800 dark:text-slate-100">
                {character}
              </span>
            ) : (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Đã ẩn chữ mẫu
              </span>
            )}
          </div>
        )}
      </div>

      {quizFeedback && (
        <p className="mt-2.5 text-xs text-center font-medium text-rose-600 dark:text-rose-400">
          {quizFeedback}
        </p>
      )}

      {loadStatus === 'unavailable' && (
        <p className="mt-2.5 text-xs text-center text-slate-500 dark:text-slate-400 max-w-[260px]">
          Chưa có dữ liệu thứ tự nét động cho chữ này (hoặc đang ngoại tuyến). Bạn vẫn có thể xem chữ mẫu và luyện viết tự do ở ô bên cạnh.
        </p>
      )}

      {/* Stroke Guide Controls */}
      <div className="w-full grid grid-cols-2 gap-2 mt-4">
        <button
          type="button"
          onClick={handleToggleOutline}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
        >
          {outlineVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{outlineVisible ? 'Ẩn chữ mẫu' : 'Xem chữ mẫu'}</span>
        </button>

        <button
          type="button"
          onClick={handleAnimateStrokes}
          disabled={loadStatus !== 'ready'}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white transition"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Phát thứ tự nét</span>
        </button>

        <button
          type="button"
          onClick={handleTogglePause}
          disabled={loadStatus !== 'ready' || (!isAnimating && !isPaused)}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition"
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          <span>{isPaused ? 'Tiếp tục nét' : 'Tạm dừng'}</span>
        </button>

        <button
          type="button"
          onClick={onNextChar}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
        >
          <span>Chữ tiếp theo</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {loadStatus === 'ready' && (
        <button
          type="button"
          onClick={handleStartInteractiveQuiz}
          className={`mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
            isQuizMode
              ? 'bg-amber-500 text-white'
              : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800/60'
          }`}
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>{isQuizMode ? 'Đang bật thử thách viết đúng thứ tự nét' : 'Thử viết theo thứ tự nét (Tương tác)'}</span>
        </button>
      )}
    </div>
  );
};

// ============================================================================
// 7. FREEHAND WRITING PAD COMPONENT (MOUSE & TOUCH SUPPORT ON MIZIGE GRID)
// ============================================================================

interface FreehandWritingPadProps {
  character: string;
  showModelChar: boolean;
  strokes: Point[][];
  isDark: boolean;
  onChangeStrokes: React.Dispatch<React.SetStateAction<Point[][]>>;
  onUndo: () => void;
  onClear: () => void;
  onToggleModel: () => void;
  onNextChar: () => void;
  onFirstStrokeCompleted?: () => void;
}

const FreehandWritingPad: React.FC<FreehandWritingPadProps> = ({
  character,
  showModelChar,
  strokes,
  isDark,
  onChangeStrokes,
  onUndo,
  onClear,
  onToggleModel,
  onNextChar,
  onFirstStrokeCompleted
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Point[]>([]);
  const [brushSize, setBrushSize] = useState<number>(10);

  // Redraw strokes whenever strokes, brushSize, or theme updates
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.lineWidth = brushSize;

    const allStrokes = isDrawingRef.current
      ? [...strokes, currentStrokeRef.current]
      : strokes;

    for (const stroke of allStrokes) {
      if (!stroke || stroke.length === 0) continue;
      ctx.beginPath();
      if (stroke.length === 1) {
        ctx.arc(stroke[0].x, stroke[0].y, brushSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.fill();
      } else {
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i++) {
          const midX = (stroke[i - 1].x + stroke[i].x) / 2;
          const midY = (stroke[i - 1].y + stroke[i].y) / 2;
          ctx.quadraticCurveTo(stroke[i - 1].x, stroke[i - 1].y, midX, midY);
        }
        const last = stroke[stroke.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    }
  }, [strokes, brushSize, isDark]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const getPointerCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = getPointerCoords(e);
    currentStrokeRef.current = [pt];
    renderCanvas();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pt = getPointerCoords(e);
    currentStrokeRef.current.push(pt);
    renderCanvas();
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    const finishedStroke = [...currentStrokeRef.current];
    currentStrokeRef.current = [];
    if (finishedStroke.length > 0) {
      const wasEmpty = strokes.length === 0;
      onChangeStrokes((prev) => [...prev, finishedStroke]);
      if (wasEmpty && onFirstStrokeCompleted) {
        onFirstStrokeCompleted();
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 sm:p-5">
      <div className="w-full flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PenTool className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Ô luyện viết tự do ({strokes.length} nét)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">Nét bút:</span>
          {[7, 10, 14].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setBrushSize(size)}
              className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-medium border transition ${
                brushSize === size
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-500'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
              title={`Cỡ bút ${size}px`}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: size / 2 + 2, height: size / 2 + 2 }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Practice Square Box (240x240 logical, 300x300 high-DPI canvas) */}
      <div className="relative w-[240px] h-[240px] rounded-xl border-2 border-emerald-600/50 dark:border-emerald-500/50 bg-white dark:bg-slate-950 shadow-inner flex items-center justify-center overflow-hidden select-none">
        {/* Traditional Mizige Rice Grid Lines */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 240 240"
        >
          <rect
            x="4"
            y="4"
            width="232"
            height="232"
            fill="none"
            stroke="currentColor"
            className="text-emerald-200/80 dark:text-slate-800"
            strokeWidth="1"
          />
          <line
            x1="120"
            y1="0"
            x2="120"
            y2="240"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-emerald-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="120"
            x2="240"
            y2="120"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-emerald-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="0"
            x2="240"
            y2="240"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-emerald-100 dark:text-slate-800/70"
            strokeWidth="1"
          />
          <line
            x1="240"
            y1="0"
            x2="0"
            y2="240"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-emerald-100 dark:text-slate-800/70"
            strokeWidth="1"
          />
        </svg>

        {/* Faint Model Character Watermark */}
        {showModelChar && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span className="font-hanzi text-[168px] leading-none text-slate-200/85 dark:text-slate-800/85">
              {character}
            </span>
          </div>
        )}

        {/* Interactive Drawing Canvas */}
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          className="relative z-10 w-[240px] h-[240px] cursor-crosshair touch-none"
        />
      </div>

      <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 text-center">
        Dùng chuột hoặc màn hình cảm ứng viết trực tiếp vào ô vuông.
      </p>

      {/* Action Buttons matching Section 4.1 */}
      <div className="w-full grid grid-cols-2 gap-2 mt-4">
        <button
          type="button"
          onClick={onUndo}
          disabled={strokes.length === 0}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Xóa nét đã viết</span>
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={strokes.length === 0}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Viết lại</span>
        </button>

        <button
          type="button"
          onClick={onToggleModel}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
        >
          {showModelChar ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{showModelChar ? 'Ẩn chữ mẫu' : 'Hiển thị chữ mẫu'}</span>
        </button>

        <button
          type="button"
          onClick={onNextChar}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition"
        >
          <span>Chữ tiếp theo</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 7B. FULL-WORD MIZIGE WRITING STUDIO (GỌN GÀNG, KIỂM TRA ĐÚNG/SAI, MOBILE-FIRST)
// ============================================================================

export interface CellEvaluation {
  passed: boolean;
  score: number;
  strokeCount: number;
  feedback: string;
}

/**
 * Evaluates a user's handwritten strokes in a 260x260 logical canvas against the target Hanzi character.
 * Uses offscreen canvas rasterization with generous dilation tolerance so natural handwriting is scored fairly.
 */
function evaluateHandwrittenCharacter(
  character: string,
  strokes: Point[][],
  canvasSize = 260
): CellEvaluation {
  if (!strokes || strokes.length === 0) {
    return {
      passed: false,
      score: 0,
      strokeCount: 0,
      feedback: 'Chưa viết'
    };
  }

  // Calculate total path length
  let totalLength = 0;
  for (const st of strokes) {
    for (let i = 1; i < st.length; i++) {
      const dx = st[i].x - st[i - 1].x;
      const dy = st[i].y - st[i - 1].y;
      totalLength += Math.hypot(dx, dy);
    }
  }

  if (totalLength < 35) {
    return {
      passed: false,
      score: 10,
      strokeCount: strokes.length,
      feedback: 'Nét quá ngắn'
    };
  }

  try {
    const grid = 120;
    const scale = grid / canvasSize;

    // 1. Render target reference character with generous stroke width (tolerance mask)
    const refCanvas = document.createElement('canvas');
    refCanvas.width = grid;
    refCanvas.height = grid;
    const refCtx = refCanvas.getContext('2d');

    // 2. Render user strokes
    const userCanvas = document.createElement('canvas');
    userCanvas.width = grid;
    userCanvas.height = grid;
    const userCtx = userCanvas.getContext('2d');

    if (!refCtx || !userCtx) {
      return {
        passed: strokes.length >= 2,
        score: 75,
        strokeCount: strokes.length,
        feedback: 'Đã viết'
      };
    }

    // Draw reference character (dilated tolerance region + core region)
    refCtx.clearRect(0, 0, grid, grid);
    refCtx.fillStyle = '#000000';
    refCtx.strokeStyle = '#000000';
    refCtx.lineWidth = 14;
    refCtx.lineJoin = 'round';
    refCtx.lineCap = 'round';
    refCtx.font = `bold ${Math.round(grid * 0.72)}px "Noto Serif SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", serif`;
    refCtx.textAlign = 'center';
    refCtx.textBaseline = 'middle';
    refCtx.strokeText(character, grid / 2, grid / 2 + 2);
    refCtx.fillText(character, grid / 2, grid / 2 + 2);

    // Draw user strokes
    userCtx.clearRect(0, 0, grid, grid);
    userCtx.strokeStyle = '#000000';
    userCtx.fillStyle = '#000000';
    userCtx.lineWidth = 10;
    userCtx.lineCap = 'round';
    userCtx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (!stroke || stroke.length === 0) continue;
      userCtx.beginPath();
      if (stroke.length === 1) {
        userCtx.arc(stroke[0].x * scale, stroke[0].y * scale, 5, 0, Math.PI * 2);
        userCtx.fill();
      } else {
        userCtx.moveTo(stroke[0].x * scale, stroke[0].y * scale);
        for (let i = 1; i < stroke.length; i++) {
          userCtx.lineTo(stroke[i].x * scale, stroke[i].y * scale);
        }
        userCtx.stroke();
      }
    }

    const refData = refCtx.getImageData(0, 0, grid, grid).data;
    const userData = userCtx.getImageData(0, 0, grid, grid).data;

    let refPixels = 0;
    let userPixels = 0;
    let overlapPixels = 0;

    for (let i = 3; i < refData.length; i += 4) {
      const rOn = refData[i] > 30;
      const uOn = userData[i] > 30;
      if (rOn) refPixels++;
      if (uOn) userPixels++;
      if (rOn && uOn) overlapPixels++;
    }

    if (userPixels === 0 || refPixels === 0) {
      return {
        passed: false,
        score: 0,
        strokeCount: strokes.length,
        feedback: 'Chưa viết'
      };
    }

    // Precision: how much of user's ink lands inside the dilated reference glyph
    const precision = overlapPixels / userPixels;
    // Recall: how much of the dilated reference glyph is covered by user's dilated ink
    const recall = overlapPixels / (refPixels * 0.48);
    const clampedRecall = Math.min(1, recall);

    const combinedScore = Math.round((precision * 0.58 + clampedRecall * 0.42) * 100);
    const passed = combinedScore >= 42 && precision >= 0.35 && strokes.length >= 1;

    return {
      passed,
      score: Math.min(100, combinedScore),
      strokeCount: strokes.length,
      feedback: passed ? `Đúng (${Math.min(100, combinedScore)}%)` : `Cần chỉnh (${combinedScore}%)`
    };
  } catch {
    return {
      passed: strokes.length >= 2,
      score: 75,
      strokeCount: strokes.length,
      feedback: 'Đã viết'
    };
  }
}

interface SingleMizigeCellProps {
  charIndex: number;
  totalChars: number;
  character: string;
  showModelChar: boolean;
  evaluation?: CellEvaluation | null;
  strokes: Point[][];
  brushSize: number;
  isDark: boolean;
  isActive: boolean;
  onSelectCell: () => void;
  onAddStroke: (stroke: Point[]) => void;
  onUndoCellStroke: () => void;
  onClearCell: () => void;
  onToggleCellModel: () => void;
}

const SingleMizigeCell: React.FC<SingleMizigeCellProps> = ({
  charIndex,
  totalChars,
  character,
  showModelChar,
  evaluation,
  strokes,
  brushSize,
  isDark,
  isActive,
  onSelectCell,
  onAddStroke,
  onUndoCellStroke,
  onClearCell,
  onToggleCellModel
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Point[]>([]);

  const renderCellCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = evaluation
      ? evaluation.passed
        ? '#10b981'
        : '#f43f5e'
      : isDark
      ? '#f8fafc'
      : '#0f172a';
    ctx.lineWidth = brushSize;

    const allStrokes = isDrawingRef.current
      ? [...strokes, currentStrokeRef.current]
      : strokes;

    for (const stroke of allStrokes) {
      if (!stroke || stroke.length === 0) continue;
      ctx.beginPath();
      if (stroke.length === 1) {
        ctx.arc(stroke[0].x, stroke[0].y, brushSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i++) {
          const midX = (stroke[i - 1].x + stroke[i].x) / 2;
          const midY = (stroke[i - 1].y + stroke[i].y) / 2;
          ctx.quadraticCurveTo(stroke[i - 1].x, stroke[i - 1].y, midX, midY);
        }
        const last = stroke[stroke.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    }
  }, [strokes, brushSize, isDark, evaluation]);

  useEffect(() => {
    renderCellCanvas();
  }, [renderCellCanvas]);

  const getPointerCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onSelectCell();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    currentStrokeRef.current = [getPointerCoords(e)];
    renderCellCanvas();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    currentStrokeRef.current.push(getPointerCoords(e));
    renderCellCanvas();
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    const finished = [...currentStrokeRef.current];
    currentStrokeRef.current = [];
    if (finished.length > 0) {
      onAddStroke(finished);
    }
  };

  // Adaptive box dimensions so 1, 2, 3, or 4 boxes fit every mobile screen size cleanly
  const sizeClasses =
    totalChars === 1
      ? 'w-[185px] h-[185px] sm:w-[210px] sm:h-[210px]'
      : totalChars === 2
      ? 'w-[140px] h-[140px] sm:w-[185px] sm:h-[185px]'
      : 'w-[134px] h-[134px] sm:w-[168px] sm:h-[168px]';

  const watermarkFontSize =
    totalChars === 1
      ? 'text-[138px] sm:text-[156px]'
      : totalChars === 2
      ? 'text-[104px] sm:text-[138px]'
      : 'text-[98px] sm:text-[124px]';

  const borderStyle = evaluation
    ? evaluation.passed
      ? 'border-emerald-500 ring-2 ring-emerald-500/30'
      : 'border-rose-500 ring-2 ring-rose-500/30'
    : isActive
    ? 'border-emerald-600 dark:border-emerald-400 ring-2 ring-emerald-500/20'
    : 'border-slate-300 dark:border-slate-700';

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Mizige Square Box */}
      <div
        className={`relative ${sizeClasses} rounded-xl border-2 bg-white dark:bg-slate-950 shadow-inner flex items-center justify-center overflow-hidden select-none transition ${borderStyle}`}
      >
        {/* Evaluation Badge in Top-Left Corner */}
        {evaluation && (
          <span
            className={`absolute top-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm ${
              evaluation.passed
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            {evaluation.passed ? '✓ Đúng' : '✗ Sai'}
          </span>
        )}

        {/* Traditional Mizige Rice Grid SVG */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 200 200"
        >
          <rect
            x="3"
            y="3"
            width="194"
            height="194"
            fill="none"
            stroke="currentColor"
            className="text-slate-200/80 dark:text-slate-800"
            strokeWidth="1"
          />
          <line
            x1="100"
            y1="0"
            x2="100"
            y2="200"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="100"
            x2="200"
            y2="100"
            stroke="currentColor"
            strokeDasharray="5,5"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="0"
            x2="200"
            y2="200"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-slate-200/70 dark:text-slate-800/70"
            strokeWidth="1"
          />
          <line
            x1="200"
            y1="0"
            x2="0"
            y2="200"
            stroke="currentColor"
            strokeDasharray="4,6"
            className="text-slate-200/70 dark:text-slate-800/70"
            strokeWidth="1"
          />
        </svg>

        {/* Faint Model Character Watermark (Visible when showModelChar or after Check) */}
        {(showModelChar || Boolean(evaluation)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span
              className={`font-hanzi ${watermarkFontSize} leading-none ${
                evaluation
                  ? 'text-slate-300/75 dark:text-slate-700/75'
                  : 'text-slate-200/90 dark:text-slate-800/90'
              }`}
            >
              {character}
            </span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={260}
          height={260}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          className="relative z-10 w-full h-full cursor-crosshair touch-none"
        />
      </div>

      {/* 3 Compact Per-Box Buttons matching reference screenshot: Xóa ô i | ↪ Nét | 👁 Mẫu */}
      <div className="flex items-center justify-center gap-1 w-full">
        <button
          type="button"
          onClick={onClearCell}
          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 transition"
          title="Xóa ô"
        >
          Xóa ô {charIndex + 1}
        </button>

        <button
          type="button"
          onClick={onUndoCellStroke}
          disabled={strokes.length === 0}
          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition flex items-center gap-0.5"
          title="Xóa 1 nét vừa viết trong ô này"
        >
          <Undo2 className="w-3 h-3 text-blue-500" />
          <span>Nét</span>
        </button>

        <button
          type="button"
          onClick={onToggleCellModel}
          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition flex items-center gap-0.5 ${
            showModelChar
              ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
          }`}
          title="Hiện/Ẩn chữ mẫu mờ của ô này"
        >
          <Eye className="w-3 h-3" />
          <span>Mẫu</span>
        </button>
      </div>
    </div>
  );
};

interface FullWordMizigePadProps {
  word: VocabularyItem;
  wordIndex: number;
  totalWords: number;
  characters: string[];
  showHanzi: boolean;
  showPinyin: boolean;
  isDark: boolean;
  activeCharIndex: number;
  memoryStatus: MemoryStatus;
  showSingleCharDetail: boolean;
  onSelectCharIndex: (idx: number) => void;
  onToggleHanzi: () => void;
  onTogglePinyin: () => void;
  onToggleSingleCharDetail: () => void;
  onMarkMemory: (status: MemoryStatus) => void;
  onPrevWord: () => void;
  onNextWord: () => void;
  onFirstStrokeCompleted?: () => void;
}

const FullWordMizigePad: React.FC<FullWordMizigePadProps> = ({
  word,
  wordIndex,
  totalWords,
  characters,
  showHanzi,
  showPinyin,
  isDark,
  activeCharIndex,
  memoryStatus,
  showSingleCharDetail,
  onSelectCharIndex,
  onToggleHanzi,
  onTogglePinyin,
  onToggleSingleCharDetail,
  onMarkMemory,
  onPrevWord,
  onNextWord,
  onFirstStrokeCompleted
}) => {
  const [wordStrokes, setWordStrokes] = useState<Record<number, Point[][]>>({});
  const [strokeHistory, setStrokeHistory] = useState<number[]>([]);
  const [cellModelVisible, setCellModelVisible] = useState<Record<number, boolean>>({});
  const [allModelsVisible, setAllModelsVisible] = useState<boolean>(false);
  const [evaluations, setEvaluations] = useState<Record<number, CellEvaluation> | null>(null);
  const [brushSize, setBrushSize] = useState<number>(10);

  // Reset all character boxes and check states when word changes
  useEffect(() => {
    setWordStrokes({});
    setStrokeHistory([]);
    setCellModelVisible({});
    setAllModelsVisible(false);
    setEvaluations(null);
  }, [word.id]);

  const totalStrokesCount = strokeHistory.length;

  const handleAddStrokeToCell = (cellIdx: number, stroke: Point[]) => {
    const wasEmpty = strokeHistory.length === 0;
    // Clear previous evaluation when user continues writing
    if (evaluations) setEvaluations(null);
    setWordStrokes((prev) => {
      const cellList = prev[cellIdx] || [];
      return {
        ...prev,
        [cellIdx]: [...cellList, stroke]
      };
    });
    setStrokeHistory((prev) => [...prev, cellIdx]);
    if (wasEmpty && onFirstStrokeCompleted) {
      onFirstStrokeCompleted();
    }
  };

  const handleUndoCellStroke = (cellIdx: number) => {
    setEvaluations(null);
    setWordStrokes((prev) => {
      const cellList = prev[cellIdx] || [];
      if (cellList.length === 0) return prev;
      return {
        ...prev,
        [cellIdx]: cellList.slice(0, -1)
      };
    });
    setStrokeHistory((prev) => {
      const lastPos = prev.lastIndexOf(cellIdx);
      if (lastPos === -1) return prev;
      return [...prev.slice(0, lastPos), ...prev.slice(lastPos + 1)];
    });
  };

  const handleUndoLastWordStroke = () => {
    if (strokeHistory.length === 0) return;
    const lastCellIdx = strokeHistory[strokeHistory.length - 1];
    handleUndoCellStroke(lastCellIdx);
  };

  const handleClearWholeWord = () => {
    setWordStrokes({});
    setStrokeHistory([]);
    setEvaluations(null);
  };

  const handleClearSingleCell = (cellIdx: number) => {
    setEvaluations((prev) => {
      if (!prev) return null;
      const copy = { ...prev };
      delete copy[cellIdx];
      return Object.keys(copy).length > 0 ? copy : null;
    });
    setWordStrokes((prev) => ({
      ...prev,
      [cellIdx]: []
    }));
    setStrokeHistory((prev) => prev.filter((idx) => idx !== cellIdx));
  };

  const handleToggleAllModels = () => {
    const nextVal = !allModelsVisible;
    setAllModelsVisible(nextVal);
    const updated: Record<number, boolean> = {};
    characters.forEach((_, idx) => {
      updated[idx] = nextVal;
    });
    setCellModelVisible(updated);
  };

  const handleCheckWord = () => {
    const results: Record<number, CellEvaluation> = {};
    let passedCount = 0;
    characters.forEach((ch, idx) => {
      const res = evaluateHandwrittenCharacter(ch, wordStrokes[idx] || []);
      results[idx] = res;
      if (res.passed) passedCount++;
    });
    setEvaluations(results);

    // Auto-grade into Đã nhớ (remembered) if all characters pass, or Chưa thuộc (needs_review) if any fails
    if (passedCount === characters.length && characters.length > 0) {
      onMarkMemory('remembered');
    } else {
      onMarkMemory('needs_review');
    }
  };

  const passedCellsCount = evaluations
    ? Object.values(evaluations).filter((e) => e.passed).length
    : 0;
  const allCellsPassed =
    evaluations !== null && passedCellsCount === characters.length && characters.length > 0;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-6 shadow-sm space-y-4">
      {/* Top Status & Hint Line */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700 dark:text-slate-200">
            Từ {wordIndex + 1} / {totalWords}
          </span>
          {memoryStatus === 'remembered' && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              ✓ Đã nhớ
            </span>
          )}
          {memoryStatus === 'needs_review' && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
              📌 Chưa thuộc
            </span>
          )}
        </div>
        <span className="text-[11px] sm:text-xs text-slate-400">
          Mẹo: Bấm “👁 Mẫu” dưới mỗi ô nếu quên nét chữ
        </span>
      </div>

      {/* Centered Prompt Title (Only Vietnamese meaning shown by default!) */}
      <div className="text-center space-y-2 py-1">
        <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white leading-snug px-2">
          <span className="text-slate-500 dark:text-slate-400 font-semibold text-sm sm:text-lg mr-1.5">
            [Bài {word.lessonNumber} • {word.wordType}]
          </span>
          Viết: <span className="text-emerald-600 dark:text-emerald-400">“{word.vi}”</span>
        </h2>

        {/* Optional Revealed Pinyin & Hanzi Badges */}
        {(showPinyin || showHanzi || evaluations !== null) && (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {(showHanzi || evaluations !== null) && (
              <span className="px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 font-hanzi text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                {word.zh}
              </span>
            )}
            {(showPinyin || evaluations !== null) && (
              <span className="px-3 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-sm sm:text-base font-bold text-rose-600 dark:text-rose-300">
                {word.pinyin} • Hán Việt: {word.hanViet}
              </span>
            )}
          </div>
        )}

        {/* Compact Utility Pills Bar (Matching reference layout) */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 pt-1">
          <button
            type="button"
            onClick={() => speakChinese(word.zh)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <Volume2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Nghe phát âm</span>
          </button>

          <button
            type="button"
            onClick={onTogglePinyin}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              showPinyin
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
            }`}
          >
            {showPinyin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPinyin ? 'Ẩn Pinyin' : 'Gợi ý Pinyin'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleHanzi}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              showHanzi
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
            }`}
          >
            {showHanzi ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showHanzi ? 'Ẩn chữ Hán' : 'Hiện chữ Hán'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleAllModels}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              allModelsVisible
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
            }`}
          >
            <PenTool className="w-3.5 h-3.5 text-amber-500" />
            <span>Hiện/Ẩn chữ mờ mẫu</span>
          </button>

          <button
            type="button"
            onClick={onToggleSingleCharDetail}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              showSingleCharDetail
                ? 'border-purple-600 bg-purple-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>{showSingleCharDetail ? 'Đóng thứ tự nét' : 'Xem thứ tự nét'}</span>
          </button>
        </div>
      </div>

      {/* Multi-Box Mizige Grid Row (Fits 1, 2, 3, or 4 chars cleanly on both phone and desktop) */}
      <div
        className={`${
          characters.length >= 3
            ? 'grid grid-cols-2 sm:flex sm:flex-wrap justify-items-center justify-center'
            : 'flex flex-wrap items-center justify-center'
        } gap-2.5 sm:gap-4 py-3 px-2 sm:px-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800`}
      >
        {characters.map((ch, idx) => (
          <SingleMizigeCell
            key={`${word.id}_cell_${idx}`}
            charIndex={idx}
            totalChars={characters.length}
            character={ch}
            showModelChar={showHanzi || Boolean(cellModelVisible[idx])}
            evaluation={evaluations ? evaluations[idx] : null}
            strokes={wordStrokes[idx] || []}
            brushSize={brushSize}
            isDark={isDark}
            isActive={activeCharIndex === idx}
            onSelectCell={() => onSelectCharIndex(idx)}
            onAddStroke={(st) => handleAddStrokeToCell(idx, st)}
            onUndoCellStroke={() => handleUndoCellStroke(idx)}
            onClearCell={() => handleClearSingleCell(idx)}
            onToggleCellModel={() =>
              setCellModelVisible((prev) => ({ ...prev, [idx]: !prev[idx] }))
            }
          />
        ))}
      </div>

      {/* Check Evaluation Feedback & Manual Đã nhớ / Chưa thuộc Buttons */}
      {evaluations && (
        <div
          className={`rounded-2xl p-3.5 sm:p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            allCellsPassed
              ? 'bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50/90 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
              {allCellsPassed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>
                {allCellsPassed
                  ? `Chính xác! Đạt ${passedCellsCount}/${characters.length} ô chữ — Đã lưu vào "Đã nhớ"`
                  : `Kết quả: Đạt ${passedCellsCount}/${characters.length} ô chữ — Đã đưa vào "Chưa thuộc"`}
              </span>
            </div>
            <p className="text-xs sm:text-sm opacity-90">
              Đáp án chuẩn: <strong className="font-hanzi text-base">{word.zh}</strong> ({word.pinyin} • {word.hanViet}) — {word.vi}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onMarkMemory('remembered')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition ${
                memoryStatus === 'remembered'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-300'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>Đúng (Đã nhớ)</span>
            </button>
            <button
              type="button"
              onClick={() => onMarkMemory('needs_review')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition ${
                memoryStatus === 'needs_review'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border border-rose-300'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              <span>Sai (Chưa thuộc)</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 Primary Action Buttons matching reference image: Xóa hết | Kiểm tra | Tiếp theo -> */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 pt-1">
        <button
          type="button"
          onClick={handleClearWholeWord}
          className="py-2.5 sm:py-3 px-3 rounded-xl font-bold text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Xóa hết</span>
        </button>

        <button
          type="button"
          onClick={handleCheckWord}
          className="py-2.5 sm:py-3 px-3 rounded-xl font-bold text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Kiểm tra</span>
        </button>

        <button
          type="button"
          onClick={onNextWord}
          className="py-2.5 sm:py-3 px-3 rounded-xl font-bold text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition flex items-center justify-center gap-1.5"
        >
          <span>Tiếp theo</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Memory Tagging & Secondary Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onPrevWord}
            className="px-2.5 py-1.5 rounded-lg font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Từ trước</span>
          </button>
          <button
            type="button"
            onClick={handleUndoLastWordStroke}
            disabled={totalStrokesCount === 0}
            className="px-2.5 py-1.5 rounded-lg font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Xóa nét vừa viết</span>
          </button>
          <button
            type="button"
            onClick={handleClearWholeWord}
            disabled={totalStrokesCount === 0}
            className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 disabled:opacity-40 items-center gap-1"
          >
            <span>Viết lại cả từ</span>
          </button>
          <button
            type="button"
            onClick={onNextWord}
            className="hidden"
          >
            <span>Từ tiếp theo</span>
          </button>
        </div>

        {/* Direct Đã nhớ / Chưa thuộc buttons */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 hidden sm:inline">Đánh dấu nhanh:</span>
          <button
            type="button"
            onClick={() => onMarkMemory('remembered')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition ${
              memoryStatus === 'remembered'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>Đã nhớ</span>
          </button>
          <button
            type="button"
            onClick={() => onMarkMemory('needs_review')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition ${
              memoryStatus === 'needs_review'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Chưa thuộc</span>
          </button>
        </div>
      </div>

      {/* Hidden compatibility controls for Brush Size */}
      <div className="hidden">
        {[7, 10, 14].map((sz) => (
          <button key={sz} type="button" onClick={() => setBrushSize(sz)}>
            {sz}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 8. MAIN APPLICATION COMPONENT (HSK5 BY QUYKY)
// ============================================================================

type ActiveTab = 'dashboard' | 'lesson' | 'flashcard' | 'writing';

export default function App() {
  // Theme state (Light / Dark)
  const [isDark, setIsDark] = useState<boolean>(() =>
    loadFromStorage<boolean>(STORAGE_KEY_THEME, false)
  );

  useEffect(() => {
    saveToStorage(STORAGE_KEY_THEME, isDark);
  }, [isDark]);

  // Dataset state (initialized from hsk5.json + supports importing additional lessons via JSON)
  const [dataset, setDataset] = useState<HSK5Dataset>(() =>
    loadFromStorage<HSK5Dataset>(STORAGE_KEY_CUSTOM_DATA, INITIAL_HSK5_DATA)
  );

  const lessons = useMemo(() => normalizeDataset(dataset), [dataset]);

  // User Learning Progress
  const {
    progress,
    setVocabMemory,
    setGrammarMemory,
    recordWritingPractice,
    toggleWritingMastered,
    setLastActiveLesson,
    resetAllProgress
  } = useLearningProgress();

  // Navigation State
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedLessonKey, setSelectedLessonKey] = useState<string>(
    () => progress.lastActiveLessonKey || (lessons[0]?.key ?? 'bai1')
  );

  // Lesson Detail Sub-state
  const [lessonSubTab, setLessonSubTab] = useState<'all' | 'vocabulary' | 'grammar'>('all');
  const [vocabSearch, setVocabSearch] = useState('');
  const [vocabTypeFilter, setVocabTypeFilter] = useState('all');
  const [vocabStatusFilter, setVocabStatusFilter] = useState<'all' | MemoryStatus>('all');

  // Flashcard Sub-state
  const [flashcardLessonScope, setFlashcardLessonScope] = useState<string>('bai1');
  const [flashcardType, setFlashcardType] = useState<FlashcardType>('vocabulary');
  const [flashcardMode, setFlashcardMode] = useState<FlashcardStudyMode>('sequential');
  const [flashcardTargetId, setFlashcardTargetId] = useState<string | null>(null);

  // Writing Sub-state (Default: only show Vietnamese meaning; Pinyin & Hanzi hidden by default and toggleable)
  const [writingLessonScope, setWritingLessonScope] = useState<string>('bai1');
  const [writingMode, setWritingMode] = useState<WritingPracticeMode>('all_lesson');
  const [writingTargetId, setWritingTargetId] = useState<string | null>(null);
  const [writingSearchQuery, setWritingSearchQuery] = useState('');
  const [showWritingPinyin, setShowWritingPinyin] = useState<boolean>(false);
  const [showWritingHanzi, setShowWritingHanzi] = useState<boolean>(false);
  const [showSingleCharDetail, setShowSingleCharDetail] = useState<boolean>(false);

  // Modals & Toasts
  const [showResetModal, setShowResetModal] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [jsonInputText, setJsonInputText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 3200);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  // Aggregate Global Statistics dynamically from JSON lessons & user progress
  const globalStats = useMemo(() => {
    const allVocab = lessons.flatMap((l) => l.vocabulary);
    const allGrammar = lessons.flatMap((l) => l.grammar);

    let vocabRemembered = 0;
    let vocabNeedsReview = 0;
    let vocabUnlearned = 0;
    let writingPracticedCount = 0;

    for (const v of allVocab) {
      const st = progress.vocabStatus[v.id] || 'unlearned';
      if (st === 'remembered') vocabRemembered++;
      else if (st === 'needs_review') vocabNeedsReview++;
      else vocabUnlearned++;

      if (progress.writingProgress[v.id]?.mastered || (progress.writingProgress[v.id]?.practicedCount ?? 0) > 0) {
        writingPracticedCount++;
      }
    }

    let grammarRemembered = 0;
    let grammarNeedsReview = 0;
    for (const g of allGrammar) {
      const st = progress.grammarStatus[g.id] || 'unlearned';
      if (st === 'remembered') grammarRemembered++;
      else if (st === 'needs_review') grammarNeedsReview++;
    }

    const totalVocab = allVocab.length;
    const totalGrammar = allGrammar.length;
    const vocabLearnedTotal = vocabRemembered + vocabNeedsReview;
    const overallCompletionPct =
      totalVocab > 0 ? Math.round((vocabRemembered / totalVocab) * 100) : 0;

    return {
      totalLessons: lessons.length,
      totalVocab,
      totalGrammar,
      vocabLearnedTotal,
      vocabRemembered,
      vocabNeedsReview,
      vocabUnlearned,
      grammarRemembered,
      grammarNeedsReview,
      writingPracticedCount,
      overallCompletionPct
    };
  }, [lessons, progress]);

  // Active Lesson Object for Lesson Detail View
  const currentLesson = useMemo(() => {
    return lessons.find((l) => l.key === selectedLessonKey) || lessons[0] || null;
  }, [lessons, selectedLessonKey]);

  // Instantiate Flashcard Engine
  const flashcardEngine = useFlashcardEngine({
    lessons,
    selectedLessonKey: flashcardLessonScope,
    cardType: flashcardType,
    studyMode: flashcardMode,
    vocabStatus: progress.vocabStatus,
    grammarStatus: progress.grammarStatus,
    initialTargetId: flashcardTargetId
  });

  // Instantiate Writing Engine
  const writingEngine = useWritingEngine({
    lessons,
    selectedLessonKey: writingLessonScope,
    practiceMode: writingMode,
    vocabStatus: progress.vocabStatus,
    initialVocabId: writingTargetId
  });

  // Navigation Helpers
  const openLesson = (lessonKey: string) => {
    setSelectedLessonKey(lessonKey);
    setLastActiveLesson(lessonKey);
    setActiveTab('lesson');
  };

  const openFlashcardForLesson = (
    lessonKey: string,
    type: FlashcardType = 'vocabulary',
    mode: FlashcardStudyMode = 'sequential',
    targetId: string | null = null
  ) => {
    setFlashcardLessonScope(lessonKey);
    setFlashcardType(type);
    setFlashcardMode(mode);
    setFlashcardTargetId(targetId);
    setActiveTab('flashcard');
  };

  const openWritingForWord = (
    lessonKey: string,
    vocabId: string | null = null,
    mode: WritingPracticeMode = 'all_lesson'
  ) => {
    setWritingLessonScope(lessonKey);
    setWritingMode(mode);
    setWritingTargetId(vocabId);
    setActiveTab('writing');
  };

  // Keyboard navigation in Flashcard tab
  useEffect(() => {
    if (activeTab !== 'flashcard') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        flashcardEngine.flipCard();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        flashcardEngine.nextCard();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        flashcardEngine.prevCard();
      } else if (e.key === '1' && flashcardEngine.currentCard) {
        e.preventDefault();
        const id = flashcardEngine.currentCard.id;
        if (flashcardType === 'vocabulary') setVocabMemory(id, 'needs_review');
        else setGrammarMemory(id, 'needs_review');
        triggerToast('Đã đánh dấu: Chưa nhớ (Cần ôn tập)');
        flashcardEngine.nextCard();
      } else if (e.key === '2' && flashcardEngine.currentCard) {
        e.preventDefault();
        const id = flashcardEngine.currentCard.id;
        if (flashcardType === 'vocabulary') setVocabMemory(id, 'remembered');
        else setGrammarMemory(id, 'remembered');
        triggerToast('Đã đánh dấu: Đã nhớ!');
        flashcardEngine.nextCard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, flashcardEngine, flashcardType, setVocabMemory, setGrammarMemory, triggerToast]);

  // Handle Dynamic JSON Update (Section 7 extensibility)
  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(jsonInputText);
      if (!parsed || typeof parsed !== 'object' || !parsed.translation) {
        triggerToast('Lỗi: JSON phải có khóa gốc "translation" chứa các bài học.');
        return;
      }
      const normalized = normalizeDataset(parsed);
      if (normalized.length === 0) {
        triggerToast('Lỗi: Không tìm thấy bài học hợp lệ trong dữ liệu JSON.');
        return;
      }
      setDataset(parsed);
      saveToStorage(STORAGE_KEY_CUSTOM_DATA, parsed);
      setShowJsonModal(false);
      triggerToast(`Đã cập nhật thành công ${normalized.length} bài học từ JSON!`);
    } catch {
      triggerToast('Lỗi cú pháp JSON. Vui lòng kiểm tra lại định dạng.');
    }
  };

  const handleRestoreDefaultJson = () => {
    setDataset(INITIAL_HSK5_DATA);
    saveToStorage(STORAGE_KEY_CUSTOM_DATA, INITIAL_HSK5_DATA);
    setShowJsonModal(false);
    triggerToast('Đã khôi phục dữ liệu 3 bài học gốc từ hsk5.json.');
  };

  // Filtered vocabulary for Lesson Detail view
  const filteredLessonVocab = useMemo(() => {
    if (!currentLesson) return [];
    const q = normalizeSearchText(vocabSearch);
    return currentLesson.vocabulary.filter((item) => {
      if (vocabTypeFilter !== 'all' && item.wordType !== vocabTypeFilter) {
        return false;
      }
      const st = progress.vocabStatus[item.id] || 'unlearned';
      if (vocabStatusFilter !== 'all' && st !== vocabStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.zh.toLowerCase().includes(q) ||
        normalizeSearchText(item.pinyin).includes(q) ||
        normalizeSearchText(item.hanViet).includes(q) ||
        normalizeSearchText(item.vi).includes(q)
      );
    });
  }, [currentLesson, vocabSearch, vocabTypeFilter, vocabStatusFilter, progress.vocabStatus]);

  const availableWordTypes = useMemo(() => {
    if (!currentLesson) return [];
    return Array.from(new Set(currentLesson.vocabulary.map((v) => v.wordType).filter(Boolean)));
  }, [currentLesson]);

  // Filtered sidebar word list for Writing View
  const filteredWritingWords = useMemo(() => {
    const q = normalizeSearchText(writingSearchQuery);
    if (!q) return writingEngine.wordList;
    return writingEngine.wordList.filter(
      (w) =>
        w.zh.includes(q) ||
        normalizeSearchText(w.pinyin).includes(q) ||
        normalizeSearchText(w.hanViet).includes(q) ||
        normalizeSearchText(w.vi).includes(q)
    );
  }, [writingEngine.wordList, writingSearchQuery]);

  return (
    <div className={isDark ? 'dark' : ''}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap');

        .font-sans-vn {
          font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .font-hanzi {
          font-family: 'Noto Serif SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', serif;
        }
        .font-hanzi-sans {
          font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        .perspective-1000 {
          perspective: 1200px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
          transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
      `}</style>

      <div className="min-h-screen w-full overflow-x-hidden font-sans-vn bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors duration-200 flex flex-col">
        {/* ================================================================= */}
        {/* TOP NAVIGATION BAR (MOBILE-FIRST & DESKTOP RESPONSIVE)            */}
        {/* ================================================================= */}
        <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 sm:py-0 sm:h-16 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            {/* Top Row on Mobile: Brand + Right Utility Buttons */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="flex items-center gap-2.5 text-left group focus:outline-none min-w-0"
              >
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-rose-600 to-amber-600 flex items-center justify-center text-white shadow-sm shrink-0">
                  <span className="font-hanzi text-lg sm:text-xl font-bold tracking-tighter">汉</span>
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm sm:text-lg tracking-tight text-slate-900 dark:text-white truncate">
                      HSK5 <span className="text-rose-600 dark:text-rose-400">by quyky</span>
                    </span>
                    <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/50">
                      Giáo trình Chuẩn
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                    Từ vựng • Ngữ pháp • Luyện viết ô Mễ
                  </p>
                </div>
              </button>

              {/* Utility Buttons on Mobile */}
              <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setJsonInputText(JSON.stringify(dataset, null, 2));
                    setShowJsonModal(true);
                  }}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  title="Quản lý dữ liệu JSON bài học"
                >
                  <PlusCircle className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsDark((d) => !d)}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  title="Đổi giao diện Sáng/Tối"
                >
                  {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Primary Navigation Links (4 equal columns on mobile, pill bar on desktop) */}
            <nav className="grid grid-cols-4 sm:flex items-center gap-1 sm:gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-sm font-semibold transition ${
                  activeTab === 'dashboard'
                    ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Trang chủ</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('lesson')}
                className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-sm font-semibold transition ${
                  activeTab === 'lesson'
                    ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Bài học</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('flashcard')}
                className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-sm font-semibold transition ${
                  activeTab === 'flashcard'
                    ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Flashcard</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('writing')}
                className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-sm font-semibold transition ${
                  activeTab === 'writing'
                    ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <PenTool className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Luyện viết</span>
              </button>
            </nav>

            {/* Right Utility Controls on Desktop */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setJsonInputText(JSON.stringify(dataset, null, 2));
                  setShowJsonModal(true);
                }}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                title="Quản lý dữ liệu JSON bài học (Thêm bài mới)"
              >
                <PlusCircle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                title={isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
              >
                {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        {/* ================================================================= */}
        {/* MAIN CONTENT AREA                                                 */}
        {/* ================================================================= */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
          {/* --------------------------------------------------------------- */}
          {/* VIEW 1: TRANG CHỦ (DASHBOARD)                                   */}
          {/* --------------------------------------------------------------- */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {/* Hero Welcome & Quick Actions Banner */}
              <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-rose-950 to-slate-900 text-white p-6 sm:p-8 shadow-lg">
                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  <div className="space-y-2.5 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-rose-200 text-xs font-medium">
                      <GraduationCap className="w-4 h-4" />
                      <span>Chào mừng bạn đến với HSK5 by quyky</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                      Chinh phục HSK5 qua từng chi tiết ngôn ngữ
                    </h1>
                    <p className="text-sm sm:text-base text-slate-200/90 leading-relaxed">
                      Hệ thống tự học tiếng Trung thiết kế riêng cho người Việt: ghi nhớ từ vựng sâu bằng Flashcard hai chiều, nắm chắc cấu trúc ngữ pháp và luyện viết chữ Hán chuẩn từng nét.
                    </p>
                  </div>

                  {/* Quick Shortcuts to Core Features */}
                  <div className="flex flex-wrap sm:flex-nowrap gap-3">
                    <button
                      type="button"
                      onClick={() => openFlashcardForLesson(selectedLessonKey, 'vocabulary', 'sequential')}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm shadow-md transition"
                    >
                      <Layers className="w-4 h-4" />
                      <span>Học Flashcard ngay</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openWritingForWord(selectedLessonKey, null, 'all_lesson')}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white font-semibold text-sm border border-white/20 transition"
                    >
                      <PenTool className="w-4 h-4" />
                      <span>Luyện viết chữ Hán</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Progress Overview Metrics */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Award className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                    <span>Tiến độ học tập của bạn</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    className="text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 flex items-center gap-1 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Đặt lại tiến độ</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
                  {/* Stat 1: Từ đã học */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Từ đã học</span>
                      <BookMarked className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                      {globalStats.vocabLearnedTotal}
                      <span className="text-xs font-normal text-slate-400 ml-1">
                        / {globalStats.totalVocab}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Đã tương tác qua thẻ
                    </p>
                  </div>

                  {/* Stat 2: Từ đã nhớ */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Từ đã nhớ</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {globalStats.vocabRemembered}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Hoàn thành {globalStats.overallCompletionPct}% tổng số từ
                    </p>
                  </div>

                  {/* Stat 3: Cần ôn tập (Chưa nhớ) */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Cần ôn tập</span>
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {globalStats.vocabNeedsReview}
                    </p>
                    <button
                      type="button"
                      onClick={() => openFlashcardForLesson('all', 'vocabulary', 'needs_review')}
                      className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Ôn ngay</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Stat 4: Từ chưa học */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Từ chưa học</span>
                      <Clock className="w-4 h-4 text-slate-400" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-700 dark:text-slate-200">
                      {globalStats.vocabUnlearned}
                    </p>
                    <button
                      type="button"
                      onClick={() => openFlashcardForLesson('all', 'vocabulary', 'unremembered')}
                      className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Học từ mới</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Stat 5: Ngữ pháp đã học */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Ngữ pháp đã nhớ</span>
                      <BookOpen className="w-4 h-4 text-purple-500" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {globalStats.grammarRemembered}
                      <span className="text-xs font-normal text-slate-400 ml-1">
                        / {globalStats.totalGrammar}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => openFlashcardForLesson('all', 'grammar', 'all')}
                      className="mt-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Flashcard ngữ pháp</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Stat 6: Tiến độ luyện viết */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
                      <span>Đã luyện viết</span>
                      <PenTool className="w-4 h-4 text-emerald-500" />
                    </div>
                    <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {globalStats.writingPracticedCount}
                      <span className="text-xs font-normal text-slate-400 ml-1">
                        / {globalStats.totalVocab}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => openWritingForWord('all', null, 'unremembered')}
                      className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Luyện viết tiếp</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </section>

              {/* Lesson Cards Section (Dynamic from JSON) */}
              <section className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Danh sách bài học hiện có ({lessons.length} bài)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Số lượng từ vựng và cấu trúc ngữ pháp được trích xuất trực tiếp từ file dữ liệu JSON.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {lessons.map((lesson) => {
                    const vocabCount = lesson.vocabulary.length;
                    const grammarCount = lesson.grammar.length;
                    const rememberedInLesson = lesson.vocabulary.filter(
                      (v) => progress.vocabStatus[v.id] === 'remembered'
                    ).length;
                    const reviewInLesson = lesson.vocabulary.filter(
                      (v) => progress.vocabStatus[v.id] === 'needs_review'
                    ).length;
                    const writtenInLesson = lesson.vocabulary.filter(
                      (v) =>
                        progress.writingProgress[v.id]?.mastered ||
                        (progress.writingProgress[v.id]?.practicedCount ?? 0) > 0
                    ).length;
                    const pct =
                      vocabCount > 0 ? Math.round((rememberedInLesson / vocabCount) * 100) : 0;

                    return (
                      <div
                        key={lesson.key}
                        className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:shadow-md hover:border-rose-300 dark:hover:border-rose-800 transition flex flex-col justify-between"
                      >
                        <div>
                          {/* Top Badge & Progress Percentage */}
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/50">
                              Bài {lesson.lessonNumber}
                            </span>
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                              Đã thuộc {rememberedInLesson}/{vocabCount} từ ({pct}%)
                            </span>
                          </div>

                          {/* Lesson Title (Chinese + Vietnamese) */}
                          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                            Bài {lesson.lessonNumber}:{' '}
                            <span className="font-hanzi text-rose-600 dark:text-rose-400">
                              {lesson.zhTitle}
                            </span>
                          </h3>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {lesson.viTitle}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-4">
                            {lesson.objectives}
                          </p>

                          {/* Dynamic JSON Counts */}
                          <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 mb-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs">
                                {vocabCount}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  {vocabCount} từ vựng
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {reviewInLesson > 0
                                    ? `${reviewInLesson} từ cần ôn`
                                    : `${writtenInLesson} từ đã viết`}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs">
                                {grammarCount}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  {grammarCount} cấu trúc
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Ngữ pháp trọng điểm
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-5">
                            <div
                              className="h-full bg-gradient-to-r from-rose-500 to-emerald-500 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => openLesson(lesson.key)}
                            className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 transition"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>Nội dung</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openFlashcardForLesson(lesson.key, 'vocabulary', 'sequential')}
                            className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/70 dark:hover:bg-rose-900/80 text-rose-700 dark:text-rose-300 transition"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Flashcard</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openWritingForWord(lesson.key, null, 'all_lesson')}
                            className="flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 transition"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                            <span>Luyện viết</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* VIEW 2: TRANG NỘI DUNG BÀI HỌC (VOCABULARY & GRAMMAR)           */}
          {/* --------------------------------------------------------------- */}
          {activeTab === 'lesson' && currentLesson && (
            <div className="space-y-6">
              {/* Lesson Switcher & Header */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {lessons.map((l) => (
                        <button
                          key={l.key}
                          type="button"
                          onClick={() => {
                            setSelectedLessonKey(l.key);
                            setLastActiveLesson(l.key);
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                            l.key === currentLesson.key
                              ? 'bg-rose-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          Bài {l.lessonNumber}: {l.zhTitle}
                        </button>
                      ))}
                    </div>

                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white pt-1">
                      Bài {currentLesson.lessonNumber}:{' '}
                      <span className="font-hanzi text-rose-600 dark:text-rose-400">
                        {currentLesson.zhTitle}
                      </span>{' '}
                      — {currentLesson.viTitle}
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      <strong className="font-semibold text-slate-800 dark:text-slate-200">
                        Mục tiêu bài học:
                      </strong>{' '}
                      {currentLesson.objectives}
                    </p>
                  </div>

                  {/* Quick Jump Buttons */}
                  <div className="flex flex-wrap gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        openFlashcardForLesson(currentLesson.key, 'vocabulary', 'sequential')
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition"
                    >
                      <Layers className="w-4 h-4" />
                      <span>Chuyển sang Flashcard ({currentLesson.vocabulary.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openWritingForWord(currentLesson.key, null, 'all_lesson')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition"
                    >
                      <PenTool className="w-4 h-4" />
                      <span>Luyện viết cả bài</span>
                    </button>
                  </div>
                </div>

                {/* Section Toggle Tabs */}
                <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setLessonSubTab('all')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
                      lessonSubTab === 'all'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    Tất cả (Từ vựng + Ngữ pháp)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLessonSubTab('vocabulary')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
                      lessonSubTab === 'vocabulary'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    A. Từ vựng ({currentLesson.vocabulary.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLessonSubTab('grammar')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
                      lessonSubTab === 'grammar'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    B. Ngữ pháp ({currentLesson.grammar.length})
                  </button>
                </div>
              </div>

              {/* AREA A: TỪ VỰNG */}
              {(lessonSubTab === 'all' || lessonSubTab === 'vocabulary') && (
                <section className="space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xs font-bold">
                        A
                      </span>
                      <span>Danh sách Từ vựng ({filteredLessonVocab.length}/{currentLesson.vocabulary.length})</span>
                    </h2>

                    {/* Search and Filters */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative flex-1 sm:w-64">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={vocabSearch}
                          onChange={(e) => setVocabSearch(e.target.value)}
                          placeholder="Tìm chữ Hán, Pinyin, Hán Việt, nghĩa..."
                          className="w-full pl-9 pr-8 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                        {vocabSearch && (
                          <button
                            type="button"
                            onClick={() => setVocabSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <select
                        value={vocabTypeFilter}
                        onChange={(e) => setVocabTypeFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                      >
                        <option value="all">Mọi từ loại</option>
                        {availableWordTypes.map((wt) => (
                          <option key={wt} value={wt}>
                            Từ loại: {wt}
                          </option>
                        ))}
                      </select>

                      <select
                        value={vocabStatusFilter}
                        onChange={(e) => setVocabStatusFilter(e.target.value as any)}
                        className="px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                      >
                        <option value="all">Mọi trạng thái</option>
                        <option value="remembered">Đã nhớ</option>
                        <option value="needs_review">Chưa nhớ (Cần ôn)</option>
                        <option value="unlearned">Chưa học</option>
                      </select>
                    </div>
                  </div>

                  {filteredLessonVocab.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Không tìm thấy từ vựng nào khớp với bộ lọc hiện tại.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                      {filteredLessonVocab.map((vocab) => {
                        const status = progress.vocabStatus[vocab.id] || 'unlearned';
                        const isWritten =
                          progress.writingProgress[vocab.id]?.mastered ||
                          (progress.writingProgress[vocab.id]?.practicedCount ?? 0) > 0;

                        return (
                          <div
                            key={vocab.id}
                            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm hover:border-rose-300 dark:hover:border-rose-800 transition flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-baseline gap-2.5">
                                  <span className="text-xs font-semibold text-slate-400">
                                    #{vocab.indexInLesson}
                                  </span>
                                  <h3 className="font-hanzi text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                                    {vocab.zh}
                                  </h3>
                                  <button
                                    type="button"
                                    onClick={() => speakChinese(vocab.zh)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                                    title="Nghe phát âm tiếng Trung"
                                  >
                                    <Volume2 className="w-4 h-4" />
                                  </button>
                                </div>

                                <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {vocab.wordType}
                                </span>
                              </div>

                              <div className="mt-2 space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                                    {vocab.pinyin}
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700">•</span>
                                  <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                    Hán Việt: {vocab.hanViet}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 pt-1">
                                  {vocab.vi}
                                </p>
                              </div>
                            </div>

                            {/* Word Card Footer: Memory Status & Direct Shortcuts */}
                            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setVocabMemory(
                                      vocab.id,
                                      status === 'remembered' ? 'unlearned' : 'remembered'
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                    status === 'remembered'
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-600'
                                  }`}
                                  title="Đánh dấu Đã nhớ"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Đã nhớ</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setVocabMemory(
                                      vocab.id,
                                      status === 'needs_review' ? 'unlearned' : 'needs_review'
                                    )
                                  }
                                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition ${
                                    status === 'needs_review'
                                      ? 'bg-amber-500 text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 hover:text-amber-600'
                                  }`}
                                  title="Đánh dấu Chưa nhớ / Cần ôn tập"
                                >
                                  Chưa nhớ
                                </button>
                              </div>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openFlashcardForLesson(
                                      currentLesson.key,
                                      'vocabulary',
                                      'all',
                                      vocab.id
                                    )
                                  }
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                                  title="Mở thẻ Flashcard của từ này"
                                >
                                  <Layers className="w-4 h-4" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    openWritingForWord(currentLesson.key, vocab.id, 'all_lesson')
                                  }
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                                    isWritten
                                      ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-600'
                                  }`}
                                  title="Mở trực tiếp từ này trong khu vực Luyện viết"
                                >
                                  <PenTool className="w-3 h-3" />
                                  <span>Luyện viết</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* AREA B: NGỮ PHÁP */}
              {(lessonSubTab === 'all' || lessonSubTab === 'grammar') && (
                <section className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xs font-bold">
                        B
                      </span>
                      <span>Cấu trúc Ngữ pháp trọng điểm ({currentLesson.grammar.length})</span>
                    </h2>

                    <button
                      type="button"
                      onClick={() =>
                        openFlashcardForLesson(currentLesson.key, 'grammar', 'sequential')
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white transition"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Học Flashcard Ngữ pháp</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {currentLesson.grammar.map((gram) => {
                      const gStatus = progress.grammarStatus[gram.id] || 'unlearned';
                      return (
                        <div
                          key={gram.id}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-3">
                              <span className="px-3 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-hanzi text-xl font-bold border border-purple-200/60 dark:border-purple-800/60">
                                {gram.structure}
                              </span>
                              <div>
                                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                                  Điểm ngữ pháp #{gram.indexInLesson}
                                </span>
                                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                  {gram.meaning}
                                </h3>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setGrammarMemory(
                                    gram.id,
                                    gStatus === 'remembered' ? 'unlearned' : 'remembered'
                                  )
                                }
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                                  gStatus === 'remembered'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-emerald-50'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{gStatus === 'remembered' ? 'Đã nắm vững' : 'Đánh dấu đã nhớ'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  openFlashcardForLesson(
                                    currentLesson.key,
                                    'grammar',
                                    'all',
                                    gram.id
                                  )
                                }
                                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-100 transition"
                              >
                                Mở Flashcard
                              </button>
                            </div>
                          </div>

                          {/* Explanation vs Example clearly separated (Section 2.2.B) */}
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-4">
                            <div className="lg:col-span-5 space-y-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                  Cách sử dụng (Công thức)
                                </p>
                                <p className="text-sm font-semibold text-rose-600 dark:text-rose-400 font-hanzi-sans">
                                  {gram.usage}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                  Giải thích ý nghĩa
                                </p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                  {gram.meaning}
                                </p>
                              </div>
                            </div>

                            <div className="lg:col-span-7 space-y-2.5">
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                Ví dụ minh họa ({gram.examples.length})
                              </p>
                              {gram.examples.map((ex, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-xl border border-purple-100 dark:border-slate-800 bg-purple-50/40 dark:bg-slate-900 p-4 space-y-1.5"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-hanzi-sans text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
                                      {ex.zh}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => speakChinese(ex.zh)}
                                      className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-slate-800 transition shrink-0"
                                      title="Nghe câu ví dụ"
                                    >
                                      <Volume2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <p className="text-sm text-slate-600 dark:text-slate-300 italic">
                                    → {ex.vi}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* VIEW 3: CHỨC NĂNG FLASHCARD (TỪ VỰNG & NGỮ PHÁP)                */}
          {/* --------------------------------------------------------------- */}
          {activeTab === 'flashcard' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Top Controls Bar: Card Type, Lesson Scope, Study Mode */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {/* Switch between Vocab Flashcard (3.1) and Grammar Flashcard (3.2) */}
                  <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setFlashcardType('vocabulary');
                        setFlashcardTargetId(null);
                      }}
                      className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition ${
                        flashcardType === 'vocabulary'
                          ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      3.1. Flashcard Từ vựng
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFlashcardType('grammar');
                        setFlashcardTargetId(null);
                      }}
                      className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition ${
                        flashcardType === 'grammar'
                          ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      3.2. Flashcard Ngữ pháp
                    </button>
                  </div>

                  {/* Lesson Scope Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Phạm vi:
                    </span>
                    <select
                      value={flashcardLessonScope}
                      onChange={(e) => {
                        setFlashcardLessonScope(e.target.value);
                        setFlashcardTargetId(null);
                      }}
                      className="px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    >
                      <option value="all">Tất cả các bài ({lessons.length} bài)</option>
                      {lessons.map((l) => (
                        <option key={l.key} value={l.key}>
                          Bài {l.lessonNumber}: {l.zhTitle}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 5 Study Modes (Section 3.3) */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <ListFilter className="w-3.5 h-3.5" />
                    <span>Chế độ học (5 chế độ):</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'sequential', label: 'Theo thứ tự giáo trình' },
                      { id: 'all', label: 'Học tất cả' },
                      { id: 'unremembered', label: 'Chỉ học thẻ chưa nhớ' },
                      { id: 'needs_review', label: 'Ôn tập thẻ đánh dấu chưa nhớ' },
                      { id: 'random', label: 'Học ngẫu nhiên' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setFlashcardMode(m.id as FlashcardStudyMode);
                          setFlashcardTargetId(null);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                          flashcardMode === m.id
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Flashcard Main Stage */}
              {!flashcardEngine.currentCard ? (
                <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-4">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Không có thẻ nào trong chế độ lọc này!
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Có thể bạn đã ghi nhớ hết các thẻ hoặc chưa đánh dấu thẻ nào vào mục "Chưa nhớ".
                    </p>
                  </div>
                  <div className="flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setFlashcardMode('all')}
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs sm:text-sm font-semibold"
                    >
                      Chuyển sang Học tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() => flashcardEngine.refreshDeck()}
                      className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold"
                    >
                      Làm mới danh sách thẻ
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Card Status Header & Utility Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                        Thẻ {flashcardEngine.currentIndex + 1} / {flashcardEngine.totalCards}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                        Bài {flashcardEngine.currentCard.lessonNumber}
                      </span>
                      {(() => {
                        const statusMap =
                          flashcardType === 'vocabulary'
                            ? progress.vocabStatus
                            : progress.grammarStatus;
                        const st = statusMap[flashcardEngine.currentCard.id] || 'unlearned';
                        if (st === 'remembered') {
                          return (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-semibold">
                              ✓ Đã nhớ
                            </span>
                          );
                        }
                        if (st === 'needs_review') {
                          return (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold">
                              ! Chưa nhớ (Cần ôn)
                            </span>
                          );
                        }
                        return (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            Chưa học
                          </span>
                        );
                      })()}
                    </div>

                    {/* Shuffle & Auto-play Controls */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={flashcardEngine.shuffleDeck}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                        title="Xáo trộn thứ tự thẻ"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Xáo trộn thẻ</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => flashcardEngine.setIsAutoPlay((a) => !a)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                          flashcardEngine.isAutoPlay
                            ? 'border-rose-600 bg-rose-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {flashcardEngine.isAutoPlay ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {flashcardEngine.isAutoPlay ? 'Đang tự động chuyển' : 'Tự động chuyển thẻ'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 3D Flip Card Container */}
                  <div
                    onClick={flashcardEngine.flipCard}
                    className="perspective-1000 w-full h-[380px] sm:h-[420px] cursor-pointer select-none"
                  >
                    <div
                      className={`relative w-full h-full preserve-3d ${
                        flashcardEngine.isFlipped ? 'rotate-y-180' : ''
                      }`}
                    >
                      {/* ================= FRONT FACE ================= */}
                      <div className="absolute inset-0 w-full h-full backface-hidden rounded-3xl border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-6 sm:p-10 flex flex-col items-center justify-between text-center">
                        <div className="w-full flex items-center justify-between text-xs text-slate-400">
                          <span>MẶT TRƯỚC • Bấm vào thẻ hoặc nhấn Space để lật</span>
                          {flashcardType === 'vocabulary' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                speakChinese((flashcardEngine.currentCard as VocabularyItem).zh);
                              }}
                              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600 transition"
                              title="Nghe phát âm"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {flashcardType === 'vocabulary' ? (
                          /* 3.1 Vocabulary Front: ONLY Large Hanzi (no pinyin/meaning) */
                          <div className="my-auto space-y-4">
                            <p className="font-hanzi text-6xl sm:text-7xl md:text-8xl font-bold text-slate-900 dark:text-white tracking-wide">
                              {(flashcardEngine.currentCard as VocabularyItem).zh}
                            </p>
                            <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-500">
                              Hãy tự nhẩm Pinyin, Âm Hán Việt và nghĩa trước khi lật thẻ
                            </p>
                          </div>
                        ) : (
                          /* 3.2 Grammar Front: Structure + Chinese Example (without translation) */
                          <div className="my-auto max-w-xl space-y-5">
                            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300">
                              Cấu trúc ngữ pháp
                            </span>
                            <p className="font-hanzi text-4xl sm:text-5xl font-bold text-purple-600 dark:text-purple-400">
                              {(flashcardEngine.currentCard as GrammarItem).structure}
                            </p>
                            {(flashcardEngine.currentCard as GrammarItem).examples?.[0] && (
                              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700">
                                <p className="text-xs text-slate-400 mb-1">
                                  Ví dụ suy luận (chưa dịch):
                                </p>
                                <p className="font-hanzi-sans text-lg sm:text-xl font-medium text-slate-800 dark:text-slate-100">
                                  “{(flashcardEngine.currentCard as GrammarItem).examples[0].zh}”
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                          <span>Nhấn để xem đáp án mặt sau</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>

                      {/* ================= BACK FACE ================= */}
                      <div className="absolute inset-0 w-full h-full backface-hidden rotate-y-180 rounded-3xl border-2 border-rose-200 dark:border-rose-900/70 bg-white dark:bg-slate-900 shadow-lg p-6 sm:p-10 flex flex-col justify-between">
                        <div className="w-full flex items-center justify-between text-xs text-slate-400">
                          <span>MẶT SAU • CHI TIẾT GHI NHỚ</span>
                          <div className="flex items-center gap-2">
                            {flashcardType === 'vocabulary' && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    speakChinese((flashcardEngine.currentCard as VocabularyItem).zh);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-rose-600"
                                >
                                  <Volume2 className="w-3.5 h-3.5" />
                                  <span>Phát âm</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const card = flashcardEngine.currentCard as VocabularyItem;
                                    openWritingForWord(card.lessonKey, card.id, 'all_lesson');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                                >
                                  <PenTool className="w-3.5 h-3.5" />
                                  <span>Luyện viết từ này</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {flashcardType === 'vocabulary' ? (
                          /* 3.1 Vocabulary Back: Hanzi, Pinyin, Han Viet, Meaning, Word Type */
                          <div className="my-auto text-center space-y-4">
                            <p className="font-hanzi text-5xl sm:text-6xl font-bold text-slate-900 dark:text-white">
                              {(flashcardEngine.currentCard as VocabularyItem).zh}
                            </p>
                            <p className="text-2xl sm:text-3xl font-bold text-rose-600 dark:text-rose-400">
                              {(flashcardEngine.currentCard as VocabularyItem).pinyin}
                            </p>

                            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                              <span className="px-3 py-1 rounded-xl text-xs sm:text-sm font-bold bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800">
                                Âm Hán Việt: {(flashcardEngine.currentCard as VocabularyItem).hanViet}
                              </span>
                              <span className="px-3 py-1 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                Từ loại: {(flashcardEngine.currentCard as VocabularyItem).wordType}
                              </span>
                            </div>

                            <div className="pt-2 max-w-lg mx-auto">
                              <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                                Nghĩa tiếng Việt
                              </p>
                              <p className="text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                                {(flashcardEngine.currentCard as VocabularyItem).vi}
                              </p>
                            </div>
                          </div>
                        ) : (
                          /* 3.2 Grammar Back: Structure, Meaning, Usage, Chinese Example, Vietnamese Translation */
                          <div className="my-auto space-y-4 text-left max-w-2xl mx-auto w-full">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                              <h3 className="font-hanzi text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">
                                {(flashcardEngine.currentCard as GrammarItem).structure}
                              </h3>
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                                Cách dùng: {(flashcardEngine.currentCard as GrammarItem).usage}
                              </span>
                            </div>

                            <div>
                              <p className="text-xs font-bold uppercase text-slate-400">Ý nghĩa:</p>
                              <p className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
                                {(flashcardEngine.currentCard as GrammarItem).meaning}
                              </p>
                            </div>

                            {(flashcardEngine.currentCard as GrammarItem).examples.map((ex, i) => (
                              <div
                                key={i}
                                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 space-y-1 border border-slate-200/60 dark:border-slate-700"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-hanzi-sans text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                                    {ex.zh}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      speakChinese(ex.zh);
                                    }}
                                    className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-100 dark:hover:bg-slate-700"
                                  >
                                    <Volume2 className="w-4 h-4" />
                                  </button>
                                </div>
                                <p className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                                  Dịch: {ex.vi}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="text-center text-xs text-slate-400">
                          Bấm lại vào thẻ để lật về mặt trước
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Primary Action Buttons: Prev, Chưa nhớ, Đã nhớ, Next */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <button
                      type="button"
                      onClick={flashcardEngine.prevCard}
                      className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Thẻ trước</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const id = flashcardEngine.currentCard.id;
                        if (flashcardType === 'vocabulary') setVocabMemory(id, 'needs_review');
                        else setGrammarMemory(id, 'needs_review');
                        triggerToast('Đã lưu: Chưa nhớ (Đưa vào danh sách ôn tập)');
                        flashcardEngine.nextCard();
                      }}
                      className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-sm transition"
                    >
                      <AlertCircle className="w-4 h-4" />
                      <span>Chưa nhớ (Phím 1)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const id = flashcardEngine.currentCard.id;
                        if (flashcardType === 'vocabulary') setVocabMemory(id, 'remembered');
                        else setGrammarMemory(id, 'remembered');
                        triggerToast('Tuyệt vời! Đã lưu trạng thái: Đã nhớ');
                        flashcardEngine.nextCard();
                      }}
                      className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Đã nhớ (Phím 2)</span>
                    </button>

                    <button
                      type="button"
                      onClick={flashcardEngine.nextCard}
                      className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm transition"
                    >
                      <span>Thẻ tiếp theo</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Keyboard Shortcut Hint */}
                  <div className="flex items-center justify-center gap-4 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <Keyboard className="w-3.5 h-3.5" />
                      <span>Phím tắt:</span>
                    </span>
                    <span>[Space] Lật thẻ</span>
                    <span>[←/→] Chuyển thẻ</span>
                    <span>[1] Chưa nhớ</span>
                    <span>[2] Đã nhớ</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* VIEW 4: CHỨC NĂNG LUYỆN VIẾT CHỮ HÁN (GỌN GÀNG, CHUẨN MOBILE)   */}
          {/* --------------------------------------------------------------- */}
          {activeTab === 'writing' && (
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5">
              {/* Compact Control & Filter Header */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-5 shadow-sm space-y-3.5">
                {/* Row 1: Title + Đã nhớ / Chưa thuộc Counters */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PenTool className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Luyện viết chữ Hán (Ô Mễ)
                    </h1>
                  </div>

                  {(() => {
                    const scopePool =
                      writingLessonScope === 'all'
                        ? lessons.flatMap((l) => l.vocabulary)
                        : lessons
                            .filter((l) => l.key === writingLessonScope)
                            .flatMap((l) => l.vocabulary);
                    const remCount = scopePool.filter(
                      (w) => progress.vocabStatus[w.id] === 'remembered'
                    ).length;
                    const revCount = scopePool.filter(
                      (w) => progress.vocabStatus[w.id] === 'needs_review'
                    ).length;
                    return (
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          ✅ Đã nhớ: {remCount} từ
                        </span>
                        <span className="px-2.5 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                          📌 Chưa thuộc: {revCount} từ
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Row 2: Practice Mode Pills */}
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {[
                    { id: 'all_lesson', label: 'Toàn bộ từ vựng của bài' },
                    { id: 'unremembered', label: 'Những từ chưa thuộc' },
                    { id: 'random', label: 'Luyện viết ngẫu nhiên' },
                    { id: 'single_word', label: 'Chọn từng từ riêng lẻ' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setWritingMode(m.id as WritingPracticeMode);
                        if (m.id === 'random') writingEngine.reshuffleWords();
                      }}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition ${
                        writingMode === m.id
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Row 3: Compact Selectors (Lesson + Direct Word Jump + Search) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Chọn bài học:
                    </label>
                    <select
                      value={writingLessonScope}
                      onChange={(e) => {
                        setWritingLessonScope(e.target.value);
                        setWritingTargetId(null);
                      }}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    >
                      <option value="all">Tất cả bài học ({lessons.length} bài)</option>
                      {lessons.map((l) => (
                        <option key={l.key} value={l.key}>
                          Bài {l.lessonNumber}: {l.zhTitle} ({l.vocabulary.length} từ)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Chuyển nhanh đến từ ({filteredWritingWords.length} từ):
                    </label>
                    <select
                      value={writingEngine.currentWord?.id || ''}
                      onChange={(e) => writingEngine.selectWordById(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    >
                      {filteredWritingWords.map((w) => (
                        <option key={w.id} value={w.id}>
                          #{w.indexInLesson}. {w.vi}
                          {showWritingHanzi ? ` (${w.zh})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Tìm nhanh từ cần viết:
                    </label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={writingSearchQuery}
                        onChange={(e) => setWritingSearchQuery(e.target.value)}
                        placeholder="Nhập nghĩa tiếng Việt, Pinyin..."
                        className="w-full pl-8 pr-7 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      {writingSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setWritingSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {!writingEngine.currentWord ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
                  <p className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
                    Không có từ vựng nào trong chế độ lọc này.
                  </p>
                  <button
                    type="button"
                    onClick={() => setWritingMode('all_lesson')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold"
                  >
                    Hiển thị toàn bộ từ vựng của bài
                  </button>
                </div>
              ) : (
                <>
                  {/* Main Unified Full-Word Mizige Writing Studio */}
                  <FullWordMizigePad
                    word={writingEngine.currentWord}
                    wordIndex={writingEngine.currentWordIndex}
                    totalWords={writingEngine.wordList.length}
                    characters={writingEngine.hanziChars}
                    showHanzi={showWritingHanzi}
                    showPinyin={showWritingPinyin}
                    isDark={isDark}
                    activeCharIndex={writingEngine.activeCharIndex}
                    memoryStatus={progress.vocabStatus[writingEngine.currentWord.id] || 'unlearned'}
                    showSingleCharDetail={showSingleCharDetail}
                    onSelectCharIndex={writingEngine.setActiveCharIndex}
                    onToggleHanzi={() => setShowWritingHanzi((v) => !v)}
                    onTogglePinyin={() => setShowWritingPinyin((v) => !v)}
                    onToggleSingleCharDetail={() => setShowSingleCharDetail((v) => !v)}
                    onMarkMemory={(st) => {
                      if (!writingEngine.currentWord) return;
                      setVocabMemory(writingEngine.currentWord.id, st);
                      if (st === 'remembered') {
                        recordWritingPractice(writingEngine.currentWord.id, true);
                        triggerToast('Đã lưu vào danh sách: Đã nhớ!');
                      } else {
                        triggerToast('Đã đưa vào danh sách: Chưa thuộc (Cần ôn)');
                      }
                    }}
                    onPrevWord={writingEngine.prevWord}
                    onNextWord={writingEngine.nextWord}
                    onFirstStrokeCompleted={() => {
                      if (writingEngine.currentWord) {
                        recordWritingPractice(writingEngine.currentWord.id, true);
                      }
                    }}
                  />

                  {/* Expandable Single-Character Stroke Order Guide (When user clicks "Xem thứ tự nét") */}
                  <div className={showSingleCharDetail ? 'block space-y-3' : 'hidden'}>
                    <div className="rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-white dark:bg-slate-900 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                          Chọn chữ trong từ để xem thứ tự nét động:
                        </span>
                        <div className="flex items-center gap-1.5">
                          {writingEngine.hanziChars.map((ch, idx) => (
                            <button
                              key={`${ch}_${idx}`}
                              type="button"
                              onClick={() => writingEngine.setActiveCharIndex(idx)}
                              className={`px-3 py-1 rounded-xl font-hanzi text-base font-bold border transition ${
                                writingEngine.activeCharIndex === idx
                                  ? 'border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Ô {idx + 1}: {ch}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <HanziStrokeGuide
                          character={writingEngine.targetChar}
                          isDark={isDark}
                          onNextChar={writingEngine.nextCharOrWord}
                          onQuizComplete={() => {
                            if (writingEngine.currentWord) {
                              recordWritingPractice(writingEngine.currentWord.id, true);
                            }
                          }}
                        />

                        <FreehandWritingPad
                          character={writingEngine.targetChar}
                          showModelChar={showWritingHanzi && writingEngine.showModelChar}
                          strokes={writingEngine.strokes}
                          isDark={isDark}
                          onChangeStrokes={writingEngine.setStrokes}
                          onUndo={writingEngine.undoLastStroke}
                          onClear={writingEngine.clearStrokes}
                          onToggleModel={() => {
                            if (!showWritingHanzi) setShowWritingHanzi(true);
                            writingEngine.setShowModelChar((v) => !v);
                          }}
                          onNextChar={writingEngine.nextCharOrWord}
                          onFirstStrokeCompleted={() => {
                            if (writingEngine.currentWord) {
                              recordWritingPractice(writingEngine.currentWord.id, true);
                            }
                          }}
                        />
                      </div>

                      <div className="hidden">
                        <button type="button" onClick={writingEngine.prevCharOrWord}>
                          Chữ / Từ trước
                        </button>
                        <button type="button" onClick={writingEngine.nextCharOrWord}>
                          Chữ / Từ tiếp theo
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bottom 2-Column Lists: Đã thuộc (Đã nhớ) & Chưa nhớ (Chưa thuộc) matching reference image */}
                  {(() => {
                    const scopePool =
                      writingLessonScope === 'all'
                        ? lessons.flatMap((l) => l.vocabulary)
                        : lessons
                            .filter((l) => l.key === writingLessonScope)
                            .flatMap((l) => l.vocabulary);
                    const rememberedList = scopePool.filter(
                      (w) => progress.vocabStatus[w.id] === 'remembered'
                    );
                    const needsReviewList = scopePool.filter(
                      (w) => progress.vocabStatus[w.id] === 'needs_review'
                    );

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Box 1: Đã thuộc / Đã nhớ (Green Box) */}
                        <div className="rounded-2xl border-2 border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400">
                              Đã thuộc (Đã nhớ): {rememberedList.length}
                            </h3>
                            {rememberedList.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  rememberedList.forEach((w) => setVocabMemory(w.id, 'unlearned'));
                                  triggerToast('Đã đặt lại danh sách Đã nhớ trong bài này.');
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-slate-600 dark:text-slate-300 hover:text-rose-600"
                              >
                                Đặt lại
                              </button>
                            )}
                          </div>

                          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                            {rememberedList.length === 0 ? (
                              <p className="text-xs text-slate-400 italic py-4 text-center">
                                Chưa có từ nào được đánh dấu Đã nhớ. Hãy viết chữ và bấm "Kiểm tra" hoặc "Đã nhớ"!
                              </p>
                            ) : (
                              rememberedList.map((w) => (
                                <div
                                  key={w.id}
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-emerald-200/60 dark:border-emerald-900/50 text-xs"
                                >
                                  <button
                                    type="button"
                                    onClick={() => writingEngine.selectWordById(w.id)}
                                    className="text-left truncate flex-1 hover:opacity-80"
                                  >
                                    <span className="font-hanzi font-bold text-sm text-slate-900 dark:text-white mr-1.5">
                                      {w.zh}
                                    </span>
                                    <span className="text-amber-600 dark:text-amber-400 font-medium mr-1.5">
                                      [{w.pinyin}]
                                    </span>
                                    <span className="text-slate-600 dark:text-slate-300">
                                      {w.vi}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => speakChinese(w.zh)}
                                    className="p-1 text-slate-400 hover:text-emerald-600 shrink-0"
                                    title="Nghe phát âm"
                                  >
                                    <Volume2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Box 2: Chưa thuộc / Cần ôn (Rose/Red Box) */}
                        <div className="rounded-2xl border-2 border-rose-500/40 dark:border-rose-500/30 bg-rose-50/30 dark:bg-rose-950/20 p-4 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-400">
                              Chưa thuộc (Cần ôn): {needsReviewList.length}
                            </h3>
                            {needsReviewList.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setWritingMode('unremembered');
                                  if (needsReviewList[0]) {
                                    writingEngine.selectWordById(needsReviewList[0].id);
                                  }
                                  triggerToast('Đang lọc chế độ: Ôn tập các từ chưa thuộc!');
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-500"
                              >
                                Ôn ngay
                              </button>
                            )}
                          </div>

                          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                            {needsReviewList.length === 0 ? (
                              <p className="text-xs text-slate-400 italic py-4 text-center">
                                Tuyệt vời! Không có từ nào bị đánh dấu Chưa thuộc.
                              </p>
                            ) : (
                              needsReviewList.map((w) => (
                                <div
                                  key={w.id}
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-rose-200/60 dark:border-rose-900/50 text-xs"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setWritingMode('all_lesson');
                                      writingEngine.selectWordById(w.id);
                                    }}
                                    className="text-left truncate flex-1 hover:opacity-80"
                                  >
                                    {showWritingHanzi && (
                                      <span className="font-hanzi font-bold text-sm text-slate-900 dark:text-white mr-1.5">
                                        {w.zh}
                                      </span>
                                    )}
                                    {showWritingPinyin && (
                                      <span className="text-amber-600 dark:text-amber-400 font-medium mr-1.5">
                                        [{w.pinyin}]
                                      </span>
                                    )}
                                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                                      {w.vi}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => speakChinese(w.zh)}
                                    className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                                    title="Nghe phát âm"
                                  >
                                    <Volume2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

        </main>

        {/* ================================================================= */}
        {/* FOOTER                                                            */}
        {/* ================================================================= */}
        <footer className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 py-4 px-4 sm:px-6 lg:px-8 mt-auto">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <p>
              <strong>HSK5 by quyky</strong> — Nền tảng tự học Từ vựng, Ngữ pháp & Luyện viết chữ Hán HSK5 cho người Việt.
            </p>
            <p>
              Tiến độ học tập được lưu tự động trên trình duyệt (LocalStorage).
            </p>
          </div>
        </footer>

        {/* ================================================================= */}
        {/* IN-PAGE MODAL: RESET PROGRESS CONFIRMATION                        */}
        {/* ================================================================= */}
        {showResetModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <h3 className="text-lg font-bold">Xác nhận đặt lại tiến độ học tập?</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Toàn bộ trạng thái từ vựng (Đã nhớ / Chưa nhớ), ngữ pháp đã học và lịch sử luyện viết chữ Hán sẽ được đưa về trạng thái ban đầu. Dữ liệu bài học gốc vẫn giữ nguyên.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAllProgress();
                    setShowResetModal(false);
                    triggerToast('Đã đặt lại toàn bộ tiến độ học tập.');
                  }}
                  className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Đồng ý đặt lại
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* IN-PAGE MODAL: DYNAMIC JSON LESSON MANAGER (SECTION 7)            */}
        {/* ================================================================= */}
        {showJsonModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-2xl w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Quản lý dữ liệu JSON Bài học (Mở rộng bài học tự động)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Bạn có thể thêm bài học mới (ví dụ: "bai4", "bai5"...) vào đối tượng "translation" mà không cần sửa code giao diện.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowJsonModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <textarea
                value={jsonInputText}
                onChange={(e) => setJsonInputText(e.target.value)}
                rows={12}
                className="w-full font-mono text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleRestoreDefaultJson}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Khôi phục 3 bài gốc (hsk5.json)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowJsonModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700"
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    onClick={handleImportJson}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Lưu & Áp dụng dữ liệu JSON
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TOAST NOTIFICATION                                                */}
        {/* ================================================================= */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-3 shadow-lg flex items-center gap-2.5 text-xs sm:text-sm font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
