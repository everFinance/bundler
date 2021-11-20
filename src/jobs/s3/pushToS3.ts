import { BUNDLES_PATH, S3_BUCKET } from "../../constants";
import { s3 } from "../../s3/s3";
import { getContentType } from "../../utils/contentType";
import logger from "../../logger";
import { FileDataItem } from "arbundles/file";
import * as fs from "fs";
import { SandboxedJob } from "bullmq";

export default async function(job: SandboxedJob): Promise<string> {
  const { txId } = job.data;
  logger.info(`Pushing ${txId} to S3`);
  await job.log(`Pushing ${txId} to S3`);

  if (await s3.statObject(S3_BUCKET, txId).then(_ => true).catch(_ => false)) return "ALREADY_SENT";

  const path = `${BUNDLES_PATH}/txs/${txId}`;
  try {
    const item = new FileDataItem(path);
    const contentType = getContentType(await item.tags());

    logger.info(`Putting ${txId} to S3 with ${contentType}`);
    await job.log(`Putting ${txId} to S3 with ${contentType}`);

    await s3.putObject(
      S3_BUCKET,
      txId,
      fs.createReadStream(path),
      {
        "Content-Type": getContentType(await item.tags()),
        "data.start": await item.dataStart(),
      },
    );
      logger.info(`Put ${txId} to S3`);
      await job.log(`Put ${txId} to S3`);

      await s3.statObject(S3_BUCKET, txId);

      await fs.promises.unlink(path)
        .then(async (_) => {
          await job.log(`Unlinked ${txId}`);
        });

  } catch (e) {
    logger.error(`Error occurred while putting ${txId} in S3 - ${e}`);
    await job.log(`Error occurred while putting ${txId} in S3 - ${e}`);
    throw e;
  }
  return "SENT";
}
