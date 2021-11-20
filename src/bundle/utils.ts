import logger from "../logger";
import { BUNDLES_PATH, S3_BUCKET } from "../constants";
import fs from "fs";
import { s3 } from "../s3/s3";
import { longTo32ByteArray } from "../utils/byterarrays";
import base64url from "base64url";
import MultiStream from "multistream";
import { promisify } from "util";
import retry from "async-retry";

const CombineStreams = MultiStream.obj;
const read = promisify(fs.read);

export async function generateStream(headerFilename: string, txIds: string[]): Promise<NodeJS.ReadableStream> {
  logger.verbose(`Generating stream for ${headerFilename}`);
  const streams = [];
  for (const txId of txIds) {
    const path = `${BUNDLES_PATH}/txs/${txId}`;
    if (!await fs.promises.stat(path).then(_ => true).catch(_ => false)) await s3.fGetObject(S3_BUCKET, txId, path).catch(e => {
      e.message = `${txId} - ${e.message}`;
      throw e;
    });
    streams.push(fs.createReadStream(path));
  }
  return CombineStreams([fs.createReadStream(headerFilename), ...streams]);
}

export async function cleanupStreamFiles(txIds: string[]): Promise<void> {
  for (const txId of txIds) await fs.promises.unlink(`${BUNDLES_PATH}/txs/${txId}`);
}

export async function generateHeaderFile(bundleId: number, txIds: string[]): Promise<string> {
  const headerFilename = `${process.cwd()}/${BUNDLES_PATH}/headers/bundle_header_${bundleId}`;

  if (!await fs.promises.stat(headerFilename).catch(_ => false)) {
    logger.verbose(`Generating header file for bundle ${bundleId}`);
    const fileStream = fs.createWriteStream(headerFilename);
    fileStream.on("error", logger.error);
    const drain = fileStream.write(Uint8Array.from(longTo32ByteArray(txIds.length)));
    if (!drain) await waitForDrain(fileStream);

    for (let i = 0; i < txIds.length; i++) {
      const txId = txIds[i];
      // Construct header in file
      let size;
      try {
        size = await retry(async () => s3.statObject(S3_BUCKET, txId)
          .then(r => longTo32ByteArray(r.size)), { retries: 3 });
      } catch (e) {
        logger.error(`Error occurred while getting size of ${txId}`);
        throw e;
      }
      const id = base64url.toBuffer(txId);
      if (id.byteLength !== 32) {
        throw new Error("Incorrect txId");
      }

      const drain2 = fileStream.write(size);
      if (!drain2) await waitForDrain(fileStream);
      const drain3 = fileStream.write(id);
      if (!drain3) await waitForDrain(fileStream);

    }

    await new Promise(resolve => {
      fileStream.end(resolve);
    });
  }

  const file = await fs.promises.open(headerFilename, "r");
  for (let i = 0; i < txIds.length; i++) {
    const txId = base64url.encode(await read(file.fd, Buffer.allocUnsafe(32), 0, 32, 64 + (i * 64)).then(r => Buffer.from(r.buffer)));
    if (txId !== txIds[i]) {
      await fs.promises.unlink(headerFilename);
      await file.close();
      throw new Error("Header file malformed");
    }
  }
  await file.close();
  return headerFilename;
}


function waitForDrain(s: NodeJS.WritableStream): Promise<void> {
  logger.verbose("Waiting for drain on stream");
  return new Promise(resolve => s.on("drain", resolve));
}
