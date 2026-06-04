'use strict';
// Webview preload — runs inside every webview page, persists across navigation.
// Uses sendToHost so the parent renderer can listen via the ipc-message event.

import { ipcRenderer } from 'electron';

// 1. Intercept ALL link clicks → open in new tab
document.addEventListener(
  'click',
  (e: MouseEvent) => {
    let el = e.target as HTMLElement | null;
    while (el && el.tagName !== 'BODY') {
      if (el.tagName === 'A') {
        const href = ((el as HTMLAnchorElement).href || '').trim();
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          const curBase = window.location.href.split('#')[0];
          const tgtBase = href.split('#')[0];
          if (curBase !== tgtBase) {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.sendToHost('open-new-tab', href);
          }
        }
        return;
      }
      el = el.parentElement;
    }
  },
  true,
);

// 2. Word capture with 300 ms debounce
let _wt: ReturnType<typeof setTimeout> | null = null;
document.addEventListener('mouseup', () => {
  if (_wt) clearTimeout(_wt);
  _wt = setTimeout(() => {
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text && text.length >= 2 && text.length <= 2000) {
      ipcRenderer.sendToHost('word-captured', text);
    }
  }, 300);
});
