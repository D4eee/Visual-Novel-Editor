import type { GameRuntime } from './game';

type Screen = 'save' | 'load' | 'log' | 'settings' | 'menu' | 'confirm';

/** Title screen, quick menu and system screens (save/load, backlog, settings). */
export class SystemUI {
  private quick: HTMLDivElement;
  private screen: HTMLDivElement | null = null;
  private title: HTMLDivElement | null = null;
  private ending: HTMLDivElement | null = null;
  private current: Screen | null = null;
  private t: (k: string, p?: any) => string;

  constructor(private rt: GameRuntime) {
    this.t = rt.i18n.t;
    this.quick = document.createElement('div');
    this.quick.className = 'vne-quick';
    this.quick.addEventListener('pointerdown', (e) => e.stopPropagation());
    rt.stage.overlay.append(this.quick);
    this.refreshQuick();
    rt.i18n.subscribe(() => { this.refreshQuick(); if (this.current) this.open(this.current); if (this.title) this.showTitle(); });
  }

  get isOpen(): boolean {
    return !!this.screen || !!this.title || !!this.ending;
  }

  get titleVisible(): boolean {
    return !!this.title;
  }

  /** Menus pause the game clock; the ending card does not. */
  get blocksGame(): boolean {
    return !!this.screen;
  }

  refreshQuick(): void {
    const rt = this.rt;
    this.quick.textContent = '';
    const add = (label: string, fn: () => void, on = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (on) b.classList.add('on');
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      this.quick.append(b);
    };
    if (rt.opts.mode === 'game') { add(this.t('rt.save'), () => this.open('save')); add(this.t('rt.load'), () => this.open('load')); }
    add(this.t('rt.log'), () => this.open('log'));
    add(this.t('rt.auto'), () => { rt.autoMode = !rt.autoMode; if (rt.autoMode) rt.scene?.advance(); this.refreshQuick(); }, rt.autoMode);
    add(this.t('rt.skip'), () => { rt.skipMode = !rt.skipMode; if (rt.skipMode) rt.scene?.advance(); this.refreshQuick(); }, rt.skipMode);
    add(this.t('rt.settings'), () => this.open('settings'));
    if (rt.opts.mode === 'game') add(this.t('rt.menu'), () => this.open('menu'));
    this.quick.style.display = this.title ? 'none' : 'flex';
  }

  toast(msg: string): void {
    const el = document.createElement('div');
    el.className = 'vne-toast';
    el.textContent = msg;
    this.rt.stage.overlay.append(el);
    setTimeout(() => el.remove(), 1800);
  }

  closeAll(): void {
    this.screen?.remove();
    this.screen = null;
    this.current = null;
  }

  private makeScreen(title: string): HTMLDivElement {
    this.closeAll();
    const s = document.createElement('div');
    s.className = 'vne-screen';
    s.addEventListener('pointerdown', (e) => e.stopPropagation());
    const h = document.createElement('h2');
    h.textContent = title;
    const close = this.button(this.t('rt.close'), () => this.closeAll(), 'small vne-close');
    s.append(h, close);
    this.rt.stage.overlay.append(s);
    this.screen = s;
    return s;
  }

  private button(label: string, fn: () => void, extra = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `vne-btn ${extra}`;
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  open(which: Screen): void {
    const rt = this.rt;
    if (which === 'save' || which === 'load') {
      const s = this.makeScreen(this.t(which === 'save' ? 'rt.save' : 'rt.load'));
      const grid = document.createElement('div');
      grid.className = 'vne-slots';
      const slots = which === 'load' ? ['auto', '1', '2', '3', '4', '5', '6', '7', '8'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      for (const slot of slots) {
        const data = rt.readSave(slot);
        const b = document.createElement('button');
        b.className = 'vne-slot';
        if (data?.thumb) { const img = document.createElement('img'); img.src = data.thumb; img.alt = ''; b.append(img); }
        else { const e = document.createElement('div'); e.className = 'empty'; e.textContent = this.t('rt.empty'); b.append(e); }
        const label = document.createElement('div');
        label.style.fontWeight = '700';
        label.textContent = slot === 'auto' ? this.t('rt.autosave') : this.t('rt.slot', { n: slot });
        const meta = document.createElement('div');
        meta.style.opacity = '0.7';
        meta.style.fontSize = '13px';
        meta.textContent = data ? `${new Date(data.time).toLocaleString()} · ${data.nodeName}` : '';
        b.append(label, meta);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (which === 'save') { if (rt.saveGame(slot)) { this.toast(this.t('rt.saved')); this.open('save'); } }
          else if (data) rt.loadGame(slot);
        });
        if (which === 'load' && !data) b.disabled = true;
        grid.append(b);
      }
      s.append(grid);
    } else if (which === 'log') {
      const s = this.makeScreen(this.t('rt.log'));
      const log = document.createElement('div');
      log.className = 'vne-log';
      if (!rt.backlog.length) log.textContent = this.t('rt.noLog');
      for (const e of rt.backlog) {
        const row = document.createElement('div');
        row.className = 'entry';
        if (e.kind === 'choice') { row.classList.add('pick'); row.textContent = `→ ${e.text}`; }
        else {
          if (e.name) { const w = document.createElement('span'); w.className = 'who'; w.textContent = e.name; row.append(w); }
          row.append(document.createTextNode(stripTags(e.text)));
        }
        log.append(row);
      }
      s.append(log);
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    } else if (which === 'settings') {
      const s = this.makeScreen(this.t('rt.settings'));
      const grid = document.createElement('div');
      grid.className = 'vne-settings';
      const ps = rt.playerSettings;
      const range = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, fmt?: (v: number) => string) => {
        const l = document.createElement('label');
        l.textContent = label;
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.gap = '12px';
        wrap.style.alignItems = 'center';
        const r = document.createElement('input');
        r.type = 'range';
        r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(value);
        const out = document.createElement('span');
        out.style.minWidth = '64px';
        out.textContent = fmt ? fmt(value) : String(value);
        r.addEventListener('input', () => { const v = Number(r.value); out.textContent = fmt ? fmt(v) : String(v); set(v); });
        wrap.append(r, out);
        grid.append(l, wrap);
      };
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      range(this.t('rt.textSpeed'), ps.textSpeed, 0, 120, 5, (v) => rt.updateSettings({ textSpeed: v }), (v) => (v === 0 ? this.t('rt.instant') : String(v)));
      range(this.t('rt.autoDelay'), ps.autoDelay, 0.3, 6, 0.1, (v) => rt.updateSettings({ autoDelay: v }), (v) => `${v.toFixed(1)}s`);
      range(this.t('rt.master'), ps.volumes.master, 0, 1, 0.05, (v) => rt.updateSettings({ volumes: { ...rt.playerSettings.volumes, master: v } }), pct);
      range(this.t('rt.bgm'), ps.volumes.bgm, 0, 1, 0.05, (v) => rt.updateSettings({ volumes: { ...rt.playerSettings.volumes, bgm: v } }), pct);
      range(this.t('rt.sfx'), ps.volumes.sfx, 0, 1, 0.05, (v) => rt.updateSettings({ volumes: { ...rt.playerSettings.volumes, sfx: v } }), pct);
      range(this.t('rt.voice'), ps.volumes.voice, 0, 1, 0.05, (v) => rt.updateSettings({ volumes: { ...rt.playerSettings.volumes, voice: v } }), pct);
      const ll = document.createElement('label');
      ll.textContent = this.t('rt.language');
      const sel = document.createElement('select');
      for (const [v, label] of [['en', 'English'], ['zh-CN', '简体中文']]) { const o = document.createElement('option'); o.value = v; o.textContent = label; if (ps.locale === v) o.selected = true; sel.append(o); }
      sel.style.fontSize = '18px';
      sel.addEventListener('change', () => rt.updateSettings({ locale: sel.value }));
      grid.append(ll, sel);
      if (rt.project.settings.window.allowFullscreenToggle && document.fullscreenEnabled) {
        const fl = document.createElement('label');
        fl.textContent = this.t('rt.fullscreen');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!document.fullscreenElement;
        cb.addEventListener('change', () => { if (cb.checked) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen().catch(() => {}); rt.updateSettings({ fullscreen: cb.checked }); });
        grid.append(fl, cb);
      }
      s.append(grid);
    } else if (which === 'menu') {
      const s = this.makeScreen(this.t('rt.menu'));
      const col = document.createElement('div');
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.gap = '12px';
      col.append(
        this.button(this.t('rt.resume'), () => this.closeAll()),
        this.button(this.t('rt.save'), () => this.open('save')),
        this.button(this.t('rt.load'), () => this.open('load')),
        this.button(this.t('rt.settings'), () => this.open('settings')),
        this.button(this.t('rt.title'), () => this.confirm(this.t('rt.returnTitle'), () => { this.closeAll(); rt.toTitle(); })),
      );
      if (rt.opts.onQuit) col.append(this.button(this.t('rt.quit'), () => rt.opts.onQuit!()));
      s.append(col);
    }
    this.current = which;
  }

  private confirm(message: string, yes: () => void): void {
    const s = this.makeScreen('');
    const p = document.createElement('p');
    p.style.fontSize = '24px';
    p.textContent = message;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '16px';
    row.append(this.button(this.t('rt.yes'), yes), this.button(this.t('rt.no'), () => this.open('menu')));
    s.append(p, row);
    this.current = 'confirm';
  }

  showTitle(): void {
    const rt = this.rt;
    this.title?.remove();
    const t = document.createElement('div');
    t.className = 'vne-title';
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    const bg = rt.project.settings.titleScreen.backgroundAssetId;
    const url = bg ? rt.assets.url(bg) : null;
    t.style.background = url ? `center / cover no-repeat url("${url}")` : 'radial-gradient(circle at 50% 35%, #2b3360, #0c0d16 70%)';
    if (rt.project.settings.titleScreen.showTitle) {
      const h = document.createElement('h1');
      h.textContent = rt.project.settings.title;
      t.append(h);
    }
    const hasSave = !!rt.readSave('auto') || ['1', '2', '3', '4', '5', '6', '7', '8', '9'].some((s) => rt.readSave(s));
    t.append(this.button(this.t('rt.start'), () => { this.hideTitle(); rt.newGame(); }));
    if (hasSave) {
      if (rt.readSave('auto')) t.append(this.button(this.t('rt.continue'), () => { this.hideTitle(); rt.loadGame('auto'); }));
      t.append(this.button(this.t('rt.load'), () => this.open('load')));
    }
    t.append(this.button(this.t('rt.settings'), () => this.open('settings')));
    if (rt.opts.onQuit) t.append(this.button(this.t('rt.quit'), () => rt.opts.onQuit!()));
    rt.stage.overlay.append(t);
    this.title = t;
    const music = rt.project.settings.titleScreen.musicAssetId;
    if (music) rt.audio.playMusic(music);
    this.refreshQuick();
  }

  hideTitle(): void {
    if (!this.title) return;
    this.title.remove();
    this.title = null;
    this.refreshQuick();
  }

  showEnding(label: string, message: string): Promise<void> {
    return new Promise((resolve) => {
      this.ending?.remove();
      const e = document.createElement('div');
      e.className = 'vne-ending';
      const h = document.createElement('h2');
      h.textContent = label;
      e.append(h);
      if (message) { const p = document.createElement('p'); p.textContent = message; e.append(p); }
      const hint = document.createElement('div');
      hint.style.opacity = '0.6';
      hint.style.marginTop = '24px';
      hint.textContent = this.t('rt.clickToContinue');
      e.append(hint);
      const done = () => { e.remove(); this.ending = null; resolve(); };
      setTimeout(() => e.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); done(); }), 400);
      this.rt.stage.overlay.append(e);
      this.ending = e;
    });
  }

  dispose(): void {
    this.closeAll();
    this.title?.remove();
    this.ending?.remove();
    this.quick.remove();
  }
}

function stripTags(s: string): string {
  return s.replace(/\[\/?(b|i|u|color|size|wave|shake|wait|speed)(=[^\]]*)?\]/gi, '');
}
