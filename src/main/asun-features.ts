// AsunOS feature backends: Vocabulary, 9Router, MyMemory, AIStation

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";

export interface VocabEntry {
  char: string;
  pinyin?: string;
  meaning?: string;
  frequency?: number;
}

const WORD_API = "http://117.72.165.243/dev-api/system/chars/batch";

export async function lookupVocab(words: string | string[]): Promise<VocabEntry[]> {
  const wordList = Array.isArray(words) ? words : [words];
  if (!wordList.length) return [];
  try {
    const res = await fetch(WORD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wordList),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items: Array<{ characters?: string; charTrans?: string; charYb?: string; charNums?: number }> =
      Array.isArray(json?.data) ? json.data : [];
    return items
      .filter(
        (item) =>
          item.characters &&
          item.charTrans &&
          item.charTrans !== "?" &&
          item.charTrans !== "？",
      )
      .map((item) => ({
        char: item.characters ?? wordList[0],
        pinyin: (item.charYb ?? "").trim() || undefined,
        meaning: (item.charTrans ?? "").trim(),
        frequency: item.charNums,
      }));
  } catch {
    return [];
  }
}

// ── 9Router streaming chat ─────────────────────────────────────────────────

let nineRouterAbortController: AbortController | null = null;

export async function streamNineRouterChat(
  messages: Array<{ role: string; content: string }>,
  model: string,
  requestId: string,
  baseUrl: string,
  senderFn: (requestId: string, content: string | null, error?: string) => void,
  apiKey?: string,
): Promise<void> {
  nineRouterAbortController = new AbortController();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: nineRouterAbortController.signal,
    });
    if (!res.ok || !res.body) {
      senderFn(requestId, null, `HTTP ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") {
          senderFn(requestId, null);
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          const content: string | undefined =
            parsed?.choices?.[0]?.delta?.content;
          if (content != null) senderFn(requestId, content);
        } catch {
          // ignore malformed SSE line
        }
      }
    }
    senderFn(requestId, null);
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error && err.name === "AbortError";
    senderFn(requestId, null, isAbort ? undefined : String(err));
  } finally {
    nineRouterAbortController = null;
  }
}

export function abortNineRouterChat(): void {
  nineRouterAbortController?.abort();
  nineRouterAbortController = null;
}

// ── 9Router non-streaming translation ─────────────────────────────────────

export async function translateNineRouter(
  text: string,
  direction: "zh2en" | "en2zh",
  baseUrl: string,
  apiKey?: string,
  model?: string,
): Promise<string> {
  const systemPrompt =
    `You are a professional translator. Translate the following text faithfully. ` +
    `${direction === "zh2en" ? "Chinese to English" : "English to Chinese"}. ` +
    `Output only the translated text, no explanation.`;
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model || "ollamafirst",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        stream: false,
      }),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return (json?.choices?.[0]?.message?.content as string) ?? "";
  } catch {
    return "";
  }
}

// ── MyMemory translation ──────────────────────────────────────────────────

export async function translateMyMemory(
  text: string,
  langpair: string,
): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const json = await res.json();
    return (json?.responseData?.translatedText as string) ?? "";
  } catch {
    return "";
  }
}

// ── AIStation config (in-memory) ──────────────────────────────────────────

let aiStationUrl = "http://100.109.139.92:8080";

export function getAiStationConfig(): { url: string } {
  return { url: aiStationUrl };
}

export function setAiStationConfig(url: string): void {
  aiStationUrl = url;
}

// ── Browser bookmarks (persisted to userData/bookmarks.json) ─────────────

export interface Bookmark {
  label: string;
  url: string;
}

const DEFAULT_BOOKMARKS: Bookmark[] = [
  { label: "🌐 China Daily", url: "http://www.chinadaily.com.cn/" },
  { label: "🌐 ChatGPT", url: "https://chatgpt.com/" },
  { label: "🌐 BS", url: "https://www.baostock.com/mainContent?file=home.md" },
  { label: "🌐 Hugging Face", url: "https://huggingface.co/" },
  { label: "GitHub", url: "https://github.com" },
];

function bookmarksPath(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return join(dir, "bookmarks.json");
}

export function getBookmarks(): Bookmark[] {
  try {
    const raw = readFileSync(bookmarksPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Bookmark[];
  } catch { /* first run or corrupt — fall through to defaults */ }
  return DEFAULT_BOOKMARKS;
}

export function saveBookmarks(bookmarks: Bookmark[]): void {
  writeFileSync(bookmarksPath(), JSON.stringify(bookmarks, null, 2), "utf-8");
}

// ── AIStation service types & API ─────────────────────────────────────────

export interface AiStationService {
  id: string;
  name: string;
  status: "running" | "stopped" | "unknown";
  port?: number;
  description: string;
}

const FALLBACK_SERVICES: AiStationService[] = [
  { id: "comfyui",       name: "ComfyUI",            status: "unknown", port: 8188,  description: "ComfyUI 图像生成" },
  { id: "facefusion",    name: "FaceFusion",          status: "unknown", port: 7860,  description: "FaceFusion 换脸" },
  { id: "meeting",       name: "Meeting Analysis",    status: "unknown", port: 7865,  description: "会议分析" },
  { id: "ted_scroll",    name: "TED Scroll",          status: "unknown", port: 7864,  description: "TED 竖屏视频" },
  { id: "ted_landscape", name: "TED 横屏",            status: "unknown", port: 7866,  description: "TED 横屏视频" },
  { id: "srt_subtitle",  name: "SRT 字幕生成",        status: "unknown", port: 7867,  description: "SRT 字幕生成" },
  { id: "gptsovits",     name: "GPT-SoVITS",          status: "unknown", port: 9874,  description: "GPT-SoVITS 语音合成" },
  { id: "moneyprinter",  name: "MoneyPrinterTurbo",   status: "unknown", port: 8501,  description: "MoneyPrinterTurbo" },
  { id: "f5tts",         name: "F5-TTS",              status: "unknown", port: 7858,  description: "F5-TTS 语音合成" },
  { id: "ollama",        name: "Ollama",              status: "unknown", port: 11434, description: "Ollama 本地 LLM" },
];

export async function listAiStationServices(
  url: string,
): Promise<AiStationService[]> {
  try {
    const res = await fetch(`${url}/services`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return FALLBACK_SERVICES;
    const json = await res.json();

    // Array format (future-proofing): [{id, name, status, port}, ...]
    if (Array.isArray(json)) return json as AiStationService[];

    // Object format returned by AsunStation: { comfyui: {running, pid}, ... }
    if (json && typeof json === "object") {
      return FALLBACK_SERVICES.map((svc) => {
        const info = json[svc.id] as { running?: boolean } | undefined;
        const status: AiStationService["status"] =
          info == null ? "unknown" : info.running ? "running" : "stopped";
        return { ...svc, status };
      });
    }

    return FALLBACK_SERVICES;
  } catch {
    return FALLBACK_SERVICES;
  }
}

export async function controlAiStationService(
  url: string,
  serviceId: string,
  action: "start" | "stop" | "restart",
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${url}/services/${serviceId}/${action}`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: String(err) };
  }
}

export async function getAiStationLogs(
  url: string,
  serviceId: string,
): Promise<string> {
  try {
    const res = await fetch(`${url}/services/${serviceId}/logs?lines=200`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

export async function testAiStationConnection(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    try {
      const res = await fetch(`${url}/services`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
