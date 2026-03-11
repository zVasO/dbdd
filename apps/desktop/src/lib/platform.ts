type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta';

export const IS_MACOS: boolean =
  typeof navigator !== 'undefined'
    ? /Mac/.test(navigator.userAgent)
    : false;

export const PRIMARY_MOD: Modifier = IS_MACOS ? 'meta' : 'ctrl';

const MAC_SYMBOLS: Record<Modifier, string> = {
  ctrl: '\u2303',
  meta: '\u2318',
  alt: '\u2325',
  shift: '\u21E7',
};

const OTHER_SYMBOLS: Record<Modifier, string> = {
  ctrl: 'Ctrl',
  meta: 'Win',
  alt: 'Alt',
  shift: 'Shift',
};

export function getModSymbol(mod: Modifier): string {
  return IS_MACOS ? MAC_SYMBOLS[mod] : OTHER_SYMBOLS[mod];
}

export function getModSeparator(): string {
  return IS_MACOS ? '' : '+';
}
