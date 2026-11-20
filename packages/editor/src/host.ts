/** Client for the host API. Uses Electron IPC when available, otherwise HTTP (browser mode). */

declare global {
  interface Window {
    vneHost?: {
      invoke(name: string, args: unknown): Promise<any>;
      newWindow(): Promise<boolean>;
      onCommand(fn: (cmd: string) => void): () => void;
      setLocale?(locale: string): Promise<boolean>;
      pathForFile(file: File): string;
    };
  }
}

export interface HostInfo {
  mode: 'electron' | 'browser';
  platform: string;
  arch: string;
  home: string;
  userDataDir: string;
  libraryDir: string;
  urlBase: string;
  nativeDialogs: boolean;
  electronVersion: string;
  examplesDir: string;
  /** Packaged app: examples open as a personal copy. */
  examplesReadOnly?: boolean;
  effectPresetsDir?: string;
}

export class HostError extends Error {}

export async function call<T = any>(name: string, args: unknown = {}): Promise<T> {
  if (window.vneHost) {
    try {
      return await window.vneHost.invoke(name, args);
    } catch (err: any) {
      // Electron prefixes messages with "Error invoking remote method ...: Error: "
      throw new HostError(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }
  const res = await fetch(`/api/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  const data = await res.json();
  if (data.error) throw new HostError(data.error);
  return data.result as T;
}

let info: HostInfo | null = null;

export async function hostInfo(): Promise<HostInfo> {
  if (!info) info = await call<HostInfo>('info');
  return info;
}

export function isElectron(): boolean {
  return !!window.vneHost;
}

/** Path of a file dropped from the OS, when the platform exposes it. */
export function droppedPath(file: File): string | null {
  if (window.vneHost) return window.vneHost.pathForFile(file) || null;
  return null;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function joinPath(...parts: string[]): string {
  const sep = parts[0]?.includes('\\') && !parts[0].includes('/') ? '\\' : '/';
  return parts.filter(Boolean).join(sep).replace(/[\\/]+/g, sep);
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
