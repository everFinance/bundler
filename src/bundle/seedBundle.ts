import logger from "../logger";
import { MAX_PEER_PUSH } from "../constants";
import { workerConnection } from "../database/workerConnection.database";
import { redisClient } from "../redis/client";
import Transaction from "arweave/node/lib/transaction";
import { pipeline } from "stream/promises";
import { generateTransactionChunksAsync, uploadTransactionAsync } from "arweave-stream-tx";
import { URL } from "url";
import Arweave from "arweave";
import { performance } from "perf_hooks";
import retry from "async-retry";
import { praiseMiner, punishMiner } from "../database/update.transaction";
import { cleanupStreamFiles, generateHeaderFile, generateStream } from "./utils";
import arweave from "../arweave/arweave";

export async function seedBundle(bundleId: number, log?: (message: string) => Promise<void>, opts?: { maxPeerPush: number }): Promise<number> {
  logger.info(`Seeding bundle ${bundleId}`);
  await log?.(`Seeding bundle ${bundleId}`);

  const maxPeerPush = opts?.maxPeerPush ?? MAX_PEER_PUSH;

  const txId = await workerConnection
    .select("tx_id")
    .from("bundles")
    .where("bundle_id", "=", bundleId)
    .first()
    .then(r => r.tx_id);

  await log?.(`Found tx id ${txId}`);

  let tx = await redisClient.get(`Bundler_node:tx:${txId}`).then(r => JSON.parse(r) as Transaction);
  if (!tx) {
    try {
      tx = await arweave.transactions.get(txId);
    } catch (_) {
      throw new Error(`Can't find tx ${txId} in redis`);
    }
  }

  const txIds = await workerConnection
    .select<{ data_item_id: string }[]>("data_item_id")
    .from("data_items")
    .where("bundle_id", "=", bundleId)
    .then(rows => rows.map(row => row.data_item_id));

  if (txIds.length === 0) {
    throw new Error("Invalid bundle");
  }

  const headerFilename = await generateHeaderFile(bundleId, txIds);

  tx.chunks = await pipeline(await generateStream(headerFilename, txIds), generateTransactionChunksAsync());

  logger.info(`Created tx for seeding bundle ${bundleId} - ${tx.id}`);
  await log?.(`Created tx for seeding bundle ${bundleId} - ${tx.id}`);

  const peers = await workerConnection
    .select<{ peer: string }[]>("peer")
    .from("peers")
    .orderBy("trust", "desc");

  const speeds = {};

  let fastest = 120000;
  let succeeded = 0;
  for (const { peer } of peers) {
    const url = new URL(`http://${peer}`);

    const aw = Arweave.init({
      host: url.hostname,
      port: +url.port,
      protocol: url.protocol.slice(0, -1),
      timeout: 30000,
      logging: false,
    });

    try {
      logger.verbose(`Starting pipe ${tx.id} to ${peer}`);
      const now = performance.now();
      logger.verbose(`Fastest = ${fastest}`);
      await retry(
        async (bail) => {
          await Promise.race([
            (async function() {
              try {
                await pipeline(await generateStream(headerFilename, txIds), uploadTransactionAsync(tx, aw, false));
              } catch (e) {
                logger.error(`Error occurred while piping ${tx.id} to ${peer} - ${e}`);
                throw e;
              }
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out during upload to ${peer}`)), 120000)),
          ]).catch(e => {
            if (e.message.includes("Timed out during upload")) {
              bail(new Error("Timeout error"));
            }
          });
        },
        {
          retries: 3,
          onRetry: (e, attempts) => {
            logger.debug(`Retrying seeding tx at attempt ${attempts} - ${e}`);
          },
        },
      );

      const now2 = performance.now();
      const speed = now2 - now;
      logger.verbose(`Took ${speed}ms to pipe`);
      speeds[peer] = speed;
      if (speed < fastest) {
        // Give 10% leeway
        fastest = Math.max(Math.ceil(speed * 1.1), 60000);
      }

      succeeded++;
      logger.verbose(`Posted ${tx.id} to ${peer} - ${succeeded} posts completed`);
      await log?.(`Posted ${tx.id} to ${peer} - ${succeeded} posts completed`);
    } catch (e) {
      logger.error(`Posting failed for bundle id: ${bundleId} - ${e}`);

      punishMiner(workerConnection, peer)
        .catch(logger.error);
    }

    if (succeeded >= maxPeerPush) break;
  }

  cleanupStreamFiles(txIds).catch(e => logger.error(`Error occurred while cleaning up stream files - ${e}`));

  const fastestPeer = Object.entries(speeds).reduce((a, b) => a[1] > b[1] ? a : b)[0];

  praiseMiner(workerConnection, fastestPeer)
    .catch(logger.error);

  return succeeded;
}
