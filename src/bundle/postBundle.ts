import logger from "../logger";
import { currencies } from "../currency";
import { workerConnection } from "../database/workerConnection.database";
import retry from "async-retry";
import { pipeline } from "stream/promises";
import { createTransactionAsync, uploadTransactionAsync } from "arweave-stream-tx";
import arweave from "../arweave/arweave";
import Transaction from "arweave/node/lib/transaction";
import { redisClient } from "../redis/client";
import { REDIS_MULTIPLIER_KEY } from "../constants";
import { bundleExecutorQueue } from "../queues/queues";
import { cleanupStreamFiles, generateHeaderFile, generateStream } from "./utils";
import { Readable } from "stream";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postBundle(bundleId: number, log?: (message: string) => void): Promise<string> {
  logger.verbose("Posting bundle start...");
  await log?.("Posting bundle start...")
  const jwk = currencies["arweave"].account.key;

  const txIds = await workerConnection("data_items")
    .where("data_items.bundle_id", bundleId)
    .join("bundles", "data_items.bundle_id", "bundles.bundle_id")
    .select("data_item_id")
    .then(r => r.map(row => row.data_item_id));

  const headerFilename = await generateHeaderFile(bundleId, txIds);

  logger.info(`Generated header file for bundle ${bundleId}`);
  await log?.(`Generated header file for bundle ${bundleId}`);

  let tx;
  try {
    tx = await retry(
      async (_) => {
        const stream = await generateStream(headerFilename, txIds);
        logger.info(`Generated stream for bundle ${bundleId}`);
        await log?.(`Generated stream for bundle ${bundleId}`);
        const tx = await pipeline(
          stream,
          createTransactionAsync({}, arweave, jwk));
        logger.info(`Generated tx for bundle ${bundleId}`);
        await log?.(`Generated tx for bundle ${bundleId}`);
        return tx;
      },
      {
        retries: 3,
        minTimeout: 5000,
        onRetry: (e, attempts) => {
          logger.debug(`Retrying creating tx (bundle ${bundleId}) during seeding at attempt ${attempts} - ${e}`);
        },
      },
    );

  } catch (e) {
    logger.error(`Error occurred while creating tx - ${e}`);
    await log?.(`Error occurred while creating tx - ${e}`);
    throw e;
  }

  logger.info(`Created tx for bundle ${bundleId}`);
  await log?.(`Created tx for bundle ${bundleId}`);

  if (!(tx instanceof Transaction)) {
    throw new Error("Not a tx");
  }

  const multiplier = +await redisClient.get(REDIS_MULTIPLIER_KEY);

  tx.reward = Math.round(+tx.reward * multiplier).toString();

  tx.addTag("Application", "Bundlr");
  tx.addTag("Action", "Bundle");
  tx.addTag("Bundle-Format", "binary");
  tx.addTag("Bundle-Version", "2.0.0");

  await arweave.transactions.sign(tx, jwk);

  logger.info(`Posting tx: ${tx.id}`);
  await log?.(`Posting tx: ${tx.id}`);
  try {
    const stream = await generateStream(headerFilename, txIds);
    await retry(
      async function(_) {
        await pipeline(stream, uploadTransactionAsync(tx, arweave, true));
      },
      {
        retries: 5,
      },
    );
  } catch (e) {
    logger.error(`Error occurred while posting to gateway - ${e}`);
    await log?.(`Error occurred while posting to gateway - ${e}`);
    if (![200, 202].includes(await arweave.transactions.getStatus(tx.id).then(r => r.status))) throw e;
  }

  cleanupStreamFiles(txIds).catch(e => logger.error(`Error occurred while cleaning up stream files - ${e}`));

  await sleep(2000);

  // TODO: Check tx has propagated

  logger.info(`Posted ${tx.id} to the gateway`);

  delete tx.chunks;

  await redisClient.set(`Bundler_node:tx:${tx.id}`, JSON.stringify(tx), { EX: 86400 });

  await bundleExecutorQueue.add("Seed bundle",
    { bundleId },
    {
      delay: 15 * 1000,
      priority: 1,
      backoff: {
        type: "fixed",
        delay: 5 * 60 * 1000,
      },
      attempts: 3,
      timeout: 20 * 60 * 1000,
      // removeOnComplete: true
    },
  );

  return tx.id;
}

export async function* verifyStream(s: Readable): AsyncGenerator<Buffer> {
  for await (const chunk of s) {
    yield chunk;
  }
}
