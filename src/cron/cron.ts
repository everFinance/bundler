import cron from "node-cron";
import { bundleItems, bundleOldItems, bundlerLocked } from "./bundle";
import { syncBalances } from "./syncBalances";
import { crawlForPeers } from "./crawlForPeers";
import { updateArweaveInfo } from "../constants";
import { runHealthCheck } from "./healthCheck";
import logger from "../logger";
import minimist from "minimist";
import { CronJob } from "cron";
import { updateStats } from "./updateStats";

const args = minimist(process.argv.slice(2));

export async function runBundlerCron(): Promise<void> {
  if (args.bundle ?? false) {
    logger.info("Running singleton process with bundling");
    bundleItems()
      .catch(e => {
        logger.error(`Error occurred while bundling items - ${e}`);
        process.exit(1);
      });

    bundleOldItems()
      .catch(e => {
        logger.error(`Error occurred while bundling old items - ${e}`);
        process.exit(1);
      });
  } else {
    logger.info("Running singleton process without bundling");
  }

  updateArweaveInfo();
  cron.schedule("*/30 * * * * *", updateArweaveInfo);


  let syncBalancesJobLocked = false;
  new CronJob(
    "0 */1 * * * *",
    async function() {
      if (!syncBalancesJobLocked) {
        syncBalancesJobLocked = true;
        await syncBalances()
          .catch(e => {
            logger.error(`Error occurred while syncing balance - ${e}`);
          });

        syncBalancesJobLocked = false;
      }
    },
    null,
    true
  );

  let crawlForPeersJobLocked = false;
  new CronJob(
    "0 */20 * * * *",
    async function() {
      if (!crawlForPeersJobLocked) {
        crawlForPeersJobLocked = true;
        await crawlForPeers()
          .catch(e => logger.error(`Error occurred while crawling for peers - ${e}`));
        crawlForPeersJobLocked = false
      }
    },
    null,
    true
  );
  let healthCheckJobLocked = false;
  new CronJob(
    "0 */2 * * * *",
    async function() {
      if (!healthCheckJobLocked) {
        healthCheckJobLocked = true;
        await runHealthCheck()
          .catch(e => logger.error(`Error occurred while doing health check - ${e}`));

        healthCheckJobLocked = false;
      }
    },
    null,
    true
  );

  updateStats();
  let statsUpdateJobLocked = false;
  new CronJob(
    "0 */2 * * * *",
    async function() {
      if (!statsUpdateJobLocked) {
        statsUpdateJobLocked = true;
        await updateStats()
          .catch(e => logger.error(`Error occurred while updating stats - ${e}`));

        statsUpdateJobLocked = false;
      }
    },
    null,
    true
  );


  process.on("SIGINT", () => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    Promise.all([
      (async function() {
        while (!bundlerLocked) await sleep(2000);
      })()
    ])
      .then(_ => process.exit(0))
      .catch(_ => process.exit(1));
  });
}
