import { exists } from "./utils";
import { BundlerPeer } from "../types/bundlerPeer";
import { Gateway } from "../types/Gateway";
import logger from "../logger";
import { Knex } from "knex";

export async function getSumOfStorageTxs(connection: (Knex | Knex.Transaction), address: string): Promise<number> {
  return connection<number>("data_items")
    .where("address", address)
    .sum("fee");
}

export async function getSumOfTransferTxs(connection: (Knex | Knex.Transaction), address: string): Promise<number> {
  return connection<number>("balance_transactions")
    .where("address", address)
    .sum("amount");
}

export async function getLargestBlockHeight(connection: (Knex | Knex.Transaction), ): Promise<number> {
  return await connection<number>("balance_transactions")
    .max("block_height").then(rows => parseInt(rows[0]["max"] ?? "0"));
}

export async function getAvailableBundle(connection: (Knex | Knex.Transaction), ): Promise<string> {
  return connection<string>("bundles")
    .column("bundle_id")
    .where("locked", true)
    .first()
}

export async function txExists(connection: (Knex), txId: string): Promise<boolean> {
  return await exists(connection, "data_items", "data_item_id", txId);
}

export async function balanceTransactionExists(connection: Knex, txId: string, currency: string): Promise<boolean> {
  const res = await connection.first(
    connection.raw(
      "exists ? as present",
      connection("balance_transactions")
        .select(connection.raw("1"))
        .where("tx_id", "=", txId)
        .andWhere("currency", "=", currency)
    )
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return res.present;
}

export async function externalTxExists(connection: (Knex | Knex.Transaction), txId: string): Promise<Omit<BundlerPeer, "address"> | undefined> {
  return connection("external_data_items")
    .join("bundler_peers", "external_data_items.peer_address", "=", "bundler_peers.address")
    .where("external_data_items.data_item_id", txId)
    .select(["host", "port"])
    .first()
    .catch(logger.error);
}

export async function txSeeded(connection: (Knex), txId: string): Promise<boolean> {
  const res = await connection.first(
    connection.raw(
      `
      EXISTS(
        SELECT di.data_item_id
        FROM data_items di
        JOIN bundles b on b.bundle_id = di.bundle_id AND di.bundle_id IS NOT NULL
        WHERE di.data_item_id = ?
        AND b.tx_id IS NOT NULL
      ) as present
      `, txId
    )
  );

  // Trust me
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return res.present;
}

export async function getBundlerPeersFromDb(connection: (Knex | Knex.Transaction), ): Promise<BundlerPeer[]> {
  return connection("bundler_peers")
    .select(["address", "host", "port"])
    .limit(200);
}

export async function getRandomBundlerPeersFromDb(connection: (Knex | Knex.Transaction), amount: number): Promise<BundlerPeer[]> {
  let count = await connection("bundler_peers")
    .count("*")
    .first()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .then(r => r.count) as number;

  if (amount >= count) {
    count = 0;
  }

  return connection("bundler_peers")
    .select(["address", "host", "port"])
    .offset(Math.floor(Math.random() * count))
    .limit(amount);
}

// export async function getLatestBundlerPeerBlock(): Promise<number> {
//   return connection("bundler_peers")
//     .select("block_height")
//     .max()
//     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//     // @ts-ignore
//     .then(res => res.max ?? 0);
// }

export async function getAddressFromDomain(connection: (Knex | Knex.Transaction), domain: string): Promise<string> {
  return await connection("bundler_peers")
    .where("host", domain)
    .first("address")
    .then(r => r.address);
}

export async function getGatewaysFromDb(connection: (Knex | Knex.Transaction), ): Promise<Gateway[]> {
  return await connection("gateways")
    .select(["*"])
    .catch(logger.error) as Gateway[];
}

export async function currencyTxExists(connection: (Knex), currency: string, id: string): Promise<boolean> {
  const res = await connection.first(
    connection.raw(
      "exists ? as present",
      connection("data_items")
        .select("data_item_id")
        .where("currency", "=", currency)
        .andWhere("fee_transaction", "=", id)
        .limit(1)
    )
  );

  // Trust me
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return res.present;
}
