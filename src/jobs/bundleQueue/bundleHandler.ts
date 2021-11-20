import { getTxStatus, TransactionStatus } from "../bundleQueue";
import { workerConnection } from "../../database/workerConnection.database";
import logger from "../../logger";
import { SandboxedJob } from "bullmq";
import { BundleJob } from "../../queues/queues";

export default async function(job: SandboxedJob<BundleJob>): Promise<TransactionStatus> {
  const txId = job.data.txId;

  // Get tx status
  const status = await getTxStatus(workerConnection, txId, job.data.bundleId, job.data.blockPosted);
  await job.log(`${txId} - ${status}`);
  switch (status) {
    case TransactionStatus.PENDING:
      throw new Error("Not seeded yet - pending");
    case TransactionStatus.DROPPED:
      logger.debug(`Dropped with - ${status}`);
      throw new Error("Not seeded yet - dropped");
    case TransactionStatus.SEEDED: {
      await workerConnection("bundles")
        .where("bundle_id", "=", job.data.bundleId)
        .update("is_seeded", true);
      return status;
    }
  }
}
