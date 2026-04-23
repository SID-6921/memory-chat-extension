import * as vscode from "vscode";
import * as path from "path";

type Role = "user" | "assistant";

interface TranscriptEntry {
  id: string;
  role: Role;
  text: string;
  timestamp: string;
}

const TRANSCRIPT_KEY = "memoryChat.transcript";
const QUERY_HISTORY_KEY = "memoryChat.queryHistory";
const MAX_TRANSCRIPT_ITEMS = 400;

export class MemoryChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage(async (message: { type: string; text?: string }) => {
      if (message.type === "ask" && message.text) {
        await this.handleUserQuery(message.text);
      }
      if (message.type === "clear") {
        await this.clearTranscript();
      }
    });

    this.postTranscript();
  }

  public async askFromCommand(question: string): Promise<void> {
    await this.handleUserQuery(question);
    this.view?.show?.(true);
  }

  public async clearTranscript(): Promise<void> {
    await this.context.globalState.update(TRANSCRIPT_KEY, []);
    await this.context.globalState.update(QUERY_HISTORY_KEY, []);
    this.postTranscript();
  }

  public async exportTranscript(): Promise<vscode.Uri | undefined> {
    const entries = this.getTranscript();
    if (!entries.length) {
      vscode.window.showWarningMessage("Nothing to export yet.");
      return undefined;
    }

    const targetFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!targetFolder) {
      vscode.window.showWarningMessage("Open a workspace folder to export transcript.");
      return undefined;
    }

    const fileName = `memory-chat-transcript-${Date.now()}.json`;
    const outPath = vscode.Uri.joinPath(targetFolder, fileName);
    await vscode.workspace.fs.writeFile(outPath, Buffer.from(JSON.stringify(entries, null, 2), "utf8"));
    return outPath;
  }

  private async handleUserQuery(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    const userEntry: TranscriptEntry = {
      id: this.makeId(),
      role: "user",
      text,
      timestamp: new Date().toISOString()
    };

    await this.appendEntry(userEntry);
    await this.appendQueryHistory(text);

    const answer = await this.generateAnswer(text);
    const assistantEntry: TranscriptEntry = {
      id: this.makeId(),
      role: "assistant",
      text: answer,
      timestamp: new Date().toISOString()
    };

    await this.appendEntry(assistantEntry);
    this.postTranscript();
  }

  private async generateAnswer(question: string): Promise<string> {
    const lower = question.toLowerCase();

    if (this.isProjectQuestion(lower)) {
      return this.describeWorkspace();
    }

    if (this.isHistoryQuestion(lower)) {
      return this.describeHistory();
    }

    const relevant = this.getRelevantHistory(question, 4);
    if (relevant.length > 0) {
      const lines = relevant.map((entry) => `- ${entry.role}: ${entry.text}`);
      return [
        "I looked through our transcript and found related context:",
        ...lines,
        "Ask a follow-up and I will keep building from this context."
      ].join("\n");
    }

    return [
      "Saved. I do not have a strong historical match yet, but your message is now part of memory.",
      "Try asking about project, workspace, or recent topics and I will answer using stored transcript."
    ].join("\n");
  }

  private isProjectQuestion(lower: string): boolean {
    return /(project|workspace|repo|repository|where are we working|current folder)/.test(lower);
  }

  private isHistoryQuestion(lower: string): boolean {
    return /(history|what did we discuss|what did i ask|transcript|recent chat)/.test(lower);
  }

  private describeWorkspace(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return "No workspace folder is open right now. Open a folder and I can name the project and files.";
    }

    const names = folders.map((f) => f.name).join(", ");
    const activeFile = vscode.window.activeTextEditor?.document.fileName;
    const activePart = activeFile ? ` Active file: ${path.basename(activeFile)}.` : "";
    return `You are currently working in workspace folder(s): ${names}.${activePart}`;
  }

  private describeHistory(): string {
    const transcript = this.getTranscript();
    if (transcript.length === 0) {
      return "Transcript is empty so far.";
    }

    const recent = transcript.slice(-6).map((entry) => `${entry.role}: ${entry.text}`);
    return [
      `I have ${transcript.length} stored transcript messages.`,
      "Most recent:",
      ...recent
    ].join("\n");
  }

  private getRelevantHistory(question: string, limit: number): TranscriptEntry[] {
    const transcript = this.getTranscript();
    const qTokens = this.tokenize(question);

    const scored = transcript
      .map((entry) => {
        const entryTokens = Array.from(this.tokenize(entry.text));
        const score = entryTokens.filter((token: string) => qTokens.has(token)).length;
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.entry);

    return scored;
  }

  private tokenize(value: string): Set<string> {
    return new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );
  }

  private getTranscript(): TranscriptEntry[] {
    return this.context.globalState.get<TranscriptEntry[]>(TRANSCRIPT_KEY, []);
  }

  private async appendEntry(entry: TranscriptEntry): Promise<void> {
    const current = this.getTranscript();
    const next = [...current, entry].slice(-MAX_TRANSCRIPT_ITEMS);
    await this.context.globalState.update(TRANSCRIPT_KEY, next);
  }

  private async appendQueryHistory(question: string): Promise<void> {
    const current = this.context.globalState.get<string[]>(QUERY_HISTORY_KEY, []);
    const next = [...current, question].slice(-MAX_TRANSCRIPT_ITEMS);
    await this.context.globalState.update(QUERY_HISTORY_KEY, next);
  }

  private postTranscript(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      type: "transcript",
      entries: this.getTranscript()
    });
  }

  private makeId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.makeId().replace(/[^a-z0-9]/gi, "");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Memory Chat</title>
  <style>
    :root {
      --bg: #122021;
      --bg-soft: #1b2f30;
      --panel: #f4efe4;
      --text: #112021;
      --text-quiet: #405355;
      --user: #0d6b6f;
      --assistant: #f4efe4;
      --assistant-border: #d5c9b8;
      --accent: #f18f01;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 20% 10%, #2c4a4c 0%, transparent 40%),
        linear-gradient(160deg, #132528 0%, #0b1516 100%);
      color: var(--panel);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
    }

    .title {
      font-size: 15px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #ecdcc7;
    }

    .chat {
      flex: 1;
      overflow: auto;
      border: 1px solid #355052;
      border-radius: 12px;
      padding: 10px;
      background: rgba(11, 21, 22, 0.35);
      backdrop-filter: blur(3px);
    }

    .entry {
      margin: 0 0 10px;
      padding: 8px 10px;
      border-radius: 10px;
      line-height: 1.4;
      animation: popIn 180ms ease;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .entry.user {
      background: var(--user);
      color: #f7f8f8;
    }

    .entry.assistant {
      background: var(--assistant);
      color: var(--text);
      border: 1px solid var(--assistant-border);
    }

    .meta {
      font-size: 11px;
      margin-top: 4px;
      color: var(--text-quiet);
    }

    .inputRow {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }

    textarea {
      width: 100%;
      resize: vertical;
      min-height: 56px;
      max-height: 160px;
      border: 1px solid #446466;
      border-radius: 10px;
      padding: 10px;
      background: var(--bg-soft);
      color: #f6f1e8;
      font: inherit;
    }

    button {
      border: 0;
      border-radius: 10px;
      padding: 0 14px;
      background: var(--accent);
      color: #1d1303;
      font-weight: 700;
      cursor: pointer;
    }

    .toolbar {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .ghost {
      background: transparent;
      border: 1px solid #5c7f82;
      color: #e5d8c4;
      padding: 6px 10px;
    }

    @keyframes popIn {
      from { transform: translateY(6px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="title">Memory Chat Assistant</div>
  <div class="toolbar">
    <button id="clearBtn" class="ghost">Clear</button>
    <div id="count" aria-live="polite"></div>
  </div>
  <div class="chat" id="chat" aria-live="polite"></div>
  <div class="inputRow">
    <textarea id="prompt" placeholder="Ask anything. I will use full transcript memory."></textarea>
    <button id="sendBtn">Send</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const prompt = document.getElementById("prompt");
    const sendBtn = document.getElementById("sendBtn");
    const clearBtn = document.getElementById("clearBtn");
    const count = document.getElementById("count");

    function send() {
      const text = prompt.value.trim();
      if (!text) return;
      vscode.postMessage({ type: "ask", text });
      prompt.value = "";
      prompt.focus();
    }

    function render(entries) {
      chat.innerHTML = "";
      for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "entry " + entry.role;
        row.textContent = entry.text;

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = entry.role + " • " + new Date(entry.timestamp).toLocaleTimeString();
        row.appendChild(meta);
        chat.appendChild(row);
      }
      count.textContent = entries.length + " msgs";
      chat.scrollTop = chat.scrollHeight;
    }

    sendBtn.addEventListener("click", send);
    clearBtn.addEventListener("click", () => vscode.postMessage({ type: "clear" }));
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "transcript") {
        render(msg.entries || []);
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
