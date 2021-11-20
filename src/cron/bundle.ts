import logger from "../logger";
import {
  currentBlockHeight,
  currentMultiplier,
} from "../constants";
import { bundleExecutorQueue, bundleQueue } from "../queues/queues";
import { workerConnection } from "../database/workerConnection.database";
import { Job } from "bullmq";
import { config } from "dotenv";
import { postBundle } from "../bundle/postBundle";

process.env = { ...process.env, ...config().parsed }

const MINIMUM_BUNDLE_LENGTH = process.env.MINIMUM_BUNDLE_LENGTH ? +process.env.MINIMUM_BUNDLE_LENGTH : 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export let bundlerLocked = false;

export async function bundleItems(): Promise<void> {
  logger.info("Starting bundleItems...");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let itemsLeft = await workerConnection("data_items")
      .count("data_item_id")
      .whereRaw("bundle_id is null")
      .first()
      .then(r => {
        logger.verbose(`${r.count} left to bundle - need ${MINIMUM_BUNDLE_LENGTH} to bundle`);
        return r.count >= MINIMUM_BUNDLE_LENGTH;
      })
      .catch(logger.error) as boolean;

    if (!itemsLeft) logger.info("Nothing to bundle");

    while (itemsLeft) {
      bundlerLocked = true;
      try {
        logger.info("Bundling data items");
        await workerConnection.raw("call create_new_batch();");

        const bundleId = await workerConnection
          .max("bundle_id")
          .from("bundles")
          .first()
          .then(r => +r.max);

        const txCount: number = await workerConnection("data_items")
          .where({
            bundle_id: bundleId,
          })
          .count("data_item_id")
          .first()
          .then(r => +r.count);
        logger.info(`${txCount} data items bundled into bundle ${bundleId}`);

        // If there are no data items then rollback
        if (txCount === 0) {
          logger.info(`Deleting empty bundle ${bundleId}`);
          await workerConnection("bundles")
            .where("bundle_id", "=", bundleId)
            .delete();
        } else {

          logger.info(`Bundled data items for bundle ${bundleId}`);

          const job = await bundleExecutorQueue.add(
            "Post bundle",
            {
              bundleId,
            },
            {
              attempts: 3,
              priority: 2,
              timeout: 20 * 60 * 1000,
              backoff: {
                type: "fixed",
                delay: 60 * 1000,
              },
            },
          );

          await workerConnection("bundles")
            .update("job_id", job.id)
            .where("bundle_id", "=", bundleId);
        }
      } catch (e) {
        logger.info(`Error occurred while bundling data items - ${e}`);
      }

      itemsLeft = await workerConnection("data_items")
        .count("data_item_id")
        .whereRaw("bundle_id is null")
        .first()
        .then(r => r.count > MINIMUM_BUNDLE_LENGTH);
    }

    bundlerLocked = false;
    logger.info("[Bundler] Sleeping for 2 minutes");
    await sleep(2 * 60 * 1000);
  }
}

export async function bundleOldItems(): Promise<void> {
  logger.info("Starting bundleOldItems...");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const bundlesLeft = await workerConnection("bundles")
      .select<{ bundle_id: string, job_id: string }[]>(["bundle_id", "job_id"])
      .whereRaw("tx_id is null")
      .andWhereRaw("date_created < now() - interval '12 hours'")
      .then(r => r.map(row => ({ bundleId: +row.bundle_id, jobId: row.job_id?.toString() })));

    if (bundlesLeft.length === 0) logger.info("Nothing old to resubmit to queue");

    if (bundlesLeft.length > 0) {
      bundlerLocked = true;
      logger.info(`Resubmitting a maximum of ${bundlesLeft.length} old bundles to queue`);

      for (const { bundleId, jobId } of bundlesLeft) {
        try {
          const txCount = await workerConnection
            .count("data_item_id")
            .from("data_items")
            .where("bundle_id", "=", bundleId)
            .first()
            .then(r => r.count);

          if (txCount === 0) {
            await workerConnection("data_items")
              .where("bundle_id", "=", bundleId)
              .delete();
            logger.info(`Deleted ${bundleId} from old bundle cleanup`);
            continue;
          }
          logger.verbose(`Found existing job ${jobId} in DB`);
          const existing = await bundleExecutorQueue.getJob(jobId ?? "");
          if (existing) {
            logger.verbose(`Found existing job ${jobId} in queue`);
            if (await existing.getState() !== "failed") continue;
          }
          logger.info(`Submitting old bundle ${bundleId} as > 1 day old`);
          const job = await bundleExecutorQueue.add(
            "Post bundle",
            {
              bundleId,
            },
            {
              attempts: 3,
              timeout: 20 * 60 * 1000,
              backoff: {
                type: "fixed",
                delay: 60 * 1000,
              },
            },
          );

          await workerConnection("bundles")
            .update("job_id", job.id)
            .where("bundle_id", "=", bundleId);
        } catch (e) {
          logger.info(`Error occurred while bundling data items - ${e}`);
        }
      }
    }

    bundlerLocked = false;
    logger.info("[Bundler] Sleeping for 5 minutes");
    await sleep(5 * 60 * 1000);
  }
}

export async function executeBundle(job: Job): Promise<number> {
  const { bundleId } = job.data;

  logger.info(`Processing bundle ${bundleId}`);
  await job.log(`Processing bundle ${bundleId}`);

  const txCount: number = await workerConnection("data_items")
    .where({
      bundle_id: bundleId,
    })
    .count("data_item_id")
    .first()
    .then(r => +r.count)
    .catch(logger.error) as number;

  logger.verbose(`txCount = ${txCount}`);
  await job.log(`txCount = ${txCount}`);

  // If there are no data items then rollback
  if (txCount === 0) {
    logger.info(`Deleting empty bundle ${bundleId}`);
    await workerConnection("bundles")
      .where("bundle_id", "=", bundleId)
      .delete();
    throw new Error("Empty bundle");
  }

  try {
    const txId = await postBundle(bundleId, job.log);
    await job.log("Posted");

    const newJob = await bundleQueue.add(
      "Bundle handler",
      {
        bundleId,
        txId,
        blockPosted: await currentBlockHeight("arweave"),
        itemCount: txCount,
        multiplier: await currentMultiplier(),
      },
      {
        delay: 60 * 60 * 1000,
        timeout: 30 * 60 * 1000,
        attempts: 10,
        backoff: {
          type: "fixed",
          delay: 30 * 60 * 1000,
        },
      },
    );

    await job.log(`Added ${newJob.id}`);

    await workerConnection("bundles")
      .where("bundle_id", bundleId)
      .update("tx_id", txId)
      .update("job_id", newJob.id)
      .then((r) => logger.verbose(`Committed bundle update for bundle id: ${bundleId} - ${r}`));
    await job.log("Updated db");

    return +newJob.id;
  } catch (e) {
    logger.error(`Error occurred while updating to db/queue - bundle ${bundleId} will be collected by the next attempt - ${e}`);
    await job.log(`Error occurred while updating to db/queue - bundle ${bundleId} will be collected by the next attempt - ${e}`);
    throw e;
  }

  return NaN;
}
