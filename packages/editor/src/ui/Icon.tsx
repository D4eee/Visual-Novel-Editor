import * as L from 'react-icons/lu';
import type { IconType } from 'react-icons';

/** Icon names used across the editor, mapped to Lucide icons (react-icons/lu). */
const MAP: Record<string, IconType> = {
  play: L.LuPlay, pause: L.LuPause, stop: L.LuSquare, scene: L.LuClapperboard, bolt: L.LuZap, branch: L.LuGitBranch, dice: L.LuDices,
  clock: L.LuClock3, jumpIn: L.LuLogIn, jumpOut: L.LuLogOut, flag: L.LuFlag, note: L.LuStickyNote, module: L.LuPuzzle, plus: L.LuPlus,
  minus: L.LuMinus, close: L.LuX, check: L.LuCheck, trash: L.LuTrash2, copy: L.LuCopy, paste: L.LuClipboardPaste, duplicate: L.LuCopyPlus,
  eye: L.LuEye, eyeOff: L.LuEyeOff, lock: L.LuLock, unlock: L.LuLockOpen, folder: L.LuFolder, folderOpen: L.LuFolderOpen, file: L.LuFile,
  image: L.LuImage, user: L.LuUser, users: L.LuUsers, type: L.LuType, square: L.LuSquare, button: L.LuRectangleHorizontal, target: L.LuCrosshair,
  film: L.LuFilm, music: L.LuMusic, layers: L.LuLayers, sparkles: L.LuSparkles, search: L.LuSearch, settings: L.LuSettings, export: L.LuPackage,
  undo: L.LuUndo2, redo: L.LuRedo2, save: L.LuSave, chevronDown: L.LuChevronDown, chevronRight: L.LuChevronRight, chevronLeft: L.LuChevronLeft,
  chevronUp: L.LuChevronUp, grip: L.LuGripVertical, more: L.LuEllipsis, book: L.LuBookOpen, workflow: L.LuWorkflow, variable: L.LuVariable,
  database: L.LuDatabase, warning: L.LuTriangleAlert, error: L.LuCircleAlert, info: L.LuInfo, globe: L.LuGlobe, keyframe: L.LuDiamond,
  record: L.LuCircleDot, repeat: L.LuRepeat, timeline: L.LuChartNoAxesGantt, script: L.LuBlocks, wand: L.LuWandSparkles, message: L.LuMessageSquareText,
  list: L.LuList, choice: L.LuListChecks, upload: L.LuUpload, download: L.LuDownload, link: L.LuLink, unlink: L.LuUnlink, refresh: L.LuRefreshCw, maximize: L.LuMaximize2,
  fit: L.LuScan, grid: L.LuGrid3X3, magnet: L.LuMagnet, home: L.LuHouse, logo: L.LuFeather, bug: L.LuBug, keyboard: L.LuKeyboard,
  arrowUp: L.LuArrowUp, arrowDown: L.LuArrowDown, arrowRight: L.LuArrowRight, panel: L.LuPanelRight, panelLeft: L.LuPanelLeft, palette: L.LuPalette,
  sliders: L.LuSlidersHorizontal, monitor: L.LuMonitor, apple: L.LuLaptop, windows: L.LuAppWindow, web: L.LuGlobe, external: L.LuExternalLink,
  power: L.LuPower, box: L.LuBox, hash: L.LuHash, text: L.LuTextCursorInput, quote: L.LuQuote, crop: L.LuCrop, anchor: L.LuAnchor, magic: L.LuWand,
  filter: L.LuFilter, curve: L.LuSpline, command: L.LuCommand, skipBack: L.LuSkipBack, star: L.LuStar,
  bookmark: L.LuBookmark, bookmarkPlus: L.LuBookmarkPlus, library: L.LuLibrary,
  game: L.LuGamepad2, backpack: L.LuBackpack, sprite: L.LuGalleryHorizontal, gem: L.LuGem, inherit: L.LuCornerDownRight, tag: L.LuTag,
  images: L.LuImages, listOrdered: L.LuListOrdered, paused: L.LuCirclePause, stack: L.LuSquareStack,
};

export function Icon({ name, size = 16, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const C = MAP[name] || L.LuCircle;
  return <C size={size} className={className} aria-hidden={title ? undefined : true} title={title} />;
}

export function hasIcon(name: string): boolean {
  return name in MAP;
}
