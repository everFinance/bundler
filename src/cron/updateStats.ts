import { redisClient } from "../redis/client";
import { workerConnection } from "../database/workerConnection.database";
import logger from "../logger";

export async function updateStats(): Promise<void> {
  logger.info("Updating bundler stats...");
  const last_24h = await workerConnection("data_items")
    .count("data_item_id")
    .whereRaw("date_created > now() - interval '1 day'")
    .first()
    .then(r => +r.count);
  await redisClient.set("Bundler_node:stats:last_24h", last_24h.toString());
}
