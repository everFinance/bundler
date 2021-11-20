import { config } from "dotenv";
import { bundleExecutorQueue } from "../queues/queues";
import path from "path";
import * as MQ from "bullmq";

process.env = { ...process.env, ...config().parsed };
if (!process.env.RUN) process.exit(0);

export function registerBundleExecutorQueueJobs(): void {
  const executorScheduler = new MQ.QueueScheduler(bundleExecutorQueue.name);

  const worker = new MQ.Worker(bundleExecutorQueue.name, path.resolve("./build/src/jobs/bundleExecutor/handler"), { concurrency: 5 });

  process.on("SIGINT", () => {
    Promise.all([worker.close(), executorScheduler.close()])
      .then(_ => process.exit(0))
      .catch(_ => process.exit(1));
  });
}

registerBundleExecutorQueueJobs();



