import redstone from "redstone-api";
import BigNumber from "bignumber.js";
import logger from "../logger";
import { redisClient } from "../redis/client";
import { currentMultiplier, REDIS_CONVERSION_KEY } from "../constants";
import arweave from "../arweave/arweave";
import base64url from "base64url";
import Arweave from "arweave";
import { FileDataItem } from "arbundles/file";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import keys from "../../keys";
import {
  createMaticTx,
  getMaticFee,
  getPolygonTx,
  polygonGetHeight,
  polygonOwnerToAddress,
  polygonSign,
  polygonVerify, sendMaticTx,
} from "./matic";

export interface Tx {
  from: string;
  to: string;
  amount: BigNumber;
  blockHeight?: BigNumber;
  pending: boolean;
  confirmed: boolean
}

export interface CreateTxData { amount: BigNumber | number, to: string, fee?: string };

interface Currency {
  base: [string, number];
  account: { key: any, address: string };
  provider?: string;

  getTx(txId: string): Promise<Tx>;

  ownerToAddress(owner: any): Promise<string>;

  getId(item: FileDataItem): Promise<string>;

  price(): Promise<number>;

  sign(key: any, data: Uint8Array): Promise<Uint8Array>;

  verify(pub: any, data: Uint8Array, signature: Uint8Array): Promise<boolean>;

  getCurrentHeight(): Promise<BigNumber>;

  getFee(amount: BigNumber | number, to?: string): Promise<BigNumber>;

  sendTx(data: any): Promise<any>; //TODO: make signature(s) more specific

  createTx(data: CreateTxData, key: any): Promise<{ txId: string, tx: any }>;
}

interface CurrencyConfig {
  [key: string]: Currency;
}

export const currencies: CurrencyConfig = {
  "arweave": keys.arweave ? {
    base: ["winston", 1e12],
    account: { key: keys.arweave.key, address: keys.arweave.address },
    getTx: null,
    ownerToAddress: async (owner) => {
      return arweave.wallets.ownerToAddress(Buffer.isBuffer(owner) ? base64url(owner) : owner);
    },
    getId: async (item) => {
      return base64url.encode(Buffer.from(await Arweave.crypto.hash(await item.rawSignature())));
    },
    price: () => getRedstonePrice("AR"),
    sign: async (data) => {
      return Arweave.crypto.sign(currencies["arweave"].account.key, data);
    },
    verify: async (pub, data, sig) => {
      return Arweave.crypto.verify(pub, data, sig);
    },
    getCurrentHeight: async () => arweave.network.getInfo().then(r => new BigNumber(r.height)),
    getFee: async (amount, to) => { return new BigNumber(parseInt(await arweave.transactions.getPrice(amount as number, to)) * await currentMultiplier()) },
    sendTx: async (tx) => {
      return await arweave.transactions.post(tx);
    },
    createTx: async ({ amount, fee, to }, key) => {
      const tx = await arweave.createTransaction({ quantity: amount.toString(), reward: fee, target: to }, key)
      await arweave.transactions.sign(tx, key)
      return { txId: tx.id, tx };
    }
  } : undefined,
  // "solana": {
  //     base: ["lamport", 1000000000],
  //     account: { address: "aaaaa" },
  //     getTx: async () => { return 0 },
  //     ownerToAddress: () => { return 0 },
  //     price: getRedstonePrice("SOL"),
  //     sign: async (k, d) => { return [k, d] },
  //     verify: async (k, d, s) => { return [k, d, s] }
  // },
  "matic": keys.matic ? {
    base: ["wei", 1e18],
    account: { key: keys.matic.key, address: keys.matic.address },
    provider: "https://polygon-rpc.com",
    getTx: getPolygonTx,
    getId: async (item) => {
      return base64url.encode(Buffer.from(await Arweave.crypto.hash(await item.rawSignature())));
    },
    ownerToAddress: polygonOwnerToAddress,
    price: () => getRedstonePrice("MATIC"),
    sign: polygonSign,
    verify: polygonVerify,
    getCurrentHeight: polygonGetHeight,
    getFee: getMaticFee,
    sendTx: sendMaticTx,
    createTx: createMaticTx
  } : undefined,
};

export async function getRedstonePrice(currency: string): Promise<number> {
  return (await redstone.getPrice(currency)).value;
}

export async function getConversionRatio(currency1: string, currency2: string): Promise<BigNumber> {
  const c1 = currencies[currency1];
  const c2 = currencies[currency2];
  // get the bup (base unit price) in USD
  const c1bup = new BigNumber(await c1.price()).div(c1.base[1]); // 1 base unit
  const c2bup = new BigNumber(await c2.price()).div(c2.base[1]);
  // get the ratio of c1 to c2
  const ratio = c1bup.div(c2bup);
  logger.debug(`1 ${c1.base[0]} is ${ratio.toString()} ${c2.base[0]} ($${c1bup.toString()})`);
  return ratio;
}

export async function getCachedConversionRatio(currency: string): Promise<BigNumber> {
  return new BigNumber(await redisClient.get(REDIS_CONVERSION_KEY + ":" + currency));
}

export async function syncConversionRates(): Promise<void> {
  await Promise.all(Object.keys(currencies).map(async (c) => {
    const ratio = await getConversionRatio("arweave", c);
    logger.debug(`Setting conversion for ${c} to ${ratio.toString()}`);
    await redisClient.set(REDIS_CONVERSION_KEY + ":" + c, ratio.toString());
  }));
}
