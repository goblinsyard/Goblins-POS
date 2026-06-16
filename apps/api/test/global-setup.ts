import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function setup() {
  console.log('\n--- GLOBAL SETUP STARTING ---');
  
  // Set test database environment variables
  process.env.DATABASE_URL = 'postgresql://goblins:goblins_dev_pw@localhost:5433/goblins_pos_test';
  process.env.API_URL = 'http://localhost:3001';
  process.env.PORT = '3001';
  process.env.SEED_ON_START = 'false';

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  console.log('Pushing schema to test database...');
  // Wipe and push schema to test database
  await execAsync(`${npxCmd} prisma db push --accept-data-loss --force-reset`, {
    env: { ...process.env }
  });

  console.log('Seeding test database with demo data...');
  await execAsync(`${npxCmd} tsx prisma/seed.ts`, {
    env: { ...process.env, FORCE_RESEED: 'true' }
  });

  console.log('Starting NestJS server on port 3001...');
  const child = spawn(npxCmd, ['nest', 'start'], {
    env: { ...process.env },
    shell: true,
  });

  // Wait for the server to be ready
  await new Promise<void>((resolve, reject) => {
    let resolved = false;

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('NestJS test server failed to start within 30 seconds'));
      }
    }, 30000);

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(`[TestServer] ${output}`);
      if (output.includes('Goblins API listening on :3001')) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr?.on('data', (data) => {
      const output = data.toString();
      process.stderr.write(`[TestServer Error] ${output}`);
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`NestJS test server exited unexpectedly with code ${code}`));
      }
    });
  });

  console.log('NestJS test server is running.');

  return async () => {
    console.log('Stopping NestJS test server...');
    try {
      if (process.platform === 'win32') {
        // Force kill the process tree on Windows
        await execAsync(`taskkill /pid ${child.pid} /t /f`);
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      console.error('Failed to kill test server process tree:', err);
      child.kill('SIGKILL');
    }
    console.log('NestJS test server stopped.');
  };
}

