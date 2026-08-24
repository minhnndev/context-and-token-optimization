import * as vscode from 'vscode';

export function getSetting<T>(key: string, fallback: T): T {
  const current = vscode.workspace.getConfiguration('tokenLens');
  const inspected = current.inspect<T>(key);
  const explicitlyConfigured = inspected?.globalValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.workspaceFolderValue !== undefined;
  if (explicitlyConfigured) return current.get<T>(key, fallback);

  // One-release compatibility bridge for settings saved under the old product name.
  return vscode.workspace.getConfiguration('tokenOptimization').get<T>(key, fallback);
}
