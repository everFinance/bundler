import { Knex } from "knex";
import logger from "../logger";

function baseLog(x, y): number {
  return Math.log(y) / Math.log(x);
}

export async function praiseMiner(connection: Knex | Knex.Transaction, peer: string): Promise<void> {
  const x: number = await connection("peers").where("peer", "=", peer).select("trust").first().then(r => r.trust);
  const h = 0.001;

  const changed: number = x + ((16 * baseLog(2, x + 1 + h) - 16 * baseLog(2, x + 1 - h)) / (2 * h));
  await connection("peers")
    .where("peer", "=", peer)
    //.update("trust", connection.raw("least(trust + 50, 100)"));
    .update("trust", connection.raw(`least(${changed},100)`))
    .catch(logger.error);
}

export async function punishMiner(connection: Knex | Knex.Transaction, peer: string): Promise<void> {
  await connection("peers")
    .where("peer", "=", peer)
    .update("trust", connection.raw("greatest(0, trust - 1)"))
    .catch(logger.error);

  logger.info(`Punished ${peer}`);
}
