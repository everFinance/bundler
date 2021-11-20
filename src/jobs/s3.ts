import * as MQ from "bullmq";
import { s3Queue } from "../queues/queues";
import path from "path";
import logger from "../logger";
import { config } from "dotenv";
import { CronJob } from "cron";
import tcpp from "tcp-ping";

process.env = { ...process.env, ...config().parsed };
if (!process.env.RUN) process.exit(0);

function registerS3Worker(): void {
  const s3scheduler = new MQ.QueueScheduler(s3Queue.name);
  const worker = new MQ.Worker(s3Queue.name, path.resolve("./build/src/jobs/s3/handler"), { concurrency: 10 });
  new CronJob(
    "*/10 * * * * *",
    async function() {

      const alive = await new Promise((resolve, reject) => tcpp.probe(process.env.S3_ENDPOINT, +process.env.S3_PORT, (err, res) => {
        if (err) reject(err);
        resolve(res);
      }));
      if (!alive) {
        logger.error("S3 not alive - pausing worker");
        await worker.pause(true);
      } else if (worker.isPaused()) {
        logger.info("S3 back online - resuming...");
        worker.resume();
      }
    },
    null,
    true
  );

  const s3events = new MQ.QueueEvents(s3Queue.name);
  s3events.on("stalled", async ({ jobId }) => {
    const job = await s3Queue.getJob(jobId);
    logger.error(`Bundle queue job stalled for job id: ${jobId} handling tx id: ${job.data.txId}`);
  });
  s3events.on("error", (error) => logger.error("Bundle peer queue job errored", error));

  process.on("SIGINT", () => {
    Promise.all([worker.close(), s3events.close(), s3scheduler.close()])
      .then(_ => process.exit(0))
      .catch(_ => process.exit(1));
  });
}

registerS3Worker();
