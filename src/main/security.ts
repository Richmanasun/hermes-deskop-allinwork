import type { WebContents, WebPreferences } from "electron";
import { pathToFileURL } from "url";

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

type WebviewPreferences = WebPreferences & {
  preloadURL?: string;
};

function parseUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function isAllowedExternalUrl(rawUrl: unknown): rawUrl is string {
  const url = parseUrl(rawUrl);
  return !!url && EXTERNAL_PROTOCOLS.has(url.protocol);
}

export function isAllowedAppNavigationUrl(
  rawUrl: unknown,
  rendererHtmlPath: string,
  devServerUrl?: string,
): rawUrl is string {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  const devServer = parseUrl(devServerUrl);
  if (devServer) {
    return url.origin === devServer.origin;
  }

  const rendererUrl = pathToFileURL(rendererHtmlPath);
  return (
    url.protocol === "file:" && url.href.split("#")[0] === rendererUrl.href
  );
}

export function isAllowedWebviewUrl(rawUrl: unknown): rawUrl is string {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  return url.protocol === "https:" || url.protocol === "http:";
}

export function hardenWebviewPreferences(
  webPreferences: WebviewPreferences,
): void {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
}

export function hardenAttachedWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedWebviewUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event, url) => {
    if (!isAllowedWebviewUrl(url)) {
      event.preventDefault();
    }
  });
}
