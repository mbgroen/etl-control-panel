import { Fragment, type ReactElement } from 'react';

/**
 * Renders Quake 3 / ET colour-coded strings.
 *
 * Server hostnames and player names carry `^n` escapes that select a palette
 * entry. Showing them raw ("^7[^2TTW^7]") is unreadable, and stripping them
 * throws away the identity operators recognise their own server by — so we
 * render them properly instead.
 */

/** The engine palette. Index is the digit after `^`. */
const PALETTE: Record<string, string> = {
  '0': '#1a1a1a',
  '1': '#e5484d',
  '2': '#46c93a',
  '3': '#e5c04a',
  '4': '#4a7fe5',
  '5': '#3fc7d6',
  '6': '#d654c7',
  '7': 'var(--et-white)',
  '8': '#e58f3a',
  '9': '#9aa4ae',
};

/**
 * Maps an escape character to a colour.
 *
 * The engine takes the low three bits of the character code for anything
 * outside 0-9, which is why letters produce colours at all; mirroring that
 * keeps names looking the same in the control panel as they do in game.
 */
function colorFor(char: string): string {
  const direct = PALETTE[char];
  if (direct) return direct;
  const index = (char.charCodeAt(0) - 48) & 7;
  return PALETTE[String(index)] ?? PALETTE['7']!;
}

export interface ColorTextProps {
  value: string;
  className?: string;
  /** Render without colour, e.g. inside a button where colour would mislead. */
  plain?: boolean;
}

export function ColorText({ value, className, plain = false }: ColorTextProps): ReactElement {
  if (!value) return <span className={className}>—</span>;

  if (plain) {
    return <span className={className}>{stripColors(value)}</span>;
  }

  const segments: { text: string; color: string }[] = [];
  let current = PALETTE['7']!;
  let buffer = '';

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    const next = value[i + 1];

    // `^^` is a literal caret, not an escape.
    if (char === '^' && next !== undefined && next !== '^') {
      if (buffer) segments.push({ text: buffer, color: current });
      buffer = '';
      current = colorFor(next);
      i += 1;
      continue;
    }

    buffer += char;
  }
  if (buffer) segments.push({ text: buffer, color: current });

  return (
    // The clean name goes in the title so hover and screen readers get plain text.
    <span className={className} title={stripColors(value)}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          <span style={{ color: segment.color }}>{segment.text}</span>
        </Fragment>
      ))}
    </span>
  );
}

export function stripColors(value: string): string {
  return value.replace(/\^[^^]/g, '');
}
