import { runBundlerCron } from "../cron/cron";
import { config } from "dotenv";
import { REDIS_MULTIPLIER_KEY, REWARD_MULTIPLIER, S3_BUCKET, updateArweaveInfo } from "../constants";
import { syncBundlerPeers } from "../cron/syncBundlerPeers";
import { crawlForPeers } from "../cron/crawlForPeers";
import { syncBalances } from "../cron/syncBalances";
import { syncExternalBalances } from "../cron/syncExternalBalances";
import logger from "../logger";
import * as MQ from "bullmq";
import { bundleExecutorQueue, bundleQueue } from "../queues/queues";
import { workerConnection } from "../database/workerConnection.database";
import { redisClient } from "../redis/client";
import retry from "async-retry";
import { s3 } from "../s3/s3";
import { dump } from "../../scripts/dumpBundle"

process.env = { ...process.env, ...config().parsed };
if (!process.env.RUN) process.exit(0);

(async function () {
  await updateArweaveInfo().catch(logger.error);
  await syncBundlerPeers().catch(logger.error);
  await crawlForPeers().catch(logger.error);
  await syncBalances().catch(logger.error);
  await syncExternalBalances().catch(logger.error);
  runBundlerCron();

  const bundleExecutorEvents = new MQ.QueueEvents(bundleExecutorQueue.name)
  bundleExecutorEvents.on("stalled", async ({ jobId }) => {
    const job = await bundleExecutorQueue.getJob(jobId);
    logger.error(`Bundle executor queue job stalled for job id: ${jobId} handling bundle id: ${job.data.bundleId}`);
  });
  bundleExecutorEvents.on("error", (error) => logger.error("Bundle executor queue job errored", error));
  bundleExecutorEvents.on("failed", async ({ jobId }) => {
    const job = await bundleExecutorQueue.getJob(jobId);
    if (!job) return;
    const failedReason = job.stacktrace[job.stacktrace.length - 1];
    await job.log(`${job.name} (#${job.id}) failed with reason - ${failedReason}`);
    logger.error(`${job.name} (#${job.id}) failed with reason - ${failedReason}`);
    if (job.name === "Post bundle") {
      const trx = await workerConnection.transaction();
      const address = /[a-z0-9_-]{43}/i.exec(job.stacktrace[job.stacktrace.length - 1]);
      const txs = [];
      if (address?.length > 0) {
        const txIds = await workerConnection("data_items")
          .where("bundle_id", job.data.bundleId)
          .select("data_item_id")
          .then(r => r.map(row => row.data_item_id));

        for (const id of txIds) {
          if (!await retry(
            async function (bail) {
              return await s3.statObject(S3_BUCKET, id)
                .then(_ => true)
                .catch(e => {
                  if (e.message.toLowerCase().includes("not found")) bail(e);
                });
            }, { retries: 3 }
          ).catch(_ => false)) {
            logger.info(`${id} is dangling in bundle ${job.data.bundleId}`);
            txs.push(id);
          }
        }
      }

      try {
        await trx("data_items")
          .update("bundle_id", trx.raw("null"))
          .whereNotIn("data_item_id", txs)
          .where("bundle_id", "=", job.data.bundleId);

        await job.log(`Reallocated items to item pool in bundle ${job.data.bundleId}`);
        logger.info(`Reallocated items to item pool in bundle ${job.data.bundleId}`);

        const res = await trx("data_items")
          .where("bundle_id", "=", job.data.bundleId)
          .delete()
          .returning<{ data_item_id: string, date_created: string }[]>(["data_item_id", "date_created"]);

        logger.info(`Deleted items ${JSON.stringify(res)}`);

        logger.info(`[WARNING] Deleted ${res} dangling items`);

        await trx("bundles")
          .where("bundle_id", "=", job.data.bundleId)
          .delete();

        await trx.commit();
      } catch (e) {
        await job.log(`Error occurred when reallocating items - ${e}`);
        logger.error(`Error occurred when reallocating items - ${e}`);

        await trx.rollback();
      }


    }
    if (job.returnvalue === false) {
      await job.remove();
      return;
    }
    if (failedReason === "Empty bundle" || failedReason === "Invalid bundle") {
      await job.remove();
      return;
    }
  });


  const bundleQueueEvents = new MQ.QueueEvents(bundleQueue.name);
  bundleQueueEvents.on("completed", async function ({ jobId }) {
    const job = await bundleQueue.getJob(jobId);

    logger.info(`Data seeded for bundle: ${job.data.bundleId}, with tx id: ${job.data.txId}`);
    const multiplier = +await redisClient.get(REDIS_MULTIPLIER_KEY);
    if (multiplier > 1) {
      const newMultiplier = Math.max(+process.env.MIN_MULTIPLIER, multiplier / REWARD_MULTIPLIER);
      logger.verbose(`As tx has seeded - multiplier set to ${newMultiplier}`);

      await redisClient.set(REDIS_MULTIPLIER_KEY, newMultiplier.toString());
    }

    await workerConnection("bundles")
      .where("bundle_id", "=", job.data.bundleId)
      .update("is_seeded", true);
    await redisClient.del(`Bundler_node:tx:${job.data.txId}`);
  });

  bundleQueueEvents.on("failed", async ({ jobId, failedReason }) => {
    const job = await bundleQueue.getJob(jobId);
    await job.log(`Failed with reason - ${failedReason}`);

    await job.log(`Failed at ${new Date().toISOString()}`);
    await redisClient.del(`Bundler_node:tx:${job.data.txId}`);
  });

  bundleQueueEvents.on("delayed", async ({ jobId }) => {
    const job = await bundleQueue.getJob(jobId);
    logger.info(`Delayed job ${job.id} with bundle id ${job.data.bundleId} on attempt ${job.attemptsMade}`);

    const failedReason = job.stacktrace[job.stacktrace.length - 1];

    logger.debug(`Data *NOT* seeded for bundle: ${job.data.bundleId},  with tx id: ${job.data.txId} and error: ${failedReason} - this will be retried in 10 minutes`);
    await job.log(`Data *NOT* seeded for bundle: ${job.data.bundleId},  with tx id: ${job.data.txId} and error: ${failedReason} - this will be retried in 10 minutes`);

    if (failedReason?.toLowerCase().includes("dropped")) {
      await job.extendLock("unique-dropped-token", 30000);
      await redisClient.set("Bundler_node:num_dropped", (+await redisClient.get("Bundler_node:num_dropped") + 1).toString());
      logger.debug(`Transaction dropped: ${job.data.txId}`);
      // const multiplier = +await redisClient.get(REDIS_MULTIPLIER_KEY);
      // const newMultiplier = Math.min(+process.env.MAX_MULTIPLIER, multiplier * REWARD_MULTIPLIER);
      // logger.verbose(`As tx was dropped - multiplier set to ${newMultiplier}`);
      // await redisClient.set(REDIS_MULTIPLIER_KEY, newMultiplier.toString());

      logger.debug(`Transaction dropped for bundle ${job.data.bundleId} - items added to bundle pool`);

      await workerConnection("data_items")
        .where("bundle_id", "=", job.data.bundleId)
        .update("bundle_id", workerConnection.raw("null"))
        .catch(logger.error);

      await workerConnection("bundles")
        .where("bundle_id", "=", job.data.bundleId)
        .delete();


      // await worker.processJob(job, "bundler");
    } else if (job.attemptsMade == 10) {
      await dump(job.id)
    }
  });

})().catch(logger.error);
