import logger from "../logger";
import { BundlerPeer } from "../types/bundlerPeer";
import arweave from "../arweave/arweave";
import { InitializeTx } from "../types/InitializeTx";
import swcClient, { ContractState } from "../arweave/contract";
import { workerConnection } from "../database/workerConnection.database";

export async function syncBundlerPeers(): Promise<void> {
  logger.info("Syncing bundlers peers");
  const peers = await getBundlerPeers();
  const tx = await workerConnection.transaction();
  await tx("bundler_peers").delete();
  if (peers.length > 0) {
    await tx("bundler_peers")
      .insert(peers);
  }
  await tx.commit();
}

async function getBundlerPeers(): Promise<BundlerPeer[]> {
  let state;
  try {
    state = await swcClient.contract<ContractState>(process.env.BUNDLER_CONTRACT!).readState().then(r => r.state);
  } catch (e) {
    logger.error(`Error occurred while reading contract state: ${e}`);
    return [];
  }

  return Promise.all(state.bundlers.map(tx => getBundler(tx[1])));
}

async function getBundler(txId: string): Promise<BundlerPeer> {
  const config: InitializeTx = JSON.parse(await arweave.transactions.getData(txId, { decode: true }) as string);

  return {
    initialize_tx: txId,
    address: await arweave.wallets.ownerToAddress(config.n),
    host: config.host,
    port: config.port,
  };
}
