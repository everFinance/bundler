import * as MQ from "bullmq";
import { REDIS_CONFIG } from "../constants";

console.log(REDIS_CONFIG);
export type BundleJob = { bundleId: number, txId: string, blockPosted: number, multiplier: number, itemCount: number };
export type BundleExecutorJob = { bundleId: number } | { txId: string };
export type S3Job = { txId: string };

export const bundleQueue = new MQ.Queue<BundleJob>("Bundle queues", { connection: REDIS_CONFIG.redis });

export const bundleExecutorQueue = new MQ.Queue<BundleExecutorJob>("Bundle Executor Queue", { connection: REDIS_CONFIG.redis });

export const s3Queue = new MQ.Queue<S3Job>("S3 Queue", { connection: REDIS_CONFIG.redis });
