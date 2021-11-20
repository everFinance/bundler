import { isNil } from "lodash";
import { executeBundle } from "../../cron/bundle";
import { workerConnection } from "../../database/workerConnection.database";
import logger from "../../logger";

export default async function(job): Promise<any> {
  logger.info(`Starting posting bundle ${job.data.bundleId} job`);
  await job.log(`Starting posting bundle ${job.data.bundleId} job`);
  const txId = await workerConnection("bundles")
    .select("tx_id")
    .where("bundle_id", "=", job.data.bundleId)
    .first()
    .then(r => r?.tx_id);

  if (!isNil(txId)) return { stats: "INVALID_BUNDLE" };

  let jobId;
  try {
    jobId = await executeBundle(job);
    if (isNil(jobId)) throw new Error("Job ID received from executeBundle is NaN");
  } catch (e) {
    let dateCreated;
    const id = /[a-z0-9_-]{43}/i.exec(e.message)?.[0];
    if (id) {
      dateCreated = await workerConnection
        .select("date_created")
        .from("data_items")
        .where("data_item_id", "=", id)
        .first()
        .then(r => r.date_created);
    }
    logger.error(`Error occurred while processing bundle ${job.data.bundleId} - ${e}`);
    await job.log(`Error occurred while processing bundle ${job.data.bundleId} - ${e}`);
    if (dateCreated) await job.log(`${id} was added at ${dateCreated}`);
    throw e;
  }

  return { status: "POSTED", jobId };
}
