# Markdown Viewer

[Open Markdown Viewer](https://tsuki321.github.io/markdown-viewer/)

Paste or type Markdown in **Source**, then use the **Preview** tab in the navigation bar to read the rendered document. **Format** tidies common Markdown spacing and syntax. **Copy** copies the Markdown source in either view. The editor saves your latest draft in the current browser.

Use **Display** to adjust the source and preview text independently, wrap long source lines, or choose a light, dark, or system theme. On phones, source lines wrap automatically and long previews scroll with the page. Display settings are saved in your browser.

Use **File** to open Markdown or plain text, download your draft as a `.md` file, or print the preview. Your browser’s print dialog can also save the preview as a PDF.

The preview supports GitHub Flavored Markdown, including tables, task lists, strikethrough, and fenced code blocks. MathJax renders inline and display LaTeX math, including AMS equations, matrices, and aligned expressions.

```markdown
Inline math works with $E = mc^2$ or \(E = mc^2\).

$$
\begin{aligned}
  f(x) &= x^2 + 1 \\
  f'(x) &= 2x
\end{aligned}
$$
```

Use `\[ ... \]` as another display delimiter. See the [MathJax reference](https://docs.mathjax.org/en/v3.2/input/tex/macros/index.html) for supported commands and packages.

Markdown is processed in the browser. The site uses external assets for math rendering and fonts. Images referenced in Markdown can load from their original URLs.

To host a fork, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then push to `main` or run the **Markdown Viewer** workflow from the Actions tab. The workflow publishes the static site and runs a browser smoke test.
