import { bundleExecutorQueue } from "../src/queues/queues";
import { now } from "lodash";
import { exec as e } from "child_process";
import { promisify } from "util";
import  logger from "../src/logger";
const exec = promisify(e);

(async function() {
  const activeJobs = await bundleExecutorQueue.getJobs(["active"]);

  for (const job of activeJobs) {
    if (now() - job.timestamp > 1.8e+6) {
      await restartExecutor();
      return;
    }
  }
})()
  .then(_ => process.exit(0))
  .catch(_ => process.exit(1));

async function restartExecutor(): Promise<void> {
  logger.info("Restarting executor");
  await exec("pm2 restart BundleExecutor");
}
