import { Context } from "koa";
import * as fs from "fs";
import { BUNDLES_PATH, S3_BUCKET } from "../../../constants";
import { FileDataItem } from "arbundles/file";
import logger from "../../../logger";
import { s3 } from "../../../s3/s3";
import { isArweaveAddress } from "../../../utils/utils";

export async function getTx(ctx: Context): Promise<void> {
  const txId = ctx.params.txId;
  if (!txId) {
    ctx.message = "No id given";
    ctx.status = 400;
    return;
  }

  if (!isArweaveAddress(txId)) {
    ctx.message = "Invalid id given";
    ctx.status = 400;
    return;
  }

  const path = `${BUNDLES_PATH}/txs/${txId}`;
  if (await fs.promises.stat(path).catch(_ => false)) {
    logger.info(`${txId} in fs`);

    const item = new FileDataItem(path);

    const tags = await item.tags();

    logger.verbose(tags);
    const contentType = getContentType(tags);

    logger.verbose(`Sending with content type ${contentType ?? "application/octet-stream"}`);

    const dataStart = await item.dataStart();
    ctx.set("Content-Type", contentType ?? "application/octet-stream");
    ctx.set("Content-Length", (await item.size() - dataStart).toString());

    ctx.body = fs.createReadStream(path, { start: dataStart });
    ctx.status = 200;
    return;
  }

  try {
    const headObject = await s3.statObject(S3_BUCKET, txId);
    logger.verbose(`${txId} found in bucket`);
    const contentType = headObject.metaData["content-type"];

    const dataStart = +headObject.metaData["data.start"];

    const itemSize = headObject.size;
    logger.info(`Content-Type ${contentType}`);
    logger.info(`Content-Type ${contentType ?? "application/octet-stream"}    Content-Length ${itemSize - dataStart}`);

    ctx.set("Content-Type", contentType ?? "application/octet-stream");
    ctx.set("Content-Length", (itemSize - dataStart).toString());


    ctx.body = await s3.getPartialObject(S3_BUCKET, txId, dataStart, itemSize);
    ctx.status = 200;
    return;
  } catch (e) {
    logger.verbose(`${txId} not found in bucket`);

    ctx.message = "Tx doesn't exist";

    ctx.status = 404;
    return;
  }
}

export async function getTxHead(ctx: Context): Promise<void> {
  const txId = ctx.params.txId;
  if (!txId) {
    ctx.message = "No id given";
    ctx.status = 400;
    return;
  }

  if (!isArweaveAddress(txId)) {
    ctx.message = "Invalid id given";
    ctx.status = 400;
    return;
  }

  logger.info("Looking in fs");
  const path = `${BUNDLES_PATH}/txs/${txId}`;
  if (await fs.promises.stat(path).catch(_ => false)) {
    logger.info(`${txId} in fs`);

    const item = new FileDataItem(path);

    const tags = await item.tags();

    logger.verbose(tags);
    const contentType = getContentType(tags);

    logger.verbose(`Sending with content type ${contentType ?? "application/octet-stream"}`);

    const dataStart = await item.dataStart();
    ctx.set("Content-Type", contentType ?? "application/octet-stream");
    ctx.set("Content-Length", (await item.size() - dataStart).toString());

    ctx.status = 200;
    return;
  }

  try {
    logger.info("Looking in S3");

    const headObject = await s3.statObject(S3_BUCKET, txId);
    logger.verbose(`${txId} found in bucket`);
    const contentType = headObject.metaData["content-type"];

    const dataStart = +headObject.metaData["data.start"];

    const itemSize = headObject.size;
    logger.info(`Content-Type ${contentType}`);
    logger.info(`Content-Type ${contentType ?? "application/octet-stream"}    Content-Length ${itemSize - dataStart}`);

    ctx.set("Content-Type", contentType ?? "application/octet-stream");
    ctx.set("Content-Length", (itemSize - dataStart).toString());

    ctx.status = 200;
    return;
  } catch (e) {
    logger.verbose(`${txId} not found in bucket`);

    ctx.message = "Tx doesn't exist";

    ctx.status = 404;
    return;
  }
}


function getContentType(tags: { name: string, value: string }[]): string | undefined {
  for (const tag of tags) {
    if (tag.name.toLowerCase() === "content-type") {
      return tag.value;
    }
  }
  return undefined;
}
