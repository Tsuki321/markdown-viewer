import { formatMarkdown, renderMarkdown } from './markdown.js';

const storageKey = 'markdown-viewer.draft.v1';
const settingsKey = 'markdown-viewer.display.v1';
const defaultSettings = { sourceSize: 100, previewSize: 100, wrap: 'auto', theme: 'system' };
const fontSize = { min: 80, max: 180, step: 10 };
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
const workspace = document.querySelector('.workspace');
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
const fileInput = document.querySelector('#markdown-file');
const downloadButton = document.querySelector('#download-file');
const printButton = document.querySelector('#print-preview');
const wrapSetting = document.querySelector('#wrap-setting');
const themeSetting = document.querySelector('#theme-setting');
const fontSteppers = document.querySelectorAll('[data-font-setting]');
const menuDisclosures = document.querySelectorAll('.toolbar-menu, .format-help');
const touchLayout = window.matchMedia('(max-width: 640px), (pointer: coarse)');
const readingLayout = window.matchMedia('(max-width: 640px), (pointer: coarse) and (max-height: 560px)');
const lightTheme = window.matchMedia('(prefers-color-scheme: light)');

let renderVersion = 0;
let renderedSource;
let renderingSource;
let previewTask;
let draftVersion = 0;
let isExample = true;
let previousLineCount = 1;
let toastTimeout;
let settings = restoreSettings();

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
  downloadButton.disabled = !source;
  printButton.disabled = !source.trim();
  syncGutter();
}

function restoreSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(settingsKey));
    if (!saved) return { ...defaultSettings };

    return {
      sourceSize: validSize(saved.sourceSize),
      previewSize: validSize(saved.previewSize),
      wrap: ['auto', 'on', 'off'].includes(saved.wrap) ? saved.wrap : defaultSettings.wrap,
      theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : defaultSettings.theme,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function validSize(size) {
  return Number.isInteger(size) && size >= fontSize.min && size <= fontSize.max && size % fontSize.step === 0
    ? size : 100;
}

function applySettings() {
  const light = settings.theme === 'light' || (settings.theme === 'system' && lightTheme.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = light ? '#f3f6ee' : '#121b16';
  workspace.style.setProperty('--source-scale', settings.sourceSize / 100);
  workspace.style.setProperty('--preview-scale', settings.previewSize / 100);

  const wrap = settings.wrap === 'on' || (settings.wrap === 'auto' && touchLayout.matches);
  editor.wrap = wrap ? 'soft' : 'off';
  sourcePanel.classList.toggle('wrap-source', wrap);
  lineNumbers.parentElement.hidden = wrap;
  if (wrap) editor.scrollLeft = 0;
  syncGutter();

  wrapSetting.value = settings.wrap;
  themeSetting.value = settings.theme;
  for (const stepper of fontSteppers) {
    const size = settings[stepper.dataset.fontSetting];
    stepper.querySelector('output').value = `${size}%`;
    stepper.querySelector('[data-step="-1"]').setAttribute('aria-disabled', String(size === fontSize.min));
    stepper.querySelector('[data-step="1"]').setAttribute('aria-disabled', String(size === fontSize.max));
  }
}

function saveSettings() {
  applySettings();
  try {
    window.localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    announce('Display settings will reset when you close this page.');
  }
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

function updatePreview() {
  const source = editor.value;
  if (source === renderedSource) return Promise.resolve(true);
  if (source === renderingSource) return previewTask;
  renderingSource = source;
  previewTask = displayPreview(source, ++renderVersion);
  return previewTask;
}

async function displayPreview(source, version) {
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

    if (version !== renderVersion) return false;
    previewContent.replaceChildren(fragment);
    previewPanel.scrollTop = 0;
    renderedSource = source;
    return true;
  } catch (error) {
    if (version !== renderVersion) return false;
    console.error('Markdown preview failed', error);
    const message = document.createElement('p');
    message.textContent = 'This document could not be previewed. Switch to Source to keep editing.';
    previewContent.replaceChildren(message);
    return false;
  } finally {
    if (version === renderVersion) {
      renderingSource = undefined;
      previewContent.removeAttribute('aria-busy');
    }
  }
}

function showView(view, moveFocus = false) {
  const showPreview = view === 'preview';
  if (workspace.dataset.view !== view && readingLayout.matches) window.scrollTo(0, 0);
  workspace.dataset.view = view;
  sourceTab.setAttribute('aria-selected', String(!showPreview));
  previewTab.setAttribute('aria-selected', String(showPreview));
  sourceTab.tabIndex = showPreview ? -1 : 0;
  previewTab.tabIndex = showPreview ? 0 : -1;
  sourcePanel.hidden = showPreview;
  previewPanel.hidden = !showPreview;
  workspaceMode.textContent = showPreview ? 'Rendered preview' : 'Markdown source';

  if (moveFocus) (showPreview ? previewTab : sourceTab).focus();
  if (showPreview) return updatePreview();
  syncGutter();
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
    announce('The draft changed. Choose Paste again to insert the clipboard text.');
    return;
  }

  showView('source');
  editor.focus();
  if (isExample) editor.select();
  const { selectionStart, selectionEnd } = editor;
  // Preserve the editor's undo history where the browser supports insertText.
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, selectionStart, selectionEnd, 'end');
    updateDraft();
  }
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

async function openFile() {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  const version = draftVersion;

  try {
    const text = await file.text();
    if (version !== draftVersion) {
      announce('The draft changed while the file was opening. Choose the file again.');
      return;
    }
    if (editor.value && !isExample && !window.confirm('Replace the current draft with this file?')) return;

    showView('source');
    editor.value = text;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    updateDraft();
    sourceTab.focus({ preventScroll: true });
    announce(`Opened ${file.name}.`);
  } catch (error) {
    console.error('Could not open the file', error);
    announce('Couldn’t read this file.');
  }
}

function downloadMarkdown() {
  const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const heading = editor.value.match(/^ {0,3}# +(.+)$/m)?.[1] ?? '';
  const filename = heading.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  link.download = `${filename || 'document'}.md`;
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function printPreview() {
  if (await showView('preview')) {
    await document.fonts.ready;
    if (!previewPanel.hidden && renderedSource === editor.value) window.print();
  } else {
    announce('Couldn’t prepare the preview for printing.');
  }
}

function closeMenu(menu, focus = false) {
  menu.open = false;
  if (focus) menu.querySelector('summary').focus();
}

editor.value = restoreDraft();
setCounts();
applySettings();

const platform = navigator.userAgentData?.platform ?? navigator.platform;
if (platform?.startsWith('Mac')) document.querySelector('#toggle-shortcut').textContent = '⌘ + Enter';

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

const fileMenu = document.querySelector('#file-menu');
document.querySelector('#open-file').addEventListener('click', () => {
  fileInput.click();
  closeMenu(fileMenu, true);
});
fileInput.addEventListener('change', openFile);
downloadButton.addEventListener('click', () => {
  downloadMarkdown();
  closeMenu(fileMenu, true);
  announce('Markdown download started.');
});
printButton.addEventListener('click', () => {
  closeMenu(fileMenu, true);
  void printPreview();
});

for (const stepper of fontSteppers) {
  stepper.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-step]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    settings[stepper.dataset.fontSetting] += Number(button.dataset.step) * fontSize.step;
    saveSettings();
  });
}
wrapSetting.addEventListener('change', () => { settings.wrap = wrapSetting.value; saveSettings(); });
themeSetting.addEventListener('change', () => { settings.theme = themeSetting.value; saveSettings(); });
document.querySelector('#reset-display').addEventListener('click', () => {
  settings = { ...defaultSettings };
  saveSettings();
  announce('Display settings reset.');
});
touchLayout.addEventListener('change', applySettings);
lightTheme.addEventListener('change', applySettings);

document.addEventListener('click', (event) => {
  for (const menu of menuDisclosures) {
    if (menu.open && !menu.contains(event.target)) closeMenu(menu);
  }
});

for (const menu of menuDisclosures) {
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      closeMenu(menu, true);
      event.preventDefault();
    }
  });
}

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
