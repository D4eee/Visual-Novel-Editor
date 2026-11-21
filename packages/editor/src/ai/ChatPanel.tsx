/** The AI assistant panel: slides in from the right, opened from the tab bar. */
import { useEffect, useRef, useState, ReactNode } from 'react';
import { store, useStore, useT } from '../state/store';
import { setPrefs, usePrefs } from '../state/prefs';
import { call } from '../host';
import { Icon } from '../ui/Icon';
import { IconButton, cx, useResizable } from '../ui/controls';
import { AiChat, AiPublicConfig, ChatItem, chatFor, setChatOpen, useChat, useChatOpen } from './agent';

let configCache: AiPublicConfig | null = null;
export async function loadAiConfig(force = false): Promise<AiPublicConfig | null> {
  if (configCache && !force) return configCache;
  try { configCache = await call('ai.config'); } catch { configCache = null; }
  return configCache;
}

export function ChatPanel() {
  const st = useStore();
  const isOpen = useChatOpen();
  const t = useT();
  const prefs = usePrefs();
  const chat = useChat(chatFor(st.session));
  const [text, setText] = useState('');
  const [cfg, setCfg] = useState<AiPublicConfig | null>(configCache);
  const [w, startW] = useResizable('ai.panel', 380, 300, 720);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (isOpen) { loadAiConfig(true).then(setCfg); setTimeout(() => inputRef.current?.focus(), 50); } }, [isOpen, st.dialog]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.items.length, chat.busy, isOpen]);
  if (!isOpen) return null;

  const provider = cfg ? cfg[cfg.provider] : null;
  const ready = !!provider && (provider.hasKey || (cfg?.provider === 'openai' && /localhost|127\.0\.0\.1/.test(provider.baseUrl)));
  const send = (v = text) => { if (!v.trim() || chat.busy) return; chat.send(v); setText(''); };
  const suggestions = st.session ? ['ai.suggest.scene', 'ai.suggest.animate', 'ai.suggest.review', 'ai.suggest.branch'] : ['ai.suggest.howTo', 'ai.suggest.idea'];

  return (
    <aside className="ai-panel" style={{ width: w }} aria-label={t('ai.title')}>
      <div className="ai-resize" onPointerDown={(e) => startW(e, -1)} />
      <header className="ai-head">
        <Icon name="bot" size={17} />
        <div className="ai-title">
          <span>{t('ai.title')}</span>
          {provider && <span className="ai-model" title={provider.baseUrl}>{provider.model || '—'}</span>}
        </div>
        <button type="button" className={cx('ai-mode', prefs.aiMode === 'read' && 'read')} onClick={() => setPrefs({ aiMode: prefs.aiMode === 'read' ? 'edit' : 'read' })} title={t('ai.modeHint')}>
          <Icon name={prefs.aiMode === 'read' ? 'eye' : 'wand'} size={12} />{prefs.aiMode === 'read' ? t('ai.mode.read') : t('ai.mode.edit')}
        </button>
        <IconButton icon="plus" size={15} title={t('ai.newChat')} onClick={() => chat.clear()} disabled={!chat.items.length} />
        <IconButton icon="settings" size={15} title={t('ai.settings')} onClick={() => store.open({ kind: 'settings', tab: 'ai' })} />
        <IconButton icon="close" size={15} title={t('common.close')} onClick={() => setChatOpen(false)} />
      </header>
      <div className="ai-list" ref={listRef}>
        {!chat.items.length && (
          <div className="ai-empty">
            <div className="ai-empty-icon"><Icon name="sparkles" size={22} /></div>
            <p>{st.session ? t('ai.emptyProject') : t('ai.emptyNoProject')}</p>
            {!ready && cfg && (
              <button type="button" className="ai-setup" onClick={() => store.open({ kind: 'settings', tab: 'ai' })}><Icon name="key" size={14} />{t('ai.setupKey')}</button>
            )}
            <div className="ai-suggestions">
              {suggestions.map((k) => <button key={k} type="button" className="chip-btn" onClick={() => send(t(k))}>{t(k)}</button>)}
            </div>
          </div>
        )}
        {chat.items.map((it) => <ChatRow key={it.id} item={it} chat={chat} />)}
        {chat.busy && <div className="ai-thinking"><span /><span /><span /></div>}
      </div>
      <div className="ai-input">
        <textarea ref={inputRef} value={text} rows={Math.min(6, Math.max(2, text.split('\n').length))} placeholder={st.session ? t('ai.placeholder') : t('ai.placeholderNoProject')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        {chat.busy
          ? <button type="button" className="ai-send stop" onClick={() => chat.stop()} title={t('ai.stop')}><Icon name="stop" size={14} /></button>
          : <button type="button" className="ai-send" onClick={() => send()} disabled={!text.trim()} title={`${t('ai.send')} (Enter)`}><Icon name="send" size={15} /></button>}
      </div>
    </aside>
  );
}

function ChatRow({ item, chat }: { item: ChatItem; chat: AiChat }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (item.kind === 'user') return <div className="ai-msg user">{item.text}</div>;
  if (item.kind === 'assistant') return <div className="ai-msg assistant">{renderMarkdown(item.text || '')}</div>;
  if (item.kind === 'error') return (
    <div className="ai-msg error"><Icon name="warning" size={14} /><span>{item.text}</span>
      {(item.errorCode === 'NO_KEY' || item.errorCode === 'NO_MODEL') && <button type="button" className="link" onClick={() => store.open({ kind: 'settings', tab: 'ai' })}>{t('ai.openSettings')}</button>}
    </div>
  );
  if (item.kind === 'turnEnd' && item.turn) return (
    <div className="ai-turn-end">
      <Icon name="check" size={12} /><span>{t('ai.changesMade', { n: item.turn.changes })}</span>
      {item.turn.undone ? <span className="muted">{t('ai.undone')}</span> : <button type="button" className="link" onClick={() => chat.undoTurn(item)}><Icon name="undo" size={12} />{t('ai.undoReply')}</button>}
    </div>
  );
  const tool = item.tool!;
  const label = t(`ai.tool.${tool.name}`) !== `ai.tool.${tool.name}` ? t(`ai.tool.${tool.name}`) : tool.name;
  const summary = toolSummary(tool.input);
  return (
    <div className={cx('ai-tool', tool.isError && 'err', tool.result === undefined && 'running')}>
      <button type="button" className="ai-tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={tool.result === undefined ? 'refresh' : tool.isError ? 'warning' : 'check'} size={12} />
        <span className="ai-tool-name">{label}</span>
        {summary && <span className="ai-tool-sum">{summary}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
      </button>
      {open && <pre className="ai-tool-body">{JSON.stringify(tool.input, null, 2)}{tool.result !== undefined ? `\n→ ${tool.result.length > 2000 ? `${tool.result.slice(0, 2000)}…` : tool.result}` : ''}</pre>}
    </div>
  );
}

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const v = input.name || input.text || input.preset || input.look || input.effect || input.prop || input.type || (Array.isArray(input.lines) ? `${input.lines.length} ×` : '');
  return typeof v === 'string' ? (v.length > 40 ? `${v.slice(0, 40)}…` : v) : '';
}

/** Small Markdown subset: paragraphs, line breaks, lists, **bold**, `code` and ``` blocks. */
function renderMarkdown(src: string): ReactNode {
  const out: ReactNode[] = [];
  const blocks = src.split(/```/);
  blocks.forEach((b, i) => {
    if (i % 2 === 1) { out.push(<pre key={`c${i}`} className="ai-code">{b.replace(/^\w*\n/, '')}</pre>); return; }
    const lines = b.split('\n');
    let list: ReactNode[] = [];
    const flush = () => { if (list.length) { out.push(<ul key={`l${i}-${out.length}`}>{list}</ul>); list = []; } };
    lines.forEach((ln, j) => {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(ln);
      if (m) { list.push(<li key={j}>{inline(m[1])}</li>); return; }
      flush();
      if (ln.trim()) out.push(<p key={`p${i}-${j}`}>{inline(ln.replace(/^#+\s*/, ''))}</p>);
    });
    flush();
  });
  return out;
}
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) => p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>);
}

/** Tab-bar button that opens and closes the panel. */
export function ChatToggle() {
  const t = useT();
  const isOpen = useChatOpen();
  const chat = useChat(chatFor(useStore().session));
  return (
    <button type="button" className={cx('ai-toggle', isOpen && 'active')} onClick={() => setChatOpen(!isOpen)} title={`${t('ai.title')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}J)`} aria-pressed={isOpen}>
      <Icon name="sparkles" size={14} /><span>{t('ai.short')}</span>{chat.busy && <span className="ai-busy-dot" />}
    </button>
  );
}
