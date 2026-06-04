import { useState, useCallback, useEffect, useRef } from "react";
import { useI18n } from "../../components/useI18n";
import { Copy, X, Languages, ArrowLeftRight, BookOpen, Volume2, Trash2, Check, FolderOpen, FileText, ZoomIn, ZoomOut } from "lucide-react";

type Direction = "zh2en" | "en2zh";
type Provider = "mymemory" | "ninerouter";
type LangDetect = "zh" | "en" | "mixed" | "unknown";

interface VocabEntry {
  char: string;
  pinyin?: string;
  meaning?: string;
  frequency?: number;
}

interface WordHistoryItem {
  word: string;
  timestamp: number;
  entries: VocabEntry[];
}

interface TranslateProps {
  profile?: string;
}

// Only filter closed-class / function words. Let WORD_API decide what's vocabulary.
const COMMON_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","as","is","was","are","were","be","been","being","have",
  "has","had","do","does","did","will","would","could","should","may",
  "might","shall","can","not","no","nor","so","yet","both","either",
  "neither","this","that","these","those","it","its","he","she","they",
  "we","you","i","me","him","her","us","them","my","our","your","their",
  "what","which","who","whom","when","where","why","how","all","each",
  "every","more","most","other","some","such","than","then","there",
  "after","before","about","over","under","between","into","through",
  "during","also","just","now","only","even","still","already","however",
  "therefore","although","because","while","since","if","up","out",
  "said","new","one","two","three","four","five","six","seven","eight",
  "nine","ten","mr","ms","mrs","dr","very","much","well","good","like",
  "many","per","own","too","any","few","get","got","let","put","set",
  "say","see","try","use","way","day","man","men","off","far","big",
  "old","ago","end","add","ask","run","long","last","next","same",
  "came","come","make","take","give","know","think","look","want",
  "seem","call","keep","tell","show","find","lead","play","move","live",
  "back","left","turn","start","hand","place","right","small","large",
  "early","young","high","low","late","hard","near","open","free","real",
]);

function extractWords(text: string): string[] {
  const raw = text.match(/\b[A-Za-z]{4,}\b/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of raw) {
    const lw = w.toLowerCase();
    if (!COMMON_WORDS.has(lw) && !seen.has(lw)) {
      seen.add(lw);
      result.push(lw);
    }
  }
  return result;
}

function detectLang(text: string): LangDetect {
  const t = text.replace(/\s/g, "");
  if (!t.length) return "unknown";
  const zhChars = (t.match(/[一-鿿㐀-䶿豈-﫿]/g) ?? []).length;
  const enChars = (t.match(/[a-zA-Z]/g) ?? []).length;
  if (zhChars / t.length > 0.3) return "zh";
  if (enChars / t.length > 0.5) return "en";
  return "mixed";
}

export default function Translate({ profile: _profile }: TranslateProps): React.JSX.Element {
  const { t } = useI18n();
  const [sourceText, setSourceText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [direction, setDirection] = useState<Direction>("zh2en");
  const [provider, setProvider] = useState<Provider>("mymemory");
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [detectedLang, setDetectedLang] = useState<LangDetect>("unknown");

  const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [wordHistory, setWordHistory] = useState<WordHistoryItem[]>([]);

  // File panel state
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const dropCountRef = useRef(0);

  const [fontSize, setFontSize] = useState(22);
  const zoomIn = useCallback(() => setFontSize((s) => Math.min(s + 2, 28)), []);
  const zoomOut = useCallback(() => setFontSize((s) => Math.max(s - 2, 10)), []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vocabLookupRef = useRef<((text: string) => Promise<void>) | null>(null);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const loadFileContent = useCallback((name: string, content: string) => {
    setFileName(name);
    setFileText(content);
    setFilePanelOpen(true);
    const preview = content.slice(0, 2000);
    const lang = detectLang(preview);
    if (lang === "zh") setDirection("zh2en");
    else if (lang === "en") setDirection("en2zh");
    vocabLookupRef.current?.(preview);
  }, []);

  const handleOpenFile = useCallback(async () => {
    const filePath = await window.hermesAPI.openFileDialog();
    if (!filePath) return;
    const res = await window.hermesAPI.parseFileText(filePath);
    if ("error" in res) { console.error(res.error); return; }
    const name = filePath.replace(/.*[\\/]/, "");
    loadFileContent(name, res.text);
  }, [loadFileContent]);


  // Drag-and-drop
  useEffect(() => {
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      if (++dropCountRef.current === 1) setDropActive(true);
    };
    const onDragLeave = (): void => {
      if (--dropCountRef.current === 0) setDropActive(false);
    };
    const onDragOver = (e: DragEvent): void => { e.preventDefault(); };
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      dropCountRef.current = 0;
      setDropActive(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      // Electron exposes path via webkitRelativePath fallback or file.path
      const filePath = (file as File & { path?: string }).path;
      if (!filePath) return;
      const res = await window.hermesAPI.parseFileText(filePath);
      if ("error" in res) { console.error(res.error); return; }
      loadFileContent(file.name, res.text);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [loadFileContent]);

  const runVocabLookup = useCallback(async (text: string) => {
    const lang = detectLang(text);
    setDetectedLang(lang);

    if (lang === "zh") {
      setDirection("zh2en");
      setVocabEntries([]);
      return;
    }

    if (lang === "en" || lang === "mixed") {
      if (lang === "en") setDirection("en2zh");
      const words = extractWords(text).slice(0, 20);
      if (!words.length) { setVocabEntries([]); return; }

      setVocabLoading(true);
      try {
        // Only show words that exist in the personal vocabulary database (WORD_API).
        // No fallback: translating every unknown word defeats the purpose of the vocab panel.
        const entries = await window.hermesAPI.vocabLookup(words);
        setVocabEntries(entries);
        if (entries.length > 0) {
          const label = entries[0].char;
          setWordHistory((prev) => {
            const filtered = prev.filter((h) => h.word !== label);
            return [{ word: label, timestamp: Date.now(), entries }, ...filtered].slice(0, 20);
          });
        }
      } catch {
        setVocabEntries([]);
      } finally {
        setVocabLoading(false);
      }
    }
  }, []);

  useEffect(() => { vocabLookupRef.current = runVocabLookup; }, [runVocabLookup]);

  const handleSendFileToTranslate = useCallback(() => {
    const text = fileText.slice(0, 5000);
    setSourceText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runVocabLookup(text), 500);
  }, [fileText, runVocabLookup]);

  const handleSourceChange = useCallback((text: string) => {
    setSourceText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setDetectedLang("unknown");
      setVocabEntries([]);
      return;
    }
    debounceRef.current = setTimeout(() => runVocabLookup(text), 500);
  }, [runVocabLookup]);

  // Chinese text selection: translate to English via MyMemory
  const handleSourceMouseUp = useCallback(async () => {
    const selection = window.getSelection()?.toString().trim() ?? "";
    if (selection.length < 1 || selection.length > 80) return;
    if (!/[一-龥]/.test(selection)) return;
    try {
      const meaning = await window.hermesAPI.myMemoryTranslate(selection, "zh|en");
      if (meaning && meaning !== selection) {
        const entry: VocabEntry = { char: selection, meaning };
        setVocabEntries([entry]);
        setWordHistory((prev) => {
          const filtered = prev.filter((h) => h.word !== selection);
          return [{ word: selection, timestamp: Date.now(), entries: [entry] }, ...filtered].slice(0, 20);
        });
      }
    } catch { /* ignore */ }
  }, []);

  const handleTranslate = useCallback(async () => {
    const text = sourceText.trim();
    if (!text) return;
    setTranslating(true);
    setError(null);
    try {
      let result: string;
      if (provider === "mymemory") {
        const langpair = direction === "en2zh" ? "en|zh" : "zh|en";
        result = await window.hermesAPI.myMemoryTranslate(text, langpair);
      } else {
        result = await window.hermesAPI.nineRouterTranslate(text, direction);
      }
      setOutputText(result);
    } catch {
      setError(t("translate.error"));
      setOutputText("");
    } finally {
      setTranslating(false);
    }
  }, [sourceText, direction, provider, t]);

  const handleSwap = useCallback(() => {
    setDirection((prev) => (prev === "zh2en" ? "en2zh" : "zh2en"));
    setSourceText(outputText);
    setOutputText(sourceText);
    setError(null);
  }, [sourceText, outputText]);

  const handleClear = useCallback(() => {
    setSourceText("");
    setOutputText("");
    setError(null);
    setDetectedLang("unknown");
    setVocabEntries([]);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!outputText) return;
    await window.hermesAPI.copyToClipboard(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [outputText]);

  const speakWord = useCallback((word: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = /[一-龥]/.test(word) ? "zh-CN" : "en-US";
      window.speechSynthesis.speak(utter);
    }
  }, []);

  const copyWord = useCallback((word: string) => {
    window.hermesAPI.copyToClipboard(word).catch(() => {});
  }, []);

  const sourceLang = direction === "zh2en" ? "中文" : "English";
  const targetLang = direction === "zh2en" ? "English" : "中文";
  const charCount = sourceText.length;

  const langBadgeText =
    detectedLang === "zh" ? "中文 → 英文" :
    detectedLang === "en" ? "英文 → 中文" :
    null;

  return (
    <div className="translate-container">

      {/* ── Drop overlay ── */}
      {dropActive && (
        <div className="translate-drop-overlay">
          <FileText size={32} />
          <span>松开以打开文件</span>
          <span style={{ fontSize: "11px", opacity: 0.6 }}>txt · md · pdf · docx · pptx · html</span>
        </div>
      )}

      {/* ── Header ── */}
      <div className="translate-header">
        <div className="translate-header-left">
          <div className="translate-icon-wrap">
            <Languages size={16} />
          </div>
          <span className="translate-title">{t("translate.title")}</span>
          {langBadgeText && (
            <span className="translate-lang-badge">{langBadgeText}</span>
          )}
        </div>

        <div className="translate-controls">
          <div className="translate-zoom-btns">
            <button className="translate-pane-btn" onClick={zoomOut} title="缩小字体" disabled={fontSize <= 10}>
              <ZoomOut size={12} />
            </button>
            <span className="translate-zoom-label">{fontSize}px</span>
            <button className="translate-pane-btn" onClick={zoomIn} title="放大字体" disabled={fontSize >= 28}>
              <ZoomIn size={12} />
            </button>
          </div>

          <button
            className="translate-pane-btn"
            onClick={handleOpenFile}
            title="拖拽或打开文件"
          >
            <FolderOpen size={12} />
            {t("translate.openFile")}
          </button>

          <div className="translate-seg">
            {(["zh2en", "en2zh"] as Direction[]).map((d) => (
              <button
                key={d}
                className={`translate-seg-btn${direction === d ? " active" : ""}`}
                onClick={() => setDirection(d)}
              >
                {t(`translate.${d}`)}
              </button>
            ))}
          </div>

          <div className="translate-seg">
            {(["mymemory", "ninerouter"] as Provider[]).map((p) => (
              <button
                key={p}
                className={`translate-seg-btn${provider === p ? " active" : ""}`}
                onClick={() => setProvider(p)}
              >
                {p === "mymemory" ? t("translate.providerMyMemory") : t("translate.providerNineRouter")}
              </button>
            ))}
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={handleTranslate}
            disabled={translating || !sourceText.trim()}
          >
            {translating ? t("translate.translating") : t("translate.translateBtn")}
          </button>
        </div>
      </div>

      {/* ── Body: file panel + text panes + vocab panel ── */}
      <div className="translate-body">

        {/* File panel (left, collapsible) */}
        {filePanelOpen && (
          <div className="translate-file-panel">
            <div className="translate-file-toolbar">
              <FileText size={12} style={{ flexShrink: 0, color: "var(--accent-text)" }} />
              <span className="translate-file-name">{fileName}</span>
              <button
                className="translate-pane-btn"
                onClick={handleSendFileToTranslate}
                title="将文件内容填入输入框"
              >
                {t("translate.sendToTranslate")}
              </button>
              <button
                className="translate-pane-btn"
                onClick={() => { setFilePanelOpen(false); setFileText(""); setFileName(""); }}
                title="关闭"
              >
                <X size={12} />
              </button>
            </div>
            <div className="translate-file-content" style={{ fontSize: `${fontSize}px` }}>{fileText}</div>
          </div>
        )}

        {/* Text panes */}
        <div className="translate-panes">

          {/* Source */}
          <div className="translate-pane">
            <div className="translate-pane-header">
              <span className="translate-pane-lang">{sourceLang}</span>
              <div className="translate-pane-actions">
                <span className="translate-char-count">
                  {t("translate.charCount", { count: charCount })}
                </span>
                <button
                  className="translate-pane-btn"
                  onClick={handleClear}
                  disabled={!sourceText}
                >
                  <X size={11} />
                  {t("translate.clear")}
                </button>
              </div>
            </div>
            <textarea
              className="translate-textarea"
              style={{ fontSize: `${fontSize}px` }}
              placeholder={t("translate.sourcePlaceholder")}
              value={sourceText}
              onChange={(e) => handleSourceChange(e.target.value)}
              onMouseUp={handleSourceMouseUp}
            />
          </div>

          {/* Swap */}
          <div className="translate-swap-col">
            <button
              className="translate-swap-btn"
              title={t("translate.swapBtn")}
              onClick={handleSwap}
            >
              <ArrowLeftRight size={14} />
            </button>
          </div>

          {/* Output */}
          <div className="translate-pane">
            <div className="translate-pane-header">
              <span className="translate-pane-lang">{targetLang}</span>
              <div className="translate-pane-actions">
                <button
                  className="translate-pane-btn"
                  onClick={handleCopy}
                  disabled={!outputText}
                >
                  {copied
                    ? <Check size={11} style={{ color: "var(--success)" }} />
                    : <Copy size={11} />}
                  {copied ? "Copied!" : t("translate.copy")}
                </button>
              </div>
            </div>
            {error ? (
              <div className="translate-error">{error}</div>
            ) : (
              <textarea
                className="translate-textarea"
                style={{ fontSize: `${fontSize}px` }}
                placeholder={t("translate.outputPlaceholder")}
                value={outputText}
                readOnly
              />
            )}
          </div>
        </div>

        {/* ── Vocab side panel ── */}
        <div className="translate-vocab-side">
          <div className="translate-vocab-side-header">
            <BookOpen size={12} />
            {t("translate.vocabTitle")}
            {vocabEntries.length > 0 && (
              <span className="translate-panel-count">{vocabEntries.length}</span>
            )}
          </div>

          <div className="translate-vocab-entries">
            {vocabLoading ? (
              <div className="translate-vocab-empty-hint">
                <span>{t("browser.loading")}</span>
              </div>
            ) : vocabEntries.length > 0 ? (
              vocabEntries.map((entry, i) => (
                <div key={i} className="translate-vocab-entry-row">
                  <div className="translate-vocab-entry-top">
                    <span className="translate-vocab-entry-word">{entry.char}</span>
                    {entry.pinyin && (
                      <span className="browser-vocab-pinyin">[{entry.pinyin}]</span>
                    )}
                    {entry.frequency != null && (
                      <span className="vocab-freq-badge">{entry.frequency}</span>
                    )}
                    <button
                      className="btn-ghost"
                      style={{ padding: "1px 4px", marginLeft: "auto" }}
                      onClick={() => speakWord(entry.char)}
                      title="朗读"
                    >
                      <Volume2 size={11} />
                    </button>
                    <button
                      className="btn-ghost"
                      style={{ padding: "1px 4px" }}
                      onClick={() => copyWord(entry.char)}
                      title="复制"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                  {entry.meaning && (
                    <div className="translate-vocab-entry-meaning">{entry.meaning}</div>
                  )}
                </div>
              ))
            ) : (
              <div className="translate-vocab-empty-hint">
                <BookOpen size={20} style={{ opacity: 0.25 }} />
                <span>{t("translate.noVocab")}</span>
              </div>
            )}
          </div>

          {/* History */}
          {wordHistory.length > 0 && (
            <>
              <div className="browser-history-header">
                <span className="browser-history-title">{t("browser.wordHistory")}</span>
                <button
                  className="btn-ghost"
                  style={{ padding: "3px" }}
                  onClick={() => setWordHistory([])}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="browser-history-list">
                {wordHistory.map((item) => (
                  <div
                    key={`${item.word}-${item.timestamp}`}
                    className="browser-history-item"
                    onClick={() => setVocabEntries(item.entries)}
                  >
                    <div className="browser-history-item-info">
                      <div className="browser-history-item-top">
                        <span className="browser-history-word">{item.word}</span>
                        {item.entries[0]?.pinyin && (
                          <span className="browser-history-pinyin">[{item.entries[0].pinyin}]</span>
                        )}
                      </div>
                      {item.entries[0]?.meaning && (
                        <div className="browser-history-meaning">{item.entries[0].meaning}</div>
                      )}
                    </div>
                    <button
                      className="browser-history-copy"
                      onClick={(e) => { e.stopPropagation(); copyWord(item.word); }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
