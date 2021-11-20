import { currentMultiplier, currentPricePerByte, FEE_MULTIPLIER, REDIS_CONVERSION_KEY } from "../constants";
import { BundlerPeer } from "../types/bundlerPeer";
//import { Currency } from "../types/Transaction";
import { Knex } from "knex";
import logger from "../logger";
import _ from "lodash";
import { currencies } from "../currency";
import { redisClient } from "../redis/client";
import BigNumber from "bignumber.js";

export async function hasSufficientFunds(connection: (Knex | Knex.Transaction), address: string, currency, amount: number): Promise<boolean> {
  const balance = await getBalance(connection, currency, address);
  const has = balance.isGreaterThanOrEqualTo(amount);
  logger.debug(`hasSufficientFunds:balance: ${balance.toString()} amount ${amount} has ${has}`);
  //return await (await getBalance(connection, currency, address)).isGreaterThanOrEqualTo(new BigNumber(amount));
  return has;
}

export async function getExternalFunds(connection: (Knex | Knex.Transaction), address: string): Promise<BundlerPeer> {
  return connection("external_balances")
    .join("bundler_peers", "external_balances.peer_address", "=", "bundler_peers.address")
    .where("external_balances.address", address)
    .select(["bundler_peers.address", "bundler_peers.host", "bundler_peers.port"])
    .first();
}

export async function getBalance(connection: Knex, currency: string, address: string): Promise<BigNumber> {
  // const arweaveAddress = currencies["arweave"].account.address;
  logger.debug(`getBalance:currency:${currency} address: ${address}`);
  // if (address === arweaveAddress) {
  //   // get the balance on the network
  //   const bndlrBal = parseInt(await Arweave.wallets.getBalance(arweaveAddress));
  //   // account for pending withdrawals in bundler balance:
  //   // get all transactions with -ve amount (meaning withdrawal)
  //   // that are not confirmed
  //   // and that are not addressed to the bundler
  //
  //   // TODO: change this to use the trigger rollups for balance transactions
  //   const bndlrMod = await connection
  //     .select(connection.raw("coalesce(sum(amount),0)"))
  //     .from("balance_transactions")
  //     .where("currency", "=", "arweave")
  //     .andWhere("amount", "<", 0)
  //     .andWhere("confirmed", "=", false)
  //     .andWhere("address", "!=", arweaveAddress) as unknown as number;
  //   //logger.debug(`mod: ${JSON.stringify(bndlrMod)}`);
  //   return new BigNumber(bndlrBal + parseInt(bndlrMod[0].coalesce));
  // }
  const balance = await connection
    .select<{ balance: string }[]>("balance")
    .from(connection.raw("balance(?,?)", [address, currency]))
    .first()
    .then(r => new BigNumber(r.balance));
  logger.debug(`Balance for ${address} is ${balance.toString(10)}`);
  return balance;
}

export async function calculateOtherFee(numberOfBytes: number, currency: string): Promise<BigNumber> {
  if (currencies[currency]) {
    const winston = new BigNumber(_.sum(await calculateFee(numberOfBytes)));
    const c = currencies[currency];
    const ratio = new BigNumber(await redisClient.get(REDIS_CONVERSION_KEY + ":" + currency));
    const res = winston.multipliedBy(ratio);
    logger.debug(`Converting ${winston.toString()} winston to ${res} ${c.base[0]} (ratio ${ratio.toString()})`)
    return res;
  } else {
    throw new Error(`Unknown/unsupported currency ${currency}`);
  }
}

export async function calculateFee(numberOfBytes: number): Promise<[number, number]> {
  const storageCost = Math.floor(await currentPricePerByte() * Math.max(numberOfBytes, 2048) * await currentMultiplier());
  logger.debug(`Fee for ${numberOfBytes}B is ${_.sum([storageCost, Math.floor(storageCost * (FEE_MULTIPLIER - 1))])}`);
  return [storageCost, Math.floor(storageCost * (FEE_MULTIPLIER - 1))];
}
