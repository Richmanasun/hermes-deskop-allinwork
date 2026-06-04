/* eslint-disable react/no-unknown-property */
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useI18n } from "../../components/useI18n";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Plus,
  X,
  Globe,
  Lock,
  BookOpen,
  MessageSquare,
  Copy,
  Trash2,
  Search,
  Star,
  Check,
  Pencil,
} from "lucide-react";


interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

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

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface BrowserProps {
  profile?: string;
}

type RightPanel = "vocab" | "chat";

let tabIdCounter = 0;
function makeTabId(): string {
  return `tab-${++tabIdCounter}-${Date.now()}`;
}

function makeTab(url: string): Tab {
  return { id: makeTabId(), url, title: url, loading: true, canGoBack: false, canGoForward: false };
}

function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return "https://outlook.cloud.microsoft/mail/?deeplink=mail%2F";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.includes(".") && !s.includes(" ")) return `https://${s}`;
  return `https://outlook.cloud.microsoft/mail/?deeplink=mail%2F`;
}

interface Bookmark {
  label: string;
  url: string;
}



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

export default function Browser({ profile }: BrowserProps): React.JSX.Element {
  const { t } = useI18n();

  const firstTabRef = useRef<Tab | null>(null);
  if (!firstTabRef.current) firstTabRef.current = makeTab("https://outlook.cloud.microsoft/mail/?deeplink=mail%2F");

  const [tabs, setTabs] = useState<Tab[]>([firstTabRef.current]);
  const [activeTabId, setActiveTabId] = useState<string>(firstTabRef.current.id);
  const [urlInput, setUrlInput] = useState("https://outlook.cloud.microsoft/mail/?deeplink=mail%2F");
  const [rightPanel, setRightPanel] = useState<RightPanel>("vocab");

  const [selectedWord, setSelectedWord] = useState<string>("");
  const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [wordHistory, setWordHistory] = useState<WordHistoryItem[]>([]);

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatSessionRef = useRef<string | undefined>(undefined);

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [editingBmIdx, setEditingBmIdx] = useState<number | null>(null);
  const [editingBm, setEditingBm] = useState<Bookmark>({ label: "", url: "" });
  const [addingBm, setAddingBm] = useState(false);
  const [newBm, setNewBm] = useState<Bookmark>({ label: "", url: "" });

  // Drag-to-chat state
  const [panelDropActive, setPanelDropActive] = useState(false);
  const panelDropCountRef = useRef(0);

  // Summarize confirm dialog (for pages that block content reading)
  type SummarizeConfirm = { title: string; url: string };
  const [summarizeConfirm, setSummarizeConfirm] = useState<SummarizeConfirm | null>(null);

  const webviewRefs = useRef<Map<string, HTMLElement>>(new Map());
  const webviewAreaRef = useRef<HTMLDivElement>(null);
  const [wvSize, setWvSize] = useState({ w: 0, h: 0 });
  // tabsRef is kept in sync on every render so ref callbacks can read the latest tabs
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  // Measure the container in real pixels and feed them to the webview as explicit
  // dimensions. CSS height:100% fails here because Chromium won't resolve it
  // against a flex-determined (implicit) parent height.
  useLayoutEffect(() => {
    const area = webviewAreaRef.current;
    if (!area) return;
    const sync = (): void => setWvSize({ w: area.clientWidth, h: area.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    if (activeTab) setUrlInput(activeTab.url);
  }, [activeTab]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    const unsubChunk = window.hermesAPI.onChatChunk((chunk: string) => {
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.streaming)
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        return [...prev, { role: "assistant", content: chunk, streaming: true }];
      });
    });
    const unsubDone = window.hermesAPI.onChatDone((sessionId?: string) => {
      if (sessionId) chatSessionRef.current = sessionId;
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }];
        return prev;
      });
      setChatLoading(false);
    });
    const unsubError = window.hermesAPI.onChatError((error: string) => {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error}` },
      ]);
      setChatLoading(false);
    });
    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, []);

  useEffect(() => {
    const unsub = window.hermesAPI.onBrowserOpenTab((url: string) => {
      const newTab = makeTab(url);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setUrlInput(url);
    });
    return unsub;
  }, []);

  const attachWebviewEvents = useCallback(
    (tabId: string, el: HTMLElement) => {
      const onStartLoading = (): void => {
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, loading: true } : t)),
        );
      };
      const onStopLoading = (): void => {
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, loading: false } : t)),
        );
      };
      const onNavigate = (e: Event): void => {
        const url = (e as CustomEvent & { url: string }).url;
        if (!url) return;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  url,
                  canGoBack:
                    (el as HTMLElement & { canGoBack: () => boolean }).canGoBack?.() ?? false,
                  canGoForward:
                    (el as HTMLElement & { canGoForward: () => boolean }).canGoForward?.() ?? false,
                }
              : t,
          ),
        );
        setActiveTabId((current) => {
          if (current === tabId) setUrlInput(url);
          return current;
        });
      };
      const onTitleUpdate = (e: Event): void => {
        const title = (e as CustomEvent & { title: string }).title;
        if (!title) return;
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, title } : t)),
        );
      };
      const onIpcMessage = (e: Event): void => {
        const ev = e as CustomEvent & { channel: string; args: unknown[] };
        if (ev.channel === "open-new-tab") {
          const url = String(ev.args?.[0] ?? "").trim();
          if (url) {
            const newTab = makeTab(url);
            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(newTab.id);
            setUrlInput(url);
          }
          return;
        }
        if (ev.channel !== "word-captured") return;
        const text = String(ev.args?.[0] ?? "").trim();
        if (!text) return;

        const isChinese = /[一-龥]/.test(text);
        const displayWord = text.length > 60 ? text.slice(0, 60) + "…" : text;

        setSelectedWord(displayWord);
        setRightPanel("vocab");
        setVocabLoading(true);
        setVocabEntries([]);

        let lookupPromise: Promise<VocabEntry[]>;
        if (isChinese) {
          lookupPromise = window.hermesAPI.vocabLookup(text);
        } else {
          const words = extractWords(text);
          if (words.length > 0) {
            // Multi-word selection: query personal vocab DB only (no fallback).
            // WORD_API is the filter — words not in the DB simply won't appear.
            lookupPromise = window.hermesAPI.vocabLookup(words.slice(0, 20));
          } else {
            // Single short word that was filtered by COMMON_WORDS or is < 4 chars:
            // try DB first, fall back to MyMemory for a quick translation.
            const single = text.toLowerCase().slice(0, 50);
            lookupPromise = window.hermesAPI.vocabLookup([single]).then(async (entries) => {
              if (entries.length > 0) return entries;
              const translation = await window.hermesAPI.myMemoryTranslate(text, "en|zh");
              return translation ? [{ char: displayWord, meaning: translation }] : [];
            });
          }
        }

        lookupPromise
          .then((entries) => {
            setVocabEntries(entries);
            setVocabLoading(false);
            setWordHistory((prev) => {
              const filtered = prev.filter((h) => h.word !== displayWord);
              return [{ word: displayWord, timestamp: Date.now(), entries }, ...filtered].slice(0, 50);
            });
          })
          .catch(() => setVocabLoading(false));
      };

      el.addEventListener("did-start-loading", onStartLoading);
      el.addEventListener("did-stop-loading", onStopLoading);
      el.addEventListener("did-navigate", onNavigate);
      el.addEventListener("did-navigate-in-page", onNavigate);
      el.addEventListener("page-title-updated", onTitleUpdate);
      el.addEventListener("ipc-message", onIpcMessage);

      return () => {
        el.removeEventListener("did-start-loading", onStartLoading);
        el.removeEventListener("did-stop-loading", onStopLoading);
        el.removeEventListener("did-navigate", onNavigate);
        el.removeEventListener("did-navigate-in-page", onNavigate);
        el.removeEventListener("page-title-updated", onTitleUpdate);
        el.removeEventListener("ipc-message", onIpcMessage);
      };
    },
    [],
  );

  // React 19 StrictMode (dev) calls every ref callback twice: mount → null →
  // mount. Without a guard, each remount sets el.src again, aborting the
  // in-progress navigation (ERR_ABORTED). initializedTabs tracks which tabs
  // have already received their first src assignment so the second mount is
  // a no-op for navigation while still re-attaching event listeners.
  const webviewRefCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const initializedTabs = useRef<Set<string>>(new Set());

  function getWebviewRef(tabId: string): (el: HTMLElement | null) => void {
    if (!webviewRefCallbacks.current.has(tabId)) {
      webviewRefCallbacks.current.set(tabId, (el: HTMLElement | null) => {
        if (el) {
          webviewRefs.current.set(tabId, el);
          if (!initializedTabs.current.has(tabId)) {
            initializedTabs.current.add(tabId);
            const tab = tabsRef.current.find((t) => t.id === tabId);
            if (tab) (el as HTMLElement & { src: string }).src = tab.url;
          }
          const cleanup = attachWebviewEvents(tabId, el);
          (el as HTMLElement & { __cleanup?: () => void }).__cleanup = cleanup;
        } else {
          const existing = webviewRefs.current.get(tabId);
          if (existing) {
            (existing as HTMLElement & { __cleanup?: () => void }).__cleanup?.();
            webviewRefs.current.delete(tabId);
          }
          // Do NOT delete from webviewRefCallbacks or initializedTabs here.
          // StrictMode cleanup calls null then re-mounts with the same element;
          // keeping both maps intact prevents a redundant navigation on remount.
        }
      });
    }
    return webviewRefCallbacks.current.get(tabId)!;
  }

  const addTab = useCallback(() => {
    const tab = makeTab("https://outlook.cloud.microsoft/mail/?deeplink=mail%2F");
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setUrlInput("https://outlook.cloud.microsoft/mail/?deeplink=mail%2F");
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      initializedTabs.current.delete(tabId);
      webviewRefCallbacks.current.delete(tabId);
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
          setUrlInput(newActive.url);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const navigateUrl = useCallback(() => {
    const url = normalizeUrl(urlInput);
    const el = webviewRefs.current.get(activeTabId);
    if (el) (el as HTMLElement & { src: string }).src = url;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, url, loading: true } : t)),
    );
    setUrlInput(url);
  }, [urlInput, activeTabId]);

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") navigateUrl();
    },
    [navigateUrl],
  );

  const goBack = useCallback(() => {
    const el = webviewRefs.current.get(activeTabId);
    (el as (HTMLElement & { goBack: () => void }) | undefined)?.goBack();
  }, [activeTabId]);

  const goForward = useCallback(() => {
    const el = webviewRefs.current.get(activeTabId);
    (el as (HTMLElement & { goForward: () => void }) | undefined)?.goForward();
  }, [activeTabId]);

  const reload = useCallback(() => {
    const el = webviewRefs.current.get(activeTabId);
    (el as (HTMLElement & { reload: () => void }) | undefined)?.reload();
  }, [activeTabId]);

  const sendChatMessage = useCallback(
    async (text?: string) => {
      const message = (text ?? chatInput).trim();
      if (!message || chatLoading) return;
      setChatInput("");
      const cur = tabs.find((t) => t.id === activeTabId);
      const ctx = cur ? `Current page: ${cur.title} (${cur.url})\n\n` : "";
      setChatMessages((prev) => [...prev, { role: "user", content: message }]);
      setChatLoading(true);
      try {
        await window.hermesAPI.sendMessage(ctx + message, profile, chatSessionRef.current);
      } catch (err) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${String(err)}` },
        ]);
        setChatLoading(false);
      }
    },
    [chatInput, chatLoading, tabs, activeTabId, profile],
  );

  const summarizePage = useCallback(async () => {
    const cur = tabs.find((t) => t.id === activeTabId);
    if (!cur) return;
    const el = webviewRefs.current.get(activeTabId);
    if (!el) {
      sendChatMessage(`请总结这个页面: ${cur.title} (${cur.url})`);
      setRightPanel("chat");
      return;
    }
    try {
      const content = await (el as HTMLElement & {
        executeJavaScript: (code: string) => Promise<string>;
      }).executeJavaScript(
        "(function(){ try{ return document.body ? document.body.innerText.trim().slice(0,4000) : ''; }catch(e){ return ''; } })()"
      );
      if (content && content.length > 200) {
        sendChatMessage(`请总结以下页面内容:\n标题: ${cur.title}\n网址: ${cur.url}\n\n内容:\n${content}`);
        setRightPanel("chat");
      } else {
        setSummarizeConfirm({ title: cur.title, url: cur.url });
      }
    } catch {
      setSummarizeConfirm({ title: cur.title, url: cur.url });
    }
  }, [tabs, activeTabId, sendChatMessage]);

  const confirmSummarize = useCallback(() => {
    if (!summarizeConfirm) return;
    sendChatMessage(`请总结这个页面: ${summarizeConfirm.title} (${summarizeConfirm.url})`);
    setRightPanel("chat");
    setSummarizeConfirm(null);
  }, [summarizeConfirm, sendChatMessage]);

  const handlePanelDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (++panelDropCountRef.current === 1) {
      setPanelDropActive(true);
      setRightPanel("chat");
    }
  }, []);

  const handlePanelDragLeave = useCallback(() => {
    if (--panelDropCountRef.current === 0) setPanelDropActive(false);
  }, []);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    panelDropCountRef.current = 0;
    setPanelDropActive(false);
    const text = e.dataTransfer.getData("text/plain").trim();
    if (!text) return;
    setChatInput((prev) => (prev ? prev + "\n" + text : text));
    setRightPanel("chat");
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, []);

  const clearChat = useCallback(async () => {
    if (chatLoading) await window.hermesAPI.abortChat();
    setChatMessages([]);
    chatSessionRef.current = undefined;
    setChatLoading(false);
  }, [chatLoading]);

  const copyWord = useCallback((word: string) => {
    window.hermesAPI.copyToClipboard(word).catch(() => {});
  }, []);

  const speakWord = useCallback((word: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = /[一-龥]/.test(word) ? "zh-CN" : "en-US";
      window.speechSynthesis.speak(utter);
    }
  }, []);

  const clearHistory = useCallback(() => setWordHistory([]), []);

  // Load bookmarks on mount
  useEffect(() => {
    window.hermesAPI.getBookmarks().then(setBookmarks).catch(() => {});
  }, []);

  const deleteBookmark = useCallback((idx: number) => {
    setBookmarks((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      window.hermesAPI.saveBookmarks(next).catch(() => {});
      return next;
    });
  }, []);

  const startEditBookmark = useCallback((idx: number, bm: Bookmark) => {
    setEditingBmIdx(idx);
    setEditingBm({ ...bm });
  }, []);

  const commitEditBookmark = useCallback(() => {
    if (editingBmIdx === null) return;
    const label = editingBm.label.trim();
    const url = editingBm.url.trim();
    if (!url) { setEditingBmIdx(null); return; }
    setBookmarks((prev) => {
      const next = prev.map((b, i) => (i === editingBmIdx ? { label: label || url, url } : b));
      window.hermesAPI.saveBookmarks(next).catch(() => {});
      return next;
    });
    setEditingBmIdx(null);
  }, [editingBmIdx, editingBm]);

  const addBookmark = useCallback(() => {
    const label = newBm.label.trim();
    const url = newBm.url.trim();
    if (!url) { setAddingBm(false); return; }
    const bm = { label: label || url, url };
    setBookmarks((prev) => {
      const next = [...prev, bm];
      window.hermesAPI.saveBookmarks(next).catch(() => {});
      return next;
    });
    setNewBm({ label: "", url: "" });
    setAddingBm(false);
  }, [newBm]);

  const isHttps = activeTab?.url.startsWith("https://");
  const isBookmarked = activeTab ? bookmarks.some((b) => b.url === activeTab.url) : false;

  const toggleBookmark = useCallback(() => {
    const cur = tabs.find((t) => t.id === activeTabId);
    if (!cur) return;
    setBookmarks((prev) => {
      const already = prev.findIndex((b) => b.url === cur.url);
      const next = already >= 0
        ? prev.filter((_, i) => i !== already)
        : [...prev, { label: cur.title || cur.url, url: cur.url }];
      window.hermesAPI.saveBookmarks(next).catch(() => {});
      return next;
    });
  }, [tabs, activeTabId]);

  return (
    <div className="browser-root">

      {/* Navigation toolbar */}
      <div className="browser-toolbar">
        <button
          className="browser-nav-btn"
          onClick={goBack}
          disabled={!activeTab?.canGoBack}
          title={t("browser.back")}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="browser-nav-btn"
          onClick={goForward}
          disabled={!activeTab?.canGoForward}
          title={t("browser.forward")}
        >
          <ArrowRight size={15} />
        </button>
        <button
          className={`browser-nav-btn${activeTab?.loading ? " spinning" : ""}`}
          onClick={reload}
          title={t("browser.reload")}
        >
          <RotateCw size={15} style={activeTab?.loading ? { animation: "spin 0.8s linear infinite" } : {}} />
        </button>
        <div className="browser-url-bar">
          <span className={`browser-url-icon${isHttps ? " secure" : ""}`}>
            {isHttps ? <Lock size={12} /> : <Globe size={12} />}
          </span>
          <input
            type="text"
            className="browser-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            onFocus={(e) => e.target.select()}
            placeholder={t("browser.urlPlaceholder")}
            spellCheck={false}
          />
          <button className="btn-ghost" style={{ padding: "2px 4px" }} onClick={navigateUrl}>
            <Search size={13} />
          </button>
          <button
            className={`browser-star-btn${isBookmarked ? " active" : ""}`}
            onClick={toggleBookmark}
            title={isBookmarked ? "取消收藏" : "收藏当前页面"}
          >
            <Star size={14} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {/* Bookmarks bar */}
      <div className="browser-bookmarks">
        {bookmarks.map((bm, idx) => (
          editingBmIdx === idx ? (
            <span key={idx} className="browser-bm-edit-inline">
              <input
                className="browser-bm-edit-input"
                value={editingBm.label}
                onChange={(e) => setEditingBm((p) => ({ ...p, label: e.target.value }))}
                placeholder="标签"
                style={{ width: 70 }}
              />
              <input
                className="browser-bm-edit-input"
                value={editingBm.url}
                onChange={(e) => setEditingBm((p) => ({ ...p, url: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") commitEditBookmark(); if (e.key === "Escape") setEditingBmIdx(null); }}
                placeholder="URL"
                style={{ width: 180 }}
                autoFocus
              />
              <button className="browser-bm-icon-btn" onClick={commitEditBookmark} title="保存"><Check size={12} /></button>
              <button className="browser-bm-icon-btn" onClick={() => setEditingBmIdx(null)} title="取消"><X size={12} /></button>
            </span>
          ) : (
            <span key={idx} className="browser-bm-item">
              <button
                className="browser-bookmark-btn"
                onClick={() => {
                  const el = webviewRefs.current.get(activeTabId);
                  if (el) (el as HTMLElement & { src: string }).src = bm.url;
                  setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, url: bm.url, loading: true } : t)));
                  setUrlInput(bm.url);
                }}
                title={bm.url}
              >
                {bm.label}
              </button>
              <span className="browser-bm-actions">
                <button className="browser-bm-icon-btn" onClick={() => startEditBookmark(idx, bm)} title="编辑"><Pencil size={10} /></button>
                <button className="browser-bm-icon-btn danger" onClick={() => deleteBookmark(idx)} title="删除"><X size={10} /></button>
              </span>
            </span>
          )
        ))}

        {/* Add bookmark inline form */}
        {addingBm ? (
          <span className="browser-bm-edit-inline">
            <input
              className="browser-bm-edit-input"
              value={newBm.label}
              onChange={(e) => setNewBm((p) => ({ ...p, label: e.target.value }))}
              placeholder="标签"
              style={{ width: 70 }}
              autoFocus
            />
            <input
              className="browser-bm-edit-input"
              value={newBm.url}
              onChange={(e) => setNewBm((p) => ({ ...p, url: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") addBookmark(); if (e.key === "Escape") setAddingBm(false); }}
              placeholder="https://..."
              style={{ width: 200 }}
            />
            <button className="browser-bm-icon-btn" onClick={addBookmark} title="添加"><Check size={12} /></button>
            <button className="browser-bm-icon-btn" onClick={() => setAddingBm(false)} title="取消"><X size={12} /></button>
          </span>
        ) : (
          <span className="browser-bm-controls">
            <button className="browser-bm-icon-btn" onClick={() => setAddingBm(true)} title="手动添加书签"><Plus size={12} /></button>
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="browser-tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`browser-tab${tab.id === activeTabId ? " active" : ""}`}
            onClick={() => { setActiveTabId(tab.id); setUrlInput(tab.url); }}
            title={tab.title}
          >
            {tab.loading
              ? <RotateCw size={11} style={{ animation: "spin 0.8s linear infinite", flexShrink: 0, color: "var(--accent-text)" }} />
              : <Globe size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
            }
            <span className="browser-tab-title">{tab.title || t("browser.loading")}</span>
            <button
              className="browser-tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              title={t("browser.closeTab")}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button className="browser-tab-new" onClick={addTab} title={t("browser.newTab")}>
          <Plus size={14} />
        </button>
      </div>

      {/* Body: webview area + right panel */}
      <div className="browser-body">
        <div className="browser-webview-area" ref={webviewAreaRef}>
          {tabs.map((tab) => (
            <webview
              key={tab.id}
              ref={getWebviewRef(tab.id) as React.Ref<HTMLElement>}
              allowpopups={true}
              style={{
                display: tab.id === activeTabId ? "flex" : "none",
                width: wvSize.w > 0 ? `${wvSize.w}px` : "100%",
                height: wvSize.h > 0 ? `${wvSize.h}px` : "100%",
              }}
            />
          ))}
        </div>

        <div
          className={`browser-panel${panelDropActive ? " drop-active" : ""}`}
          onDragEnter={handlePanelDragEnter}
          onDragLeave={handlePanelDragLeave}
          onDragOver={handlePanelDragOver}
          onDrop={handlePanelDrop}
        >
          {panelDropActive && (
            <div className="browser-panel-drop-hint">
              <MessageSquare size={22} />
              <span>松开以发送到对话</span>
            </div>
          )}
          <div className="browser-panel-tabs">
            <button
              className={`browser-panel-tab${rightPanel === "vocab" ? " active" : ""}`}
              onClick={() => setRightPanel("vocab")}
            >
              <BookOpen size={13} />
              {t("browser.panelVocab")}
            </button>
            <button
              className={`browser-panel-tab${rightPanel === "chat" ? " active" : ""}`}
              onClick={() => setRightPanel("chat")}
            >
              <MessageSquare size={13} />
              {t("browser.panelChat")}
            </button>
          </div>

          {/* Vocab panel */}
          {rightPanel === "vocab" && (
            <div className="browser-vocab">
              <div className="browser-vocab-current">
                {selectedWord ? (
                  <>
                    <div className="browser-vocab-word-row">
                      <span className="browser-vocab-word">{selectedWord}</span>
                      <button
                        className="btn-ghost"
                        style={{ padding: "4px" }}
                        onClick={() => copyWord(selectedWord)}
                        title={t("browser.copyWord")}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    {vocabLoading ? (
                      <div className="browser-vocab-entries">
                        <span className="browser-vocab-entry" style={{ color: "var(--text-muted)" }}>
                          {t("browser.loading")}
                        </span>
                      </div>
                    ) : (
                      <div className="browser-vocab-entries">
                        {vocabEntries.map((entry, i) => (
                          <div key={i} className="browser-vocab-entry">
                            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                              <span className="browser-vocab-word-en">{entry.char}</span>
                              {entry.pinyin && (
                                <span className="browser-vocab-pinyin">[{entry.pinyin}]</span>
                              )}
                              {entry.frequency != null && (
                                <span className="vocab-freq-badge">{entry.frequency}</span>
                              )}
                              <button
                                className="btn-ghost"
                                style={{ padding: "1px 3px", fontSize: "12px" }}
                                onClick={() => speakWord(entry.char)}
                                title="朗读"
                              >
                                🔊
                              </button>
                            </div>
                            {entry.meaning && (
                              <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "1px" }}>
                                {entry.meaning}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="browser-vocab-empty">
                    <BookOpen size={20} style={{ opacity: 0.3 }} />
                    <span>{t("browser.noWordSelected")}</span>
                  </div>
                )}
              </div>

              <div className="browser-history-header">
                <span className="browser-history-title">{t("browser.wordHistory")}</span>
                {wordHistory.length > 0 && (
                  <button className="btn-ghost" style={{ padding: "3px" }} onClick={clearHistory}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="browser-history-list">
                {wordHistory.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 8px" }}>
                    {t("browser.noHistory")}
                  </p>
                ) : (
                  wordHistory.map((item) => (
                    <div
                      key={`${item.word}-${item.timestamp}`}
                      className="browser-history-item"
                      onClick={() => { setSelectedWord(item.word); setVocabEntries(item.entries); }}
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
                  ))
                )}
              </div>
            </div>
          )}

          {/* Chat panel */}
          {rightPanel === "chat" && (
            <div className="browser-chat">
              <div className="browser-chat-actions">
                <button
                  className="browser-chat-summarize"
                  onClick={summarizePage}
                  disabled={chatLoading}
                >
                  {t("browser.aiSummarize")}
                </button>
                <button
                  className="btn-ghost"
                  style={{ padding: "5px" }}
                  onClick={clearChat}
                  title={t("browser.aiClear")}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="browser-chat-messages">
                {chatMessages.length === 0 && (
                  <div className="browser-chat-empty">
                    <MessageSquare size={24} style={{ opacity: 0.3 }} />
                    <span>{t("browser.aiPlaceholder")}</span>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`browser-bubble ${msg.role}`}
                  >
                    {msg.content}
                    {msg.streaming && (
                      <span style={{
                        display: "inline-block",
                        width: "2px",
                        height: "12px",
                        background: "currentColor",
                        marginLeft: "2px",
                        verticalAlign: "middle",
                        animation: "blink 1s step-end infinite",
                      }} />
                    )}
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>

              <div className="browser-chat-input-row">
                <textarea
                  ref={chatInputRef}
                  className="browser-chat-textarea"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  placeholder={t("browser.aiPlaceholder")}
                  disabled={chatLoading}
                  rows={2}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => sendChatMessage()}
                  disabled={!chatInput.trim() || chatLoading}
                >
                  {t("browser.aiSendBtn")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summarize confirm dialog */}
      {summarizeConfirm && (
        <div className="browser-confirm-overlay">
          <div className="browser-confirm-dialog">
            <div className="browser-confirm-title">该页面可能无法读取内容</div>
            <div className="browser-confirm-body">
              <span className="browser-confirm-url">{summarizeConfirm.title || summarizeConfirm.url}</span>
              <br />
              该页面限制了内容读取，AI 总结可能不够准确。是否仍用 URL 继续总结？
            </div>
            <div className="browser-confirm-actions">
              <button
                className="btn btn-sm"
                onClick={() => setSummarizeConfirm(null)}
              >
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={confirmSummarize}
              >
                仍然总结
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
