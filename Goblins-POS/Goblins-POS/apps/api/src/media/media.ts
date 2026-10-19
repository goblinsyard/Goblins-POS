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
