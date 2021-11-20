import { ExternalTransaction, Transaction } from "../types/Transaction";
import logger from "../logger";
import path from "path";
import { BalanceTransaction, ExternalBalance } from "../types/BalanceTransaction";
import * as fs from "fs";
import { Config } from "../types/Config";
import { Knex } from "knex";

export async function insertDataItem(connection: (Knex | Knex.Transaction), item: Transaction | Transaction[]): Promise<boolean> {
  try {
    await connection("data_items")
      .insert(item)
  } catch (e) {
    logger.error(`Error occurred while inserting data item - ${e}`);
    return false;
  }

  return true;
}

export async function insertExternalDataItem(connection: (Knex | Knex.Transaction), item: ExternalTransaction | ExternalTransaction[]): Promise<void> {
  await connection("external_data_items")
    .insert(item)
    .catch(e => {
      logger.verbose(e);
    })
    .catch(logger.error)
}

export async function insertBalanceTransactions(connection: (Knex | Knex.Transaction), transactions: BalanceTransaction[]): Promise<void> {
  await connection("balance_transactions")
    .insert(transactions).onConflict("tx_id").merge(["confirmed", "block_height"])
    .catch(e => logger.error(`Error occurred while inserting balance transaction: ${e}`));
}


export async function insertExternalBalance(connection: (Knex | Knex.Transaction), externalBalances: ExternalBalance[]): Promise<void> {
  const query = connection("external_balances")
    .insert(externalBalances)

  const q = connection.raw(`${query.toString()} ON CONFLICT (address, peer_address) DO UPDATE SET balance = excluded."balance"`);
  return await q
    .catch(e => logger.error(`Error occurred while inserting balance transaction: ${e}`));
}

// export async function insertGatewaysToDateItem(id: string, gateways: number[]): Promise<void> {
//   logger.verbose("Inserting into data item gateways field");
//   await connection("data_items")
//     .where("data_item_id", id)
//     .update({
//       gateways: connection.raw("gateways || ?", JSON.stringify(gateways))
//     })
//     .catch(logger.error);
// }

export async function insertGateways(connection: (Knex | Knex.Transaction),): Promise<void> {
  const config = await fs.promises.readFile(path.resolve(process.cwd(), "./config.json")).then(r => JSON.parse(r.toString())) as Config;
  await connection("gateways")
    .insert(config.gateways)
    .onConflict()
    .ignore();
}
