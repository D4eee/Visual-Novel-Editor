/**
 * The AI assistant's conversation: sends the chat to the configured model (through the host),
 * runs the editor tools it asks for, and keeps a readable transcript. One conversation per
 * open project; without a project the assistant can only talk.
 */
import { useSyncExternalStore } from 'react';
import type { Project } from '@vne/core';
import { newId, hasSceneData } from '@vne/core';
import { call } from '../host';
import type { ProjectSession } from '../state/session';
import { store } from '../state/store';
import { getPrefs } from '../state/prefs';
import { mcpTools, runTool } from './tools';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: any } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
interface Message { role: 'user' | 'assistant'; content: string | Block[] }

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'turnEnd';
  text?: string;
  tool?: { name: string; input: any; result?: string; isError?: boolean };
  /** turnEnd: the project before / after the reply (for "undo this reply"). */
  turn?: { before: Project; after: Project; changes: number; undone?: boolean };
  errorCode?: string;
}

export interface AiPublicConfig {
  provider: 'anthropic' | 'openai';
  anthropic: { model: string; baseUrl: string; hasKey: boolean; keyHint: string };
  openai: { model: string; baseUrl: string; hasKey: boolean; keyHint: string; preset: string };
  maxTokens: number;
}

const MAX_ROUNDS = 24;

function systemPrompt(session: ProjectSession | null, readOnly: boolean): string {
  const locale = store.i18n.locale;
  const lines = [
    'You are the assistant inside Visual Novel Editor, a desktop editor for branching visual novels.',
    'Projects have chapters; each chapter is a story graph of nodes (scenes, choices, logic) joined by connections. A scene has elements (layers: background, images, characters, text, shapes, buttons, dialogue, free dialogue boxes, choices, audio…), dialogue lines, keyframe animations (a timeline like After Effects) and interaction scripts made of Scratch-style blocks.',
    'You work through the editor tools. Read before you change: call get_project_overview, and get_scene before editing a scene. Use ids from tool results. Positions are stage pixels (x/y is the element\'s anchor point, default the center); the stage size is in the overview.',
    'Every change you make is undoable and the user sees it happen. Make the changes the user asked for; for anything destructive (deleting scenes or elements, replacing lots of text) ask first unless the user clearly asked for it.',
    'When a tool returns an error, fix the call and try again. When you are done, say briefly what you changed (no need to list every tool call).',
    `Reply in the user's language (the editor is set to ${locale === 'zh-CN' ? 'Simplified Chinese' : 'English'}). Write story text in the language the user writes in.`,
  ];
  if (readOnly) lines.push('The user set you to read-only: you can read the project with tools but not change it. Describe changes instead of making them.');
  if (!session) lines.push('No project is open, so there are no tools; answer questions and suggest opening or creating a project.');
  else {
    const tab = session.ui.tabs[session.ui.active];
    const node = tab?.kind === 'node' ? session.project.nodes[tab.nodeId] : null;
    lines.push(`Open project: "${session.project.name}". The user is looking at ${node ? `${hasSceneData(node) ? 'the scene' : 'the node'} "${node.name}" (id ${node.id})` : 'the story graph'}.`);
    if (node && tab?.kind === 'node') {
      const sel = session.sceneUI(node.id).selectedLayers;
      if (sel.length) lines.push(`Selected element ids: ${sel.join(', ')} ("this element" means these).`);
    }
    const selNodes = session.ui.selection.nodes;
    if (selNodes.length) lines.push(`Selected story nodes: ${selNodes.join(', ')}.`);
  }
  return lines.join('\n');
}

export class AiChat {
  items: ChatItem[] = [];
  private messages: Message[] = [];
  busy = false;
  private requestId: string | null = null;
  private cancelled = false;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(readonly session: ProjectSession | null) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private bump() { this.version++; for (const l of this.listeners) l(); }
  private push(item: Omit<ChatItem, 'id'>): ChatItem { const it = { id: newId('msg'), ...item } as ChatItem; this.items = [...this.items, it]; this.bump(); return it; }

  clear(): void {
    if (this.busy) this.stop();
    this.items = [];
    this.messages = [];
    this.bump();
  }

  stop(): void {
    this.cancelled = true;
    if (this.requestId) call('ai.cancel', { requestId: this.requestId }).catch(() => {});
  }

  async send(text: string): Promise<void> {
    text = text.trim();
    if (!text || this.busy) return;
    const session = this.session;
    const readOnly = getPrefs().aiMode === 'read';
    const t = store.t;
    this.push({ kind: 'user', text });
    this.messages.push({ role: 'user', content: text });
    this.busy = true;
    this.cancelled = false;
    this.bump();
    const before = session?.project ?? null;
    const prefix = `${t('ai.historyPrefix')} · `;
    let changes = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (this.cancelled) break;
        this.requestId = newId('req');
        const res: { content: Block[]; stopReason: string } = await call('ai.chat', {
          requestId: this.requestId,
          system: systemPrompt(session, readOnly),
          messages: this.messages,
          tools: session ? mcpTools(readOnly) : [],
        });
        this.requestId = null;
        const content = (res.content || []).filter((b) => b.type !== 'text' || b.text.trim());
        this.messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] });
        for (const b of content) if (b.type === 'text') this.push({ kind: 'assistant', text: b.text });
        const calls = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
        if (!calls.length || this.cancelled) break;
        const results: Block[] = [];
        for (const c of calls) {
          const item = this.push({ kind: 'tool', tool: { name: c.name, input: c.input } });
          const v0 = session?.project;
          const r = session ? runTool(session, c.name, c.input, prefix, readOnly) : { text: 'No project is open.', isError: true };
          if (session && session.project !== v0) changes++;
          item.tool = { ...item.tool!, result: r.text, isError: r.isError };
          this.items = [...this.items];
          this.bump();
          results.push({ type: 'tool_result', tool_use_id: c.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
        }
        this.messages.push({ role: 'user', content: results });
        if (round === MAX_ROUNDS - 1) this.push({ kind: 'error', text: t('ai.tooManySteps') });
      }
      if (this.cancelled) this.push({ kind: 'error', text: t('ai.stopped') });
    } catch (e: any) {
      const msg = String(e?.message || e);
      const code = /NO_KEY/.test(msg) ? 'NO_KEY' : /NO_MODEL/.test(msg) ? 'NO_MODEL' : /CANCELLED/.test(msg) ? 'CANCELLED' : '';
      this.push({ kind: 'error', errorCode: code, text: code === 'NO_KEY' ? t('ai.noKey') : code === 'NO_MODEL' ? t('ai.noModel') : code === 'CANCELLED' ? t('ai.stopped') : t('ai.failed', { error: msg.replace(/^Error:\s*/, '') }) });
      // A failed request leaves the conversation as it was before it (the model never saw it).
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'user' && typeof last.content === 'string' && last.content === text) this.messages.pop();
      else if (last?.role === 'user') this.messages.push({ role: 'assistant', content: [{ type: 'text', text: '(stopped)' }] });
    } finally {
      this.busy = false;
      this.requestId = null;
      if (session && before && session.project !== before) this.push({ kind: 'turnEnd', turn: { before, after: session.project, changes } });
      this.bump();
    }
  }

  /** Put the project back as it was before one reply (itself an undoable step). */
  async undoTurn(item: ChatItem): Promise<void> {
    const s = this.session;
    const turn = item.turn;
    if (!s || !turn || turn.undone) return;
    if (s.project !== turn.after) {
      const ok = await store.confirm(store.t('ai.undoTitle'), store.t('ai.undoChangedSince'), store.t('ai.undoAnyway'), true);
      if (!ok) return;
    }
    s.history.commit(store.t('ai.undoReply'), turn.before);
    item.turn = { ...turn, undone: true };
    this.items = [...this.items];
    this.bump();
  }
}

const chats = new WeakMap<object, AiChat>();
const noProject = {};
export function chatFor(session: ProjectSession | null): AiChat {
  const key = session || noProject;
  let c = chats.get(key);
  if (!c) { c = new AiChat(session); chats.set(key, c); }
  return c;
}

export function useChat(chat: AiChat): AiChat {
  useSyncExternalStore(chat.subscribe, () => chat.version);
  return chat;
}

/* ------------------------------------------------------------------ */
/* Panel open state (shared by the tab-bar button and the panel)        */
/* ------------------------------------------------------------------ */

let open = false;
const openListeners = new Set<() => void>();
export function setChatOpen(v: boolean): void { open = v; try { localStorage.setItem('vne.ai.open', v ? '1' : ''); } catch { /* ignore */ } for (const l of openListeners) l(); }
try { open = localStorage.getItem('vne.ai.open') === '1'; } catch { /* ignore */ }
export function useChatOpen(): boolean { return useSyncExternalStore((fn) => { openListeners.add(fn); return () => { openListeners.delete(fn); }; }, () => open); }
