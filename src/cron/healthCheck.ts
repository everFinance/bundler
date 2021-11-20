import { redisClient } from "../redis/client";
import { REDIS_LAST_SEEDED_KEY } from "../constants";
import FormData from "form-data";
import axios from "axios";
import logger from "../logger";
import { hostname } from "os";
import { bundleQueue } from "../queues/queues";
import { currencies } from "../currency";

const REDIS_LAST_NOTIFIED_KEY = "Bundler_node:last_notified";

export async function runHealthCheck(): Promise<void> {
  logger.info("Running health check");
  const lastSeeded = +await redisClient.get(REDIS_LAST_SEEDED_KEY);
  const now = Date.now();

  if ((now - lastSeeded) > 7.2e+6 && await bundleQueue.getDelayedCount() != 0) {
    const lastNotified = +await redisClient.get(REDIS_LAST_NOTIFIED_KEY);
    if (!isNaN(lastNotified) && (now - lastNotified) < 1.8e+6) return;

    const data = new FormData();
    data.append("content", `WARNING: Nothing has seeded for last 4 hours for ${hostname()} : ${currencies["arweave"].account.address}\n<@&865361015328079883>`);
    data.append("username", "Bundler-Prod");

    logger.info("WARNING: Nothing has seeded for last 4 hours");

    try {
      await axios.post(
        "https://discord.com/api/webhooks/888389228940128287/rWUQuK0D8TKZ7cJMmyDMHRayeYyzb2tzTx2-oIdUHyvm1SenQzozTK6eFK8AVoHX7fQb",
        data,
        {
          headers: { ...data.getHeaders() },
        });

      await redisClient.set(REDIS_LAST_NOTIFIED_KEY, Date.now().toString());
      // eslint-disable-next-line no-empty
    } catch (e) {
    }
  }
}

runHealthCheck();
