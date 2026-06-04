import { readFileSync } from "fs";
import path from "path";

// Strip HTML tags and decode common entities
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s{2,}/g, "\n")
    .trim();
}

async function parsePdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse");
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return (data.text as string).trim();
}

async function parseDocx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value as string).trim();
}

async function parsePptx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require("jszip");
  const buffer = readFileSync(filePath);
  const zip = await (JSZip as { loadAsync: (b: Buffer) => Promise<{ files: Record<string, { async: (t: string) => Promise<string> }> }> }).loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? "0");
      const nb = parseInt(b.match(/\d+/)?.[0] ?? "0");
      return na - nb;
    });

  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    // Collect <a:t> text nodes in document order
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    const text = matches
      .map((m) => m.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

async function parseDocxLegacy(_filePath: string): Promise<string> {
  throw new Error(".doc (Word 97-2003) is not supported. Please save as .docx first.");
}

async function parsePptLegacy(_filePath: string): Promise<string> {
  throw new Error(".ppt (PowerPoint 97-2003) is not supported. Please save as .pptx first.");
}

const TEXT_EXTS = new Set([
  "txt","md","markdown","text","csv","tsv","json","jsonl","xml","yaml","yml",
  "js","ts","jsx","tsx","py","rb","java","c","cpp","cs","go","rs","swift","kt",
  "sh","bash","zsh","fish","ps1","bat","ini","toml","conf","log","env",
]);

export async function parseFileToText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).replace(".", "").toLowerCase();

  if (TEXT_EXTS.has(ext)) {
    return readFileSync(filePath, "utf-8");
  }

  switch (ext) {
    case "html":
    case "htm":
      return stripHtml(readFileSync(filePath, "utf-8"));
    case "pdf":
      return parsePdf(filePath);
    case "docx":
      return parseDocx(filePath);
    case "pptx":
      return parsePptx(filePath);
    case "doc":
      return parseDocxLegacy(filePath);
    case "ppt":
      return parsePptLegacy(filePath);
    default:
      // Best-effort: try as UTF-8 text
      return readFileSync(filePath, "utf-8");
  }
}
