import type { FastifyInstance } from 'fastify';
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface StylePanelsCleanupDeps {
  vaultPath: string;
}

const V1_FILE_RE = /-v1\.md$/;

export function registerStylePanelsCleanupRoutes(
  app: FastifyInstance,
  deps: StylePanelsCleanupDeps,
): void {
  app.post('/api/config/style-panels/cleanup-legacy', async (_req, reply) => {
    const base = join(deps.vaultPath, '08_experts/style-panel');
    if (!existsSync(base)) {
      return reply.send({ removed: [] });
    }

    const removed: string[] = [];

    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      let st;
      try { st = statSync(full); } catch { continue; }

      if (st.isFile() && entry.endsWith('.md')) {
        // All top-level .md files are considered legacy (v2 panels live under nested dirs)
        try { unlinkSync(full); removed.push(full); } catch { /* ignore */ }
      } else if (st.isDirectory()) {
        // Nested account dir — remove *-v1.md only
        let files: string[];
        try { files = readdirSync(full); } catch { continue; }
        for (const f of files) {
          if (V1_FILE_RE.test(f)) {
            const fp = join(full, f);
            try { unlinkSync(fp); removed.push(fp); } catch { /* ignore */ }
          }
        }
      }
    }

    return reply.send({ removed });
  });
}
