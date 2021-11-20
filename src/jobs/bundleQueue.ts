import logger from "../logger";
import {
  BUNDLES_PATH,
  CHECK_INDIVIDUAL_DATA,
  CONFIRMATION_THRESHOLD,
  currentBlockHeight,
  REDIS_LAST_SEEDED_KEY,
  S3_BUCKET,
  SEEDING_THRESHOLD,
} from "../constants";
import axios from "../axios";
import * as bluebird from "bluebird";
import { bundleExecutorQueue, bundleQueue } from "../queues/queues";
import { https } from "follow-redirects";
import { FileDataItem } from "arbundles/file";
import { redisClient } from "../redis/client";
import { Knex } from "knex";
import { workerConnection } from "../database/workerConnection.database";
import { praiseMiner } from "../database/update.transaction";
import * as fs from "fs";
import * as MQ from "bullmq";
import path from "path";
import { s3 } from "../s3/s3";

export enum TransactionStatus {
  PENDING = "PENDING",
  DROPPED = "DROPPED",
  SEEDED = "SEEDED"
}

export function registerBundleQueueJobs(): void {
  logger.info(`Setting up with ${SEEDING_THRESHOLD} seeding threshold`);
  const scheduler = new MQ.QueueScheduler(bundleQueue.name);

  const worker = new MQ.Worker(bundleQueue.name, path.resolve("./build/src/jobs/bundleQueue/bundleHandler"), { concurrency: 5 });

  process.on("SIGINT", () => {
    Promise.all([worker.close(), scheduler.close()])
      .then(_ => process.exit(0))
      .catch(_ => process.exit(1));
  });
}


export async function getTxStatus(connection: (Knex | Knex.Transaction), txId: string, bundleId: number, blockPosted: number): Promise<TransactionStatus> {
  logger.verbose(`Checking tx status for: ${txId}`);
  const response = await axios.get(`https://arweave.net/tx/${txId}/status`, { validateStatus: (_) => true });

  if (response.status >= 300 && response.status < 400) return TransactionStatus.PENDING;
  if (response.status === 404) return TransactionStatus.DROPPED;

  switch (response.status) {
    case 200: {
      if (+response.data.number_of_confirmations < CONFIRMATION_THRESHOLD) return TransactionStatus.PENDING;
      const blockHeight = await currentBlockHeight("arweave");
      const blockDiff = blockHeight - blockPosted;
      const seeded = await isSeeded(connection, bundleId, txId);
      logger.info(`${txId} is ${seeded ? "" : "NOT "}seeded`);
      if (seeded) return TransactionStatus.SEEDED;
      else if (blockDiff >= 400) return TransactionStatus.DROPPED;
      else {
        if (blockDiff > 50) await bundleExecutorQueue.add("Reseed bundle", { bundleId }, {
          attempts: 3, priority: 1, backoff: { type: "fixed", delay: 5 * 60 * 1000 },
          timeout: 20 * 60 * 1000,
          removeOnFail: false,
        });
        return TransactionStatus.PENDING;
      }
    }
    case 202:
      return TransactionStatus.PENDING;
    default:
      return TransactionStatus.DROPPED;
  }
}

export async function isSeeded(connection: (Knex | Knex.Transaction), bundleId: number, txId: string, threshold = SEEDING_THRESHOLD, checkIndexed = true): Promise<boolean> {
  const peers: { peer: string }[] = await connection("peers")
    .whereNot("peer", "like", "127.0.0.1%")
    .orderBy("trust", "desc")
    .distinct("peer")
    .select("trust");

  let returnValues;

  try {
    returnValues = await bluebird.Promise.some(peers.map(async (p) => {
      const has = await hasData(p.peer, txId);
      if (has) praiseMiner(workerConnection, p.peer)
        .catch(logger.error);
      return has;
    }), threshold);
  } catch (e) {
    return false;
  }
  const returnValue = returnValues[0];

  if (await currentBlockHeight("arweave") > returnValue.blockHeight && returnValue.confirmations >= CONFIRMATION_THRESHOLD) {
    if (checkIndexed && CHECK_INDIVIDUAL_DATA) {
      logger.verbose(`${txId} bundle is seeded. Checking if indexed...`);
      const indexed = await isIndexed(connection, bundleId, txId);
      logger.info(`${txId} is ${indexed ? "" : "NOT "}indexed`);
      return true;
    } else return true;
  } else {
    logger.verbose(`${txId} bundle is seeded but only has ${returnValue.confirmations} confirmations or ${await currentBlockHeight("arweave")} < ${returnValue.blockHeight}`);
    return false;
  }
}

export async function hasData(peer: string, txId: string): Promise<DataInfo> {
  const offsetResponse = await axios.get(`http://${peer}/tx/${txId}/offset`, { timeout: 7500 });
  const { size, offset } = offsetResponse.data;
  const syncResponse = await axios.get(`http://${peer}/data_sync_record/${+offset - +size}/1`, {
    headers: { "Content-Type": "application/json" },
    timeout: 7500,
  });
  const endOffset = +Object.keys(syncResponse.data[0])[0];
  const startOffset = +Object.values(syncResponse.data[0])[0];
  const a = +offset <= endOffset;
  const b = (+offset - +size) >= startOffset;
  if (a && b) {
    const response = await axios.get(`http://${peer}/tx/${txId}/status`, { timeout: 7500 }).then(r => ({
      blockHeight: r.data.block_height,
      confirmations: r.data.number_of_confirmations,
      peer: peer,
    }));
    logger.verbose(`Seeded at ${peer}`);
    await redisClient.set(REDIS_LAST_SEEDED_KEY, Date.now().toString());
    return response;
  } else {
    throw new Error("Node not synced");
  }
}

type DataInfo = { blockHeight: number, confirmations: number, peer: string };

async function isIndexed(connection: Knex, bundleId: number, txId: string): Promise<boolean> {
  const [bundleSize, itemCount] = await connection
    .sum("size")
    .count("data_item_id")
    .from("data_items")
    .join("bundles", "data_items.bundle_id", "=", "bundles.bundle_id")
    .whereRaw("data_items.bundle_id IS NOT NULL")
    .andWhere("bundles.tx_id", "=", txId)
    .first()
    .then(r => [+r.sum, +r.count])
    .catch(logger.error) as [number, number];

  const finalSize = bundleSize + 32 + (64 * itemCount);
  const present = await dataPresent(txId, finalSize)
    .then(r => {
      logger.verbose(`${txId} bundle is ${r ? "" : "NOT "}present`);
      return r;
    });

  let count = 0;
  const idsStream = connection
    .select<{ data_item_id: string }[]>("data_item_id")
    .from("data_items")
    .where("bundle_id", "=", bundleId)
    .stream();

  logger.info(`Checking for ${itemCount} items`);

  for await (const { data_item_id } of idsStream) {
    logger.verbose(`Checking for data item: ${data_item_id}`);

    let size;
    let dataStart;
    try {
      const stats = await s3.statObject(S3_BUCKET, data_item_id);
      size = stats.size;
      dataStart = stats.metaData["data.start"];
    } catch (e) {
      logger.error(`[WARNING] Can't find data item ${data_item_id} (from bundle ${bundleId}) in S3 - ${e}`);
    }

    if (!size || !dataStart) {
      logger.verbose(`size and dataStart are undefined for ${data_item_id}`);
      try {
        const item = new FileDataItem(`${BUNDLES_PATH}/txs/${data_item_id}`);
        size = await item.size();
        dataStart = await item.dataStart();
      } catch (e) {
        logger.error(`[SEVERE] Can't find data item ${data_item_id} (from bundle ${bundleId}) in fs or S3 - ${e}`);
        continue;
      }
    }

    const dataItemSize = size - dataStart;
    logger.verbose(`dataItemSize = ${size} - ${dataStart}`);

    if (!await dataPresent(data_item_id, dataItemSize, true)) {
      count++;
      logger.info(`Requeueing data item ${data_item_id}`);
      await workerConnection("data_items")
        .update("bundle_id", workerConnection.raw("null"))
        .update("requeued", workerConnection.raw("requeued + 1"))
        .where("data_item_id", "=", data_item_id);
    } else {
      logger.info(`Data item ${data_item_id} stored correctly at ${process.env.GATEWAY_HOST}`);
    }
  }

  logger.info(`${count} out of ${itemCount} items dropped from bundle ${bundleId}`);

  return present;
}

export async function dataPresent(txId: string, size: number, checkForManifest = false): Promise<boolean> {
  logger.verbose(`Checking if ${txId} is present`);
  if (size === 0) return true;

  if (await fs.promises.stat(`${BUNDLES_PATH}/txs/${txId}`).then(r => r.size).catch(_ => 0) === 0) return true;

  const isPresent = await new Promise((resolve, reject) => {
    https.get(`https://arweave.net/${txId}`, response => {
      if (response.statusCode !== 200) resolve(false);
      let received = 0;
      response.on("data", chunk => received += chunk.byteLength);
      response.on("end", () => {
        logger.verbose(`${txId}   Received: ${received}   Expected: ${size}`);
        // TODO: Is this right?
        resolve(received >= size);
      });
      response.on("error", reject);
    }).on("error", reject);
  }).catch(e => {
    logger.error(`Error occurred while getting ${txId} - post seed check: ${e}`);
    return false;
  }) as Promise<boolean>;

  if (!isPresent && checkForManifest) return await new Promise((resolve, reject) => {
    https.get(`https://arweave.net/tx/${txId}/data.json`, response => {
      if (response.statusCode !== 200) resolve(false);
      let received = 0;
      response.on("data", chunk => received += chunk.byteLength);
      response.on("end", () => {
        logger.verbose(`[Manifest check] ${txId}   Received: ${received}   Expected: ${size}`);
        // TODO: Is this right?
        resolve(received >= size);
      });
      response.on("error", reject);
    }).on("error", reject);
  }).catch(e => {
    logger.error(`Error occurred while getting ${txId} - post seed manifest check: ${e}`);
    return false;
  }) as Promise<boolean>;

  return isPresent;
}
