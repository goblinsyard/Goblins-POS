import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Public URL prefix for menu pictures (served by the API, so it also works behind Vercel rewrites). */
export const MENU_MEDIA_PREFIX = '/api/media/menu/';

/**
 * Root folder for uploaded files. In Docker this is UPLOAD_DIR (bind-mounted to
 * the host's ./uploads folder by docker-compose) so pictures survive rebuilds.
 */
export function uploadsDir(sub = ''): string {
  const dir = path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_BYTES = 2 * 1024 * 1024;
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  webp: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/**
 * Save a menu picture sent as a data URL (the back office resizes it in the
 * browser first). The file name is generated here, never taken from the client,
 * and the bytes must really be a WebP/JPEG/PNG.
 */
export function saveMenuImage(itemId: string, dataUrl: string): string {
  const m = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) throw new BadRequestException('Send the picture as a WebP, JPEG or PNG image');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]!;
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > MAX_BYTES) throw new BadRequestException('Picture is too large (max 2 MB after resizing)');
  if (!SIGNATURES[ext]!(bytes)) throw new BadRequestException('That file is not a valid image');
  const safeId = itemId.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = `${safeId}-${randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir('menu'), name), bytes);
  return MENU_MEDIA_PREFIX + name;
}

/** Remove a previously saved menu picture (ignores anything outside the menu folder). */
export function deleteMenuImage(url: string | null | undefined) {
  if (!url || !url.startsWith(MENU_MEDIA_PREFIX)) return;
  const name = path.basename(url);
  const file = path.join(uploadsDir('menu'), name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---------------------------------------------------------------------------
// Pictures inside menu exports and database backups
// ---------------------------------------------------------------------------

const MEDIA_NAME = /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/;
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** The picture behind a menu image URL as a data URL (null when missing). */
export function menuImageAsDataUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(MENU_MEDIA_PREFIX)) return null;
  const name = path.basename(url);
  if (!MEDIA_NAME.test(name)) return null;
  const file = path.join(uploadsDir('menu'), name);
  if (!fs.existsSync(file)) return null;
  const ext = name.split('.').pop()!;
  return `data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Write one picture back under its original name (validated like an upload). */
function writeMediaFile(name: string, b64: string): boolean {
  if (!MEDIA_NAME.test(name)) return false;
  const ext = name.split('.').pop()!;
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || !SIGNATURES[ext]!(bytes)) return false;
  fs.writeFileSync(path.join(uploadsDir('menu'), name), bytes);
  return true;
}

const MEDIA_LINE = '-- GOBLINS-MEDIA ';

/**
 * Database backups are plain .sql files from pg_dump. The menu pictures live on
 * disk, so they are appended to the same file as SQL comment lines — psql skips
 * comments, and one file still holds everything.
 */
export function appendMediaToSqlBackup(sqlFile: string): number {
  const dir = uploadsDir('menu');
  const names = fs.readdirSync(dir).filter((n) => MEDIA_NAME.test(n));
  if (!names.length) return 0;
  const fd = fs.openSync(sqlFile, 'a');
  try {
    fs.writeSync(fd, `\n-- Goblins Yard menu pictures (${names.length}) — restored with the database\n`);
    for (const n of names) {
      fs.writeSync(fd, `${MEDIA_LINE}menu/${n} ${fs.readFileSync(path.join(dir, n)).toString('base64')}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return names.length;
}

/** After a restore, put the pictures stored in the backup back on disk. */
export async function restoreMediaFromSqlBackup(sqlFile: string): Promise<number> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: fs.createReadStream(sqlFile), crlfDelay: Infinity });
  let restored = 0;
  for await (const line of rl) {
    if (!line.startsWith(MEDIA_LINE)) continue;
    const rest = line.slice(MEDIA_LINE.length);
    const space = rest.indexOf(' ');
    if (space < 0) continue;
    const rel = rest.slice(0, space);
    if (!rel.startsWith('menu/')) continue;
    if (writeMediaFile(rel.slice(5), rest.slice(space + 1))) restored++;
  }
  return restored;
}

/** For the JSON backup: every menu picture as { name, data }. */
export function allMenuMedia(): { name: string; data: string }[] {
  const dir = uploadsDir('menu');
  return fs.readdirSync(dir).filter((n) => MEDIA_NAME.test(n))
    .map((n) => ({ name: n, data: fs.readFileSync(path.join(dir, n)).toString('base64') }));
}
