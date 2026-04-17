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
      if (body.word_count_overrides !== undefined) {
        const o = body.word_count_overrides;
        if (typeof o !== 'object' || o === null || Array.isArray(o)) {
          return reply.code(400).send({ error: 'word_count_overrides must be an object' });
        }
        for (const key of ['opening', 'closing', 'article'] as const) {
          const v = (o as Record<string, unknown>)[key];
          if (v === undefined) continue;
          if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            return reply.code(400).send({ error: `word_count_overrides.${key} must be [min, max] numbers` });
          }
        }
      }
      await deps.hardRulesStore.write(body);
      return reply.send({ ok: true });
    },
  );
}
