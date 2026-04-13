import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

const PORT = Number(process.env.PORT ?? 3001);

app.listen({ port: PORT, host: "127.0.0.1" })
  .then(() => app.log.info(`listening on :${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
