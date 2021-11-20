import logger from "../logger";
import customAxios from "../axios";
import { workerConnection } from "../database/workerConnection.database";

export async function crawlForPeers(): Promise<void> {
  logger.info("Crawling for peers");
  const startPoint = "arweave.net";

  await Promise.race([
    getPeers(startPoint, 0, true),
    new Promise(resolve => setTimeout(resolve, 10000)),
  ]);
  logger.info("Finished crawling for peers");
}

async function getPeers(peer: string, depth: number, whitelist?: boolean): Promise<void> {
  if (depth === 200) return;
  try {
    const response = await customAxios.get("http://" + peer + "/peers", { timeout: 5000 });
    const peers = response.data as string[];
    if (peers) await addPeers(peers, "peers", whitelist ? 50 : 0);
    await getPeers(peer, depth + 1, false);
  } catch (e) {
    logger.error(`Error occurred while getting peers: ${e}`);
  }
}

export async function crawlRandomPeer(): Promise<void> {
  logger.debug("Getting peers from random peer");
  const peersLength = await workerConnection("peers").count("peer as cnt").then(total => total[0].cnt);
  const randomIndex = between(0, peersLength);

  const randomPeer = await workerConnection("peers")
    .limit(1)
    .offset(randomIndex)
    .select("peer")
    .first()
    .then(p => p.peer);

  // Trust me
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await getPeers(randomPeer);
}

async function addPeers(peers: string[], table = "temp_peers", trust = 0): Promise<void> {
  await workerConnection(table)
    .insert(peers.filter(p => !p.includes("127.0.0.1")).map(peer => ({ peer: peer, trust })))
    .onConflict()
    .ignore();
}

export async function deletePeer(peer: string, table = "temp_peers"): Promise<void> {
  const result = await workerConnection(table)
    .where("peer", peer)
    .delete();
  if (result > 0) {
    logger.debug(`Deleting peer: ${peer}`);
  }
}

function between(min, max) {
  return Math.floor(
    Math.random() * (max - min) + min
  )
}
