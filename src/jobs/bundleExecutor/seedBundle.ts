import { seedBundle } from "../../bundle/seedBundle";
import logger from "../../logger";
import { SandboxedJob } from "bullmq";
import { workerConnection } from "../../database/workerConnection.database";


export default async function (job: SandboxedJob): Promise<{ status: string, numOfNodes?: number }> {
  const isSeeded = await workerConnection("bundles")
    .select("is_seeded")
    .where("bundle_id", "=", job.data.bundleId)
    .first()
    .then(r => r?.is_seeded ?? true);

  if (isSeeded) return { status: "Bundle no longer exists" };

  let numOfNodes = 0;
  try {
    logger.info(`Executing bundle ${job.data.bundleId} seeding`);
    await job.log(`Executing bundle ${job.data.bundleId} seeding`);
    numOfNodes = await seedBundle(job.data.bundleId, job.log as any);
  } catch (e) {
    logger.error(`Error occurred while seeding bundle ${job.data.bundleId} - ${e.message}`);
    await job.log(`Error occurred while seeding bundle ${job.data.bundleId} - ${e.message}`);
    throw e;
  }
  return { status: "SEEDED", numOfNodes };
}
