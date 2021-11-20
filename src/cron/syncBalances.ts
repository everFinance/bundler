import { getLargestBlockHeight } from "../database/select.transaction";
import arweave from "../arweave/arweave";
import ArDB from "@textury/ardb";
import { LOGS } from "@textury/ardb/lib/utils/log";
import ArdbTransaction from "@textury/ardb/lib/models/transaction";
import { insertBalanceTransactions } from "../database/insert.transaction";
import logger from "../logger";
import { workerConnection } from "../database/workerConnection.database";
import { Currency } from "../types/Transaction";
import { BalanceTransaction } from "../types/BalanceTransaction";
import { currencies, Tx } from "../currency";

export async function syncBalances(): Promise<void> {
  logger.info("Syncing balance ledger");

  const currentHeight = await arweave.network.getInfo().then(info => info.height);
  const largestBlock = Math.max(await getLargestBlockHeight(workerConnection));
  // Don't get all transactions ever
  const dbHeight = (Math.max(parseInt(process.env.START_BLOCK ?? "0"), largestBlock) ?? currentHeight) - 1;
  if (dbHeight == currentHeight) {
    return;
  }

  const arweaveAddress = currencies["arweave"].account.address;

  logger.info(`Syncing balances from block ${dbHeight}`);

  const txs = await getTxsFromMinBlock(dbHeight);
  if (txs.length > 0) {
    const finalTxs: BalanceTransaction[] = [];
    for (const tx of txs) {
      logger.debug(`[Sync balance] checking ${tx.id}`)
      let confirmed = true;
      try {
        const response = await arweave.transactions.getStatus(tx.id);
        if (response.status !== 200) throw new Error();
        else if (response.confirmed.number_of_confirmations < 25) confirmed = false;
      } catch (e) {
        continue;
      }

      if (["69QQIIfCtWRgNaNkiLe466d_3rzcC_SFZsRX4BWNSoc"].includes(tx.id)) continue;
      finalTxs.push({
        address: (tx.owner.address === arweaveAddress) ? tx.recipient : tx.owner.address,
        amount: (tx.owner.address === arweaveAddress) ? -tx.quantity.winston : +tx.quantity.winston,
        block_height: tx.block.height,
        confirmed,
        currency: Currency.ARWEAVE,
        tx_id: tx.id,
      });
    }
    if (finalTxs.length > 0) await insertBalanceTransactions(workerConnection, finalTxs);
  }

  logger.debug("Pruning....");
  const pruned = await pruneArweaveBalanceTxs();
  await pruneMaticBalanceTxs();
  logger.info("Ledger pruning done");
  logger.debug(`Pruned ${pruned} transactions`);
  // re-update ledger
  if (pruned > 0) {
    logger.debug("Re-syncing ledger...");
    await syncBalances();
  }
}

async function getTxsFromMinBlock(block: number): Promise<ArdbTransaction[]> {
  const arweaveAddress = currencies["arweave"].account.address;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  let ardb = new ArDB(arweave, LOGS.ARWEAVE)
    .search("transactions")
    .min(block)
    .from(arweaveAddress)
    .limit(100);

  logger.info("Syncing sent balance txs");
  const sent = (await ardb.findAll() as ArdbTransaction[])
    .filter(tx => +tx.quantity.winston > 0);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  ardb = new ArDB(arweave, LOGS.ARWEAVE)
    .search("transactions")
    .min(block)
    .to(arweaveAddress)
    .limit(100);

  const received = (await ardb.findAll() as ArdbTransaction[])
    .filter(tx => +tx.quantity.winston > 0);


  return [
    ...sent,
    ...received,
  ];
}

async function pruneArweaveBalanceTxs(): Promise<number> {
  const txIds = await workerConnection("balance_transactions")
    .select("tx_id")
    .where("confirmed", "=", false)
    .andWhere("currency", "=", "arweave")
    .then(r => r.map(row => row.tx_id));

  let pruned = 0;
  for (const txId of txIds) {
    try {
      const response = await arweave.transactions.getStatus(txId);
      if (response.status >= 400) {
        await workerConnection("balance_transactions")
          .where("tx_id", "=", txId)
          .del();
        pruned++;
        continue;
      }
      logger.info(response.status.toString());

      if (response.status !== 202 && response.confirmed?.number_of_confirmations >= 20) await workerConnection("balance_transactions")
        .where("tx_id", "=", txId)
        .update("confirmed", true);
    } catch (e) {
      logger.error(e);
      await workerConnection("balance_transactions")
        .where("tx_id", "=", txId)
        .del();
      pruned++;
    }
  }

  return pruned;
}


async function pruneMaticBalanceTxs(): Promise<number> {
  const currency = currencies["matic"];

  const txIds = await workerConnection("balance_transactions")
    .select("tx_id")
    .where("confirmed", "=", false)
    .andWhere("currency", "=", "matic")
    .then(r => r.map(row => row.tx_id));

  let pruned = 0;
  for (const txId of txIds) {
    let tx: Tx;
    try {
      tx = await currency.getTx(txId);
    } catch (e) {
      await workerConnection("balance_transactions")
        .where("tx_id", "=", txId)
        .del();
      pruned++;
    }

    // TODO: Unsafe bignum op
    if (tx.confirmed) {
      await workerConnection("balance_transactions")
        .where("tx_id", "=", txId)
        .update("confirmed", true);
    }
  }

  return pruned;
}

