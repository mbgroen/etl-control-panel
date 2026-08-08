import { z } from 'zod';

/**
 * The public base URL clients fetch map packages from.
 *
 * Kept in its own module, free of any Docker or env dependency, so the parsing
 * rules can be unit tested without standing up the rest of the server.
 */

/** Matches a URL that already carries a scheme, e.g. `http://`, `https://`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export const baseUrlSchema = z
  .string()
  .trim()
  .max(300)
  // "192.168.1.10:8081" is the obvious thing to type, and it is what the
  // control panel's own hint text renders, but the engine needs a scheme to build a
  // request from. Supply the one it would have had rather than rejecting input
  // that is unambiguous. Anything with a scheme already is left alone, so https
  // and genuinely wrong schemes still reach the check below.
  .transform((value) => (value === '' || HAS_SCHEME.test(value) ? value : `http://${value}`))
  .refine((value) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value), {
    message: 'Must be a full http:// or https:// URL, e.g. http://192.168.1.10:8081',
  })
  // A trailing slash makes the engine build `//etmain/...`, which nginx 404s.
  .transform((value) => value.replace(/\/+$/, ''));
