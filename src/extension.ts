import * as vscode from "vscode";
import { MemoryChatViewProvider } from "./memoryChatViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MemoryChatViewProvider(context);

  void provider.trackCurrentWorkspaceVisit();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void provider.trackCurrentWorkspaceVisit();
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("memoryChat.sidebar", provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memoryChat.ask", async () => {
      const question = await vscode.window.showInputBox({
        prompt: "Ask Memory Chat",
        placeHolder: "What project are we working in?"
      });
      if (question && question.trim()) {
        await provider.askFromCommand(question.trim());
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memoryChat.clearHistory", async () => {
      await provider.clearTranscript();
      vscode.window.showInformationMessage("Memory Chat transcript cleared.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memoryChat.exportHistory", async () => {
      const uri = await provider.exportTranscript();
      if (uri) {
        vscode.window.showInformationMessage(`Transcript exported to ${uri.fsPath}`);
      }
    })
  );
}

export function deactivate(): void {
  // No-op
}
