import { seedBundle } from "../../bundle/seedBundle";
import logger from "../../logger";
import { SandboxedJob } from "bullmq";
import { workerConnection } from "../../database/workerConnection.database";
import { MAX_PEER_PUSH } from "../../constants";


export default async function (job: SandboxedJob): Promise<{ status: string, numOfNodes?: number }> {
  const isSeeded = await workerConnection("bundles")
    .select("is_seeded")
    .where("bundle_id", "=", job.data.bundleId)
    .first()
    .then(r => r?.is_seeded ?? true);

  if (isSeeded) return { status: "Bundle no longer exists" };

  let numOfNodes = 0;
  try {
    logger.info(`Executing bundle ${job.data.bundleId} reseeding`);
    await job.log(`Executing bundle ${job.data.bundleId} reseeding`);
    numOfNodes = await seedBundle(job.data.bundleId, job.log as any, { maxPeerPush: MAX_PEER_PUSH });
    if (isNaN(numOfNodes)) return { status: "DELETED_BUNDLE" };
  } catch (e) {
    logger.error(`Error occurred while reseeding bundle ${job.data.bundleId} - ${e}`);
    await job.log(`Error occurred while reseeding bundle ${job.data.bundleId} - ${e}`);
    throw e;
  }
  return { status: "SEEDED", numOfNodes };
}
