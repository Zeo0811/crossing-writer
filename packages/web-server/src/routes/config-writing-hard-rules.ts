import type { FastifyInstance } from 'fastify';
import type { HardRulesStore, WritingHardRules } from '../services/hard-rules-store.js';

export interface WritingHardRulesDeps {
  hardRulesStore: HardRulesStore;
}

export function registerWritingHardRulesRoutes(app: FastifyInstance, deps: WritingHardRulesDeps): void {
  app.get('/api/config/writing-hard-rules', async (_req, reply) => {
    const rules = await deps.hardRulesStore.read();
    return reply.send(rules);
  });

  app.put<{ Body: WritingHardRules }>(
    '/api/config/writing-hard-rules',
    async (req, reply) => {
      const body = req.body;
      if (!body || body.version !== 1) {
        return reply.code(400).send({ error: 'version must be 1' });
      }
      if (!Array.isArray(body.banned_phrases)
          || !Array.isArray(body.banned_vocabulary)
          || !Array.isArray(body.layout_rules)) {
        return reply.code(400).send({ error: 'banned_phrases, banned_vocabulary, layout_rules must be arrays' });
      }
      await deps.hardRulesStore.write(body);
      return reply.send({ ok: true });
    },
  );
}
