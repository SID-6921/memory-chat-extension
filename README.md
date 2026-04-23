# Memory Chat Assistant (VS Code Extension)

A sidebar chat extension that keeps a persistent transcript and answers new queries using prior chat context.

## What It Does

- Stores every user + assistant message in persistent extension storage.
- Uses transcript matching to pull relevant prior context into each answer.
- Answers workspace questions such as "what project are we working in".
- Supports command-palette actions for ask, clear transcript, and export transcript.

## Install and Run (Local)

1. Open this folder in VS Code.
2. Install dependencies:
   - `npm install`
3. Build:
   - `npm run compile`
4. Press `F5` to launch an Extension Development Host.
5. Open the **Memory Chat** activity bar icon.

## Package as VSIX

1. `npm install`
2. `npm run compile`
3. `npm run package`
4. Install generated `.vsix` from VS Code command:
   - `Extensions: Install from VSIX...`

## Publish to GitHub

```bash
git init
git add .
git commit -m "feat: initial memory chat extension"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## Notes

- VS Code public APIs do not expose private internal Copilot transcript history.
- This extension keeps its own transcript memory to deliver history-aware responses.
