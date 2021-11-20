import { Context } from "koa";
import { httpServerConnection } from "../../../database/httpServerConnection.database";
import { redisClient } from "../../../redis/client";
import logger from "../../../logger";

export async function statusRoute(ctx: Context): Promise<void> {
  try {
    const bundles_submitted = await httpServerConnection
      .select<{ estimate: string }[]>(httpServerConnection.raw("reltuples as estimate"))
      .from("pg_class")
      .where("relname", "=", "bundles")
      .first()
      .then(r => +r.estimate);

    const data_entries_processed = await httpServerConnection
      .select<{ estimate: string }[]>(httpServerConnection.raw("reltuples as estimate"))
      .from("pg_class")
      .where("relname", "=", "data_items")
      .first()
      .then(r => +r.estimate);

    const last_24h = +await redisClient.get("Bundler_node:stats:last_24h");

    let longest;
    if (bundles_submitted > 0) longest = await httpServerConnection("bundles")
      .where("is_seeded", "=", false)
      .select<{ bundle_id: string, job_id: number, time_since_created: { hours: number, minutes: number } }>(["bundle_id", "job_id", httpServerConnection.raw("max(now() - date_created) as time_since_created")])
      .groupBy("bundle_id")
      .first()
      .then(r => ({ bundle_id: +r.bundle_id, job_id: +r.job_id, hours_since_created: +(r.time_since_created.hours + r.time_since_created.minutes/60).toFixed(2) }));

    ctx.body = {
      bundles_submitted,
      data_entries_processed,
      last_24h,
      longest
    };

    return;
  } catch (e) {
    logger.error(`Error occurred while getting bundler stats - ${e}`);
    ctx.status = 500;
    return;
  }

}
