import * as fs from 'fs';
import * as path from 'path';

/**
 * Where database backups are written. In Docker this is BACKUP_DIR (bind-mounted
 * to the host's ./backups folder by docker-compose) so backups survive container
 * rebuilds; locally it falls back to ./backups next to the API.
 */
export function backupsDir(): string {
  const dir = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
