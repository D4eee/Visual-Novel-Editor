const CSS = `
.vne-stage { position: absolute; inset: 0; overflow: hidden; user-select: none; -webkit-user-select: none; }
.vne-frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.vne-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.vne-overlay { position: absolute; inset: 0; font-family: var(--vne-font, system-ui, sans-serif); color: var(--vne-text, #fff); }
.vne-overlay * { box-sizing: border-box; }
.vne-textbox { position: absolute; left: var(--vne-margin); right: var(--vne-margin); height: var(--vne-tb-height);
  background: var(--vne-tb-bg); border: 1px solid var(--vne-tb-border); border-radius: var(--vne-tb-radius);
  padding: var(--vne-tb-pad); display: flex; gap: calc(var(--vne-tb-pad) * 0.8); backdrop-filter: blur(6px);
  transition: opacity .2s ease; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.vne-textbox.pos-bottom { bottom: var(--vne-margin); }
.vne-textbox.pos-top { top: var(--vne-margin); }
.vne-textbox.pos-center { top: 50%; transform: translateY(-50%); }
.vne-textbox.hidden { opacity: 0; pointer-events: none; }
.vne-portrait { flex: 0 0 auto; height: 100%; aspect-ratio: 1; border-radius: calc(var(--vne-tb-radius) * 0.7); object-fit: cover; object-position: top; background: rgba(255,255,255,.06); }
.vne-portrait[hidden] { display: none; }
.vne-tb-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.vne-name { font-weight: 700; font-size: calc(var(--vne-font-size) * 0.92); color: var(--vne-name); margin-bottom: .3em; letter-spacing: .02em; min-height: 1.2em; }
.vne-name:empty { display: none; }
.vne-text { font-size: var(--vne-font-size); line-height: var(--vne-line-height); white-space: pre-wrap; word-break: break-word; overflow: hidden; }
.vne-text .ch { visibility: hidden; }
.vne-text .ch.on { visibility: visible; }
.vne-text .wave { display: inline-block; animation: vne-wave 1.2s ease-in-out infinite; }
.vne-text .shake { display: inline-block; animation: vne-shake .18s linear infinite; }
@keyframes vne-wave { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-0.18em) } }
@keyframes vne-shake { 0% { transform: translate(0,0) } 25% { transform: translate(.04em,-.04em) } 50% { transform: translate(-.04em,.03em) } 75% { transform: translate(.03em,.04em) } }
.vne-next { position: absolute; right: calc(var(--vne-tb-pad) * 0.8); bottom: calc(var(--vne-tb-pad) * 0.5); width: 0; height: 0;
  border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 12px solid var(--vne-name); opacity: 0; animation: vne-bob 1s ease-in-out infinite; }
.vne-textbox.done .vne-next { opacity: .9; }
@keyframes vne-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
.vne-choices { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 14px; width: min(64%, 760px); }
.vne-choice { appearance: none; border: 1px solid rgba(255,255,255,.18); background: var(--vne-choice-bg); color: var(--vne-choice-text);
  font: inherit; font-size: calc(var(--vne-font-size) * 0.95); padding: 16px 26px; border-radius: 12px; cursor: pointer; text-align: center;
  transition: background .15s ease, transform .15s ease; box-shadow: 0 8px 26px rgba(0,0,0,.3); }
.vne-choice:hover:not(:disabled), .vne-choice:focus-visible { background: var(--vne-choice-hover); transform: translateY(-1px); outline: none; }
.vne-choice:disabled { opacity: .45; cursor: not-allowed; }
.vne-choice .num { opacity: .5; margin-right: .6em; font-size: .8em; }
.vne-flash { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.vne-hud { position: absolute; inset: 0; pointer-events: none; }
.vne-hud > * { pointer-events: auto; }
.vne-quick { position: absolute; right: 18px; bottom: 6px; display: flex; gap: 4px; z-index: 5; }
.vne-quick button { appearance: none; background: rgba(0,0,0,.35); border: 0; color: rgba(255,255,255,.78); font: 600 14px system-ui, sans-serif; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.vne-quick button:hover { color: #fff; background: rgba(0,0,0,.6); }
.vne-quick button.on { color: #ffd38a; }
.vne-screen { position: absolute; inset: 0; background: rgba(8,9,16,.86); backdrop-filter: blur(8px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 20; padding: 48px; }
.vne-screen h2 { font-size: 40px; margin: 0 0 24px; font-weight: 700; letter-spacing: .04em; }
.vne-screen .vne-close { position: absolute; top: 24px; right: 32px; }
.vne-btn { appearance: none; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: #fff; font: 600 22px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 12px 28px; border-radius: 10px; cursor: pointer; min-width: 220px; }
.vne-btn:hover, .vne-btn:focus-visible { background: rgba(120,140,255,.35); outline: none; }
.vne-btn.small { min-width: 0; font-size: 16px; padding: 8px 16px; }
.vne-title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; z-index: 15; background-size: cover; background-position: center; }
.vne-title h1 { font-size: 72px; margin: 0 0 36px; text-shadow: 0 6px 30px rgba(0,0,0,.6); letter-spacing: .04em; text-align: center; }
.vne-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; width: 100%; max-width: 1000px; }
.vne-slot { border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); border-radius: 12px; padding: 10px; cursor: pointer; color: #fff; text-align: left; font: 15px system-ui, sans-serif; appearance: none; }
.vne-slot:hover { background: rgba(120,140,255,.22); }
.vne-slot img, .vne-slot .empty { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; background: rgba(0,0,0,.4); display: block; margin-bottom: 8px; }
.vne-slot .empty { display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.4); }
.vne-log { width: 100%; max-width: 980px; flex: 1; overflow: auto; font-size: 22px; line-height: 1.55; padding-right: 12px; }
.vne-log .entry { margin-bottom: 18px; }
.vne-log .who { font-weight: 700; color: var(--vne-name); margin-right: .5em; }
.vne-log .vne-voice { margin-right: .5em; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.08); color: inherit; cursor: pointer; font-size: 12px; vertical-align: middle; }
.vne-log .vne-voice:hover { background: rgba(255,255,255,.2); }
.vne-log .pick { color: #9ab4ff; font-style: italic; }
.vne-settings { display: grid; grid-template-columns: 220px 360px; gap: 18px 28px; align-items: center; font-size: 20px; }
.vne-settings input[type=range] { width: 100%; }
.vne-ending { position: absolute; inset: 0; z-index: 18; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,.82); gap: 18px; animation: vne-fadein .8s ease; }
.vne-ending h2 { font-size: 56px; margin: 0; }
.vne-ending p { font-size: 22px; opacity: .8; max-width: 70%; text-align: center; }
@keyframes vne-fadein { from { opacity: 0 } to { opacity: 1 } }
.vne-error-card { position: absolute; left: 16px; top: 16px; max-width: 60%; background: rgba(120,20,40,.92); color: #fff; font: 14px/1.4 system-ui, sans-serif; padding: 10px 14px; border-radius: 8px; z-index: 30; }
.vne-toast { position: absolute; left: 50%; top: 24px; transform: translateX(-50%); background: rgba(0,0,0,.75); color: #fff; padding: 10px 18px; border-radius: 8px; font: 600 18px system-ui, sans-serif; z-index: 40; animation: vne-fadein .2s ease; }
`;

let injected = false;

export function ensureRuntimeStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-vne', 'runtime');
  style.textContent = CSS;
  document.head.appendChild(style);
}
