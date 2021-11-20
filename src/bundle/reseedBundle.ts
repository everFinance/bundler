import { workerConnection } from "../database/workerConnection.database";
import { generateHeaderFile, generateStream } from "./utils";
import { streamToBuffer } from "../utils/streamToBuffer";
import logger from "../logger";
import { URL } from "url";
import Arweave from "arweave";
import { MAX_PEER_PUSH } from '../constants';

export async function reseedBundle(bundleId: number, log?: (message: string) => Promise<void>): Promise<number> {
  const txId = await workerConnection
    .select<{ tx_id: string }[]>("tx_id")
    .from("bundles")
    .where("bundle_id", "=", bundleId)
    .first()
    .then(row => row.tx_id);

  logger.info(`Got tx id ${txId}`);
  await log?.(`Got tx id ${txId}`);

  const txIds = await workerConnection
    .select<{ data_item_id: string }[]>("data_item_id")
    .from("data_items")
    .where("bundle_id", "=", bundleId)
    .then(rows => rows.map(row => row.data_item_id));

  if (txIds.length === 0) {
    throw new Error("Invalid bundle");
  }

  const headerFilename = await generateHeaderFile(bundleId, txIds);
  const data = await streamToBuffer(await generateStream(headerFilename, txIds));

  logger.verbose(`Got data for ${txId}`);
  const peers = await workerConnection
    .select<{ peer: string }[]>("peer")
    .from("peers")
    .orderBy("trust", "desc");

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

    const uploader = await aw.transactions.getUploader(txId, data);

    logger.verbose(`Starting pipe ${txId} to ${peer}`);
    while (!uploader.isComplete) {
      await uploader.uploadChunk();
      console.log(`chunkUploaded: ${uploader.uploadedChunks}/${uploader.totalChunks} %${uploader.pctComplete}`);
      console.log(`lastResponseStats: ${uploader.lastResponseStatus} lastResponseError: ${uploader.lastResponseError}`);
      if (uploader.lastResponseError === "disk_full") break;
    }
    if (uploader.lastResponseError === "disk_full") continue;

    succeeded++;

    if (succeeded >= MAX_PEER_PUSH) break;
  }

  return succeeded;
}
