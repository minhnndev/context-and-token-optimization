import * as vscode from 'vscode';

export function getSetting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('tokenLens').get<T>(key, fallback);
}
