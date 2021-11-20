import arweave from "./arweave/arweave";
import logger from "./logger";
import { config } from "dotenv";
import { redisClient } from "./redis/client";
import { currencies, syncConversionRates } from "./currency";

process.env = { ...process.env, ...config().parsed };

function parseInt(o: any): number {
  const num = +o;
  if (isNaN(num)) throw new Error("Must be a num");
  return num;
}

function parseFloat(o: any): number {
  const num = +o;
  if (isNaN(num)) throw new Error("Must be a num");
  return num;
}

export const S3_BUCKET = process.env.S3_TX_BUCKET;
export const CHECK_INDIVIDUAL_DATA = process.env.CHECK_INDIVIDUAL_DATA === "true";
export const SEEDING_THRESHOLD = parseInt(process.env.SEEDING_THRESHOLD ?? "2");
export const CONFIRMATION_THRESHOLD = +(process.env.CONFIRMATION_THRESHOLD ?? 15);
export const FEE_MULTIPLIER = parseFloat(process.env.FEE_MULTIPLIER ?? "1.5");
export const MAX_PEER_PUSH = +(process.env.MAX_PEER_PUSH ?? "5");
export const BUNDLES_PATH = process.env.BUNDLES_PATH ?? "bundles";
export const REDIS_CONFIG = {
  redis: {
    host: process.env.REDIS_HOST,
    port: +process.env.REDIS_PORT,
    username: process.env.REDIS_USER,
    password: process.env.REDIS_PASSWORD,
  },
};
export const REDIS_MULTIPLIER_KEY = "Bundler_node:reward_multiplier";
export const REDIS_PRICE_KEY = "Bundler_node:price_per_byte";
export const REDIS_HEIGHT_KEY = "Bundler_node:current_height";
export const REDIS_LAST_SEEDED_KEY = "Bundler_node:last_seeded";
export const REDIS_CONVERSION_KEY = "Bundler_node:conversion";
export const REWARD_MULTIPLIER = 1.05;

export async function updateArweaveInfo(): Promise<void> {
  await Promise.all(Object.keys(currencies)
    .filter(key => key !== undefined)
    .map(async (currency) => {
      const c = currencies[currency];
      await redisClient.set(`${REDIS_HEIGHT_KEY}:${currency}`, (await c.getCurrentHeight()).toString()).catch(logger.error);
      if (currency === "arweave") await redisClient.set(REDIS_HEIGHT_KEY, (await c.getCurrentHeight()).toString()).catch(logger.error);
    }));

  await redisClient.set(REDIS_PRICE_KEY, Math.ceil(+await arweave.transactions.getPrice(0) / (3210)).toString());
  await syncConversionRates();
}

export async function currentBlockHeight(currency: string): Promise<number> {
  return +await redisClient.get(`${REDIS_HEIGHT_KEY}:${currency}`);
}

export async function currentPricePerByte(): Promise<number> {
  return +await redisClient.get(REDIS_PRICE_KEY);
}

export async function currentMultiplier(): Promise<number> {
  return +await redisClient.get(REDIS_MULTIPLIER_KEY);
}
