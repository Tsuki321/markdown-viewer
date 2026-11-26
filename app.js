import { formatMarkdown, renderMarkdown } from './markdown.js';

const storageKey = 'markdown-viewer.draft.v1';
const example = [
  '# A field note',
  '',
  'Paste your own Markdown here, then choose **Preview** to read it.',
  '',
  '## The Gaussian integral',
  '',
  String.raw`The bell curve $e^{-x^2}$ has a surprisingly simple area:`,
  '',
  '$$',
  String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}`,
  '$$',
  '',
  '> Try **Format** to tidy headings, lists, and whitespace.',
  '',
  '| Syntax | Result |',
  '| :--- | :--- |',
  '| `**bold**` | **bold** |',
  '| `~~strike~~` | ~~strike~~ |',
  '',
  '- [x] Markdown tables and task lists',
  '- [ ] Add your own notes',
  '',
].join('\n');

const editor = document.querySelector('#markdown-source');
const sourceTab = document.querySelector('#source-tab');
const previewTab = document.querySelector('#preview-tab');
const sourcePanel = document.querySelector('#source-panel');
const previewPanel = document.querySelector('#preview-panel');
const previewContent = document.querySelector('#preview-content');
const emptyPreview = document.querySelector('#empty-preview');
const workspaceMode = document.querySelector('#workspace-mode');
const lineNumbers = document.querySelector('#line-numbers');
const lineCount = document.querySelector('#line-count');
const wordCount = document.querySelector('#word-count');
const saveStatus = document.querySelector('#save-status');
const pasteButton = document.querySelector('#paste-button');
const formatButton = document.querySelector('#format-button');
const copyButton = document.querySelector('#copy-button');
const toast = document.querySelector('#toast');

let renderVersion = 0;
let renderedSource;
let draftVersion = 0;
let isExample = true;
let previousLineCount = 1;
let toastTimeout;

function announce(message) {
  toast.textContent = message;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { toast.textContent = ''; }, 3200);
}

function syncGutter() {
  lineNumbers.style.transform = `translateY(${-editor.scrollTop}px)`;
}

function setCounts() {
  const source = editor.value;
  const lines = source.split('\n').length;
  const words = source.match(/\S+/gu)?.length ?? 0;

  if (lines !== previousLineCount) {
    lineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join('\n');
    previousLineCount = lines;
  }

  lineCount.textContent = `${source ? lines : 0} ${lines === 1 && source ? 'line' : 'lines'}`;
  wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  formatButton.disabled = !source.trim();
  copyButton.disabled = !source;
  syncGutter();
}

function restoreDraft() {
  try {
    const draft = window.localStorage.getItem(storageKey);
    if (draft !== null) {
      isExample = false;
      saveStatus.textContent = 'Saved locally';
      return draft;
    }
  } catch {
    saveStatus.textContent = 'Local saving unavailable';
  }
  return example;
}

function updateDraft() {
  draftVersion += 1;
  isExample = false;
  setCounts();

  try {
    window.localStorage.setItem(storageKey, editor.value);
    saveStatus.textContent = 'Saved locally';
  } catch {
    saveStatus.textContent = 'Local saving unavailable';
  }

  if (!previewPanel.hidden) void updatePreview();
}

async function updatePreview() {
  const source = editor.value;
  const version = ++renderVersion;

  if (source === renderedSource) {
    previewContent.removeAttribute('aria-busy');
    return;
  }

  previewContent.setAttribute('aria-busy', 'true');
  const loading = document.createElement('p');
  loading.textContent = 'Rendering preview…';
  loading.className = 'preview-loading';
  previewContent.replaceChildren(loading);
  renderedSource = undefined;

  try {
    const fragment = source.trim()
      ? await renderMarkdown(source)
      : emptyPreview.content.cloneNode(true);

    if (version !== renderVersion) return;
    previewContent.replaceChildren(fragment);
    previewPanel.scrollTop = 0;
    renderedSource = source;
  } catch (error) {
    if (version !== renderVersion) return;
    console.error('Markdown preview failed', error);
    const message = document.createElement('p');
    message.textContent = 'This document could not be previewed. Switch to Source to keep editing.';
    previewContent.replaceChildren(message);
  } finally {
    if (version === renderVersion) previewContent.removeAttribute('aria-busy');
  }
}

function showView(view, moveFocus = false) {
  const showPreview = view === 'preview';
  sourceTab.setAttribute('aria-selected', String(!showPreview));
  previewTab.setAttribute('aria-selected', String(showPreview));
  sourceTab.tabIndex = showPreview ? -1 : 0;
  previewTab.tabIndex = showPreview ? 0 : -1;
  sourcePanel.hidden = showPreview;
  previewPanel.hidden = !showPreview;
  workspaceMode.textContent = showPreview ? 'Rendered preview' : 'Markdown source';

  if (moveFocus) (showPreview ? previewTab : sourceTab).focus();
  if (showPreview) void updatePreview();
}

async function pasteFromClipboard() {
  const version = draftVersion;
  let text;

  try {
    text = await navigator.clipboard.readText();
  } catch {
    showView('source');
    editor.focus();
    if (isExample) editor.select();
    announce('Use your keyboard or browser menu to paste.');
    return;
  }

  if (!text) {
    announce('There’s no plain text on the clipboard.');
    return;
  }

  if (version !== draftVersion) {
    announce('The draft changed. Choose Paste again to replace it.');
    return;
  }

  showView('source');
  editor.focus();
  editor.select();
  // Preserve the editor's undo history where the browser supports insertText.
  if (!document.execCommand('insertText', false, text)) {
    editor.value = text;
    updateDraft();
  }
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  editor.scrollLeft = 0;
  syncGutter();
  announce('Markdown pasted.');
}

async function formatDraft() {
  const source = editor.value;
  const version = draftVersion;
  try {
    const formatted = await formatMarkdown(source);
    if (version !== draftVersion) return;

    if (formatted === source) {
      announce('Markdown is already formatted.');
      return;
    }

    const { selectionStart, selectionEnd, scrollTop, scrollLeft } = editor;
    editor.value = formatted;
    editor.setSelectionRange(selectionStart, selectionEnd);
    editor.scrollTop = scrollTop;
    editor.scrollLeft = scrollLeft;
    updateDraft();
    announce('Markdown formatted.');
  } catch (error) {
    console.error('Markdown formatting failed', error);
    announce('Couldn’t format this document.');
  }
}

async function copySource() {
  try {
    await navigator.clipboard.writeText(editor.value);
    announce('Markdown copied.');
  } catch {
    showView('source');
    editor.focus();
    editor.select();
    announce('Markdown selected. Use your keyboard or browser menu to copy.');
  }
}

editor.value = restoreDraft();
setCounts();

const platform = navigator.userAgentData?.platform ?? navigator.platform;
if (platform.startsWith('Mac')) document.querySelector('#toggle-shortcut').textContent = '⌘ + Enter';

editor.addEventListener('input', updateDraft);
editor.addEventListener('paste', (event) => {
  if (isExample && event.clipboardData?.getData('text/plain')) editor.select();
});
editor.addEventListener('scroll', syncGutter);
sourceTab.addEventListener('click', () => showView('source'));
previewTab.addEventListener('click', () => showView('preview'));
pasteButton.addEventListener('click', pasteFromClipboard);
formatButton.addEventListener('click', formatDraft);
copyButton.addEventListener('click', copySource);

document.querySelector('.view-switch').addEventListener('keydown', (event) => {
  const isSource = event.target === sourceTab;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    showView(isSource ? 'preview' : 'source', true);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    showView(event.key === 'Home' ? 'source' : 'preview', true);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.repeat) return;
  event.preventDefault();
  if (previewPanel.hidden) {
    showView('preview');
    previewPanel.focus();
  } else {
    showView('source');
    editor.focus();
  }
});
