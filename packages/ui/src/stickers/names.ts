/**
 * The 14 die-cut stickers from the Figma sticker board, in board order. Each
 * name is the kebab-case file name of an exported SVG in `assets/stickers`
 * (written by `tools/stickers/export_svgs.py`).
 */
export const STICKER_NAMES = [
  'dog',
  'cat',
  'sleepy-moon',
  'cloud',
  'paw-star',
  'sparkle',
  'heart-paw',
  'paw-pin',
  'privacy-shield',
  'love-letter',
  'pet-tag',
  'shooting-star',
  'rainbow',
  'bone',
] as const

export type StickerName = (typeof STICKER_NAMES)[number]
