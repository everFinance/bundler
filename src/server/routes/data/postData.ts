import { Context } from "koa";
import * as fs from "fs";
import { createWriteStream, mkdir } from "fs";
import NextFunction from "../../nextFunction";
import { deepHash, MIN_BINARY_SIZE } from "arbundles";
import logger from "../../../logger";
import { tmpName } from "tmp-promise";
import { insertDataItem } from "../../../database/insert.transaction";
import { BUNDLES_PATH, currentBlockHeight } from "../../../constants";
import base64url from "base64url";
import { pipeline } from "stream/promises";
import { calculateOtherFee, hasSufficientFunds } from "../../../arweave/utils";
import { tmpdir } from "tmp";
import { stringToBuffer } from "arweave/node/lib/utils";
import Arweave from "arweave";
import { FileDataItem } from "arbundles/file";
import { httpServerConnection } from "../../../database/httpServerConnection.database";
import { s3Queue } from "../../../queues/queues";
import { currencies } from "../../../currency";
import { txExists } from "../../../database/select.transaction";
import { redisClient } from "../../../redis/client";
import { makeError, sleep } from "../../../utils/utils";

let WHITELIST = [];
try {
  WHITELIST = JSON.parse(fs.readFileSync("whitelist.json").toString());
  if (!Array.isArray(WHITELIST)) {
    logger.error("Whitelist must be an array");
    process.exit(1);
  }
} catch (e) {
  logger.info("Running with no whitelist");
}

mkdir(tmpdir + "/BundlerTemp", () => null);
mkdir(BUNDLES_PATH, { recursive: true }, () => null);
mkdir(BUNDLES_PATH + "/headers", { recursive: true }, () => null);
mkdir(BUNDLES_PATH + "/txs", { recursive: true }, () => null);
mkdir("./temp", () => null);


export async function initialChecks(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.req.headers["content-type"] !== "application/octet-stream") {
    logger.error("Wrong body type");
    ctx.status = 400;
    ctx.res.statusMessage = "Wrong body type";
    return;
  }

  ctx.state.filePath = await tmpName({ tmpdir: "./temp" });

  await next();
}


export async function fileUpload(ctx: Context, next: NextFunction): Promise<void> {
  const file = ctx.state.filePath;
  // Create write stream to a file
  const s = createWriteStream(file);

  const now = performance.now();
  // Pipe request body to file

  try {
    await pipeline(
      ctx.request.req,
      s,
    );
  } catch (e) {
    logger.error(`Error occurred while piping file: ${e}`);
    await fs.promises.unlink(file).catch(logger.error);
    ctx.status = 500;
    ctx.res.statusMessage = "Error occurred while piping file";
    return;
  }

  const after = performance.now();
  logger.verbose(`Piping to file took ${after - now}ms`);

  s.close();

  const status = await fs.promises.stat(file);

  if (status.size < MIN_BINARY_SIZE) {
    // If not valid delete file
    await fs.promises.unlink(file);
    logger.info("Invalid data item received and unlinked");
    ctx.res.statusCode = 400;
    ctx.res.statusMessage = "Invalid DataItem";
    return;
  }

  ctx.state.fileSize = status.size;

  await next();
}


export async function verifyUpload(ctx: Context, next: NextFunction): Promise<void> {
  const path = ctx.state.filePath;

  const currency = ctx.params.currency ?? "arweave";
  ctx.state.currency = currency;
  if (!currencies[currency]) {
    ctx.res.statusCode = 400;
    ctx.res.statusMessage = "Unknown/Unsupported currency.";
  }

  const c = currencies[currency];

  const now = performance.now();

  const item = new FileDataItem(path);

  ctx.state.address = await c.ownerToAddress(await item.rawOwner());

  ctx.state.finalFee = (await calculateOtherFee(ctx.state.fileSize, currency)).toNumber();
  ctx.state.whitelisted = isWhitelisted(ctx.state.address);
  if (!ctx.state.whitelisted) {
    const has = await hasSufficientFunds(httpServerConnection, ctx.state.address, currency, ctx.state.finalFee);
    if (!has) {
      ctx.status = 402;
      ctx.res.statusMessage = "Not enough balance for transaction";
      logger.debug(`Address ${ctx.state.address} has insufficient balance`);
      return;
    }
  } else {
    logger.debug(`Processing dataItem for whitelisted address ${ctx.state.address}`);
  }


  // Check if data item is valid
  if (!await item.isValid()) {
    // If not valid delete file
    await fs.promises.unlink(path);
    logger.info("Invalid data item received and unlinked");
    ctx.res.statusCode = 400;
    ctx.res.statusMessage = "Invalid DataItem";
    return;
  }

  ctx.state.address = await c.ownerToAddress(await item.rawOwner());
  //ctx.state.address = await arweave.wallets.ownerToAddress(await item.owner());

  while (await redisClient.exists(`Bundler_node:lock:${ctx.state.address}`)) {
    await sleep(1000);
  }

  const id = await c.getId(item);
  if (await txExists(httpServerConnection, id)) {
    ctx.status = 202;
    return;
  }
  //const id = base64url.encode(Buffer.from(await Arweave.crypto.hash(await item.rawSignature())));
  ctx.state.itemId = id;

  const now2 = performance.now();

  logger.info(`New data item received: ${id}`);

  logger.verbose(`\`verifyUpload\` takes ${now2 - now}ms`);

  try {
    await fs.promises.rename(path, BUNDLES_PATH + "/txs/" + id);
  } catch (e) {
    ctx.message = "ID already exists";
    ctx.status = 202;
    return;
  }

  await next();
}


export async function sendSignedResponse(ctx: Context): Promise<void> {
  const now = performance.now();
  const block = await currentBlockHeight("arweave") + 100;
  const dh = await deepHash([
    stringToBuffer("bundler"),
    stringToBuffer("1"),
    stringToBuffer(ctx.state.itemId as string),
    stringToBuffer(block.toString()),
  ]);

  const signature = await Arweave.crypto.sign(currencies["arweave"].account.key, dh).catch(logger.error);

  const arweaveAddress = currencies["arweave"].account.address;
  const trx = await httpServerConnection.transaction();
  if (!ctx.state.whitelisted) {
    const has = await hasSufficientFunds(trx, ctx.state.address, ctx.state.currency, ctx.state.finalFee);
    if (!has) {
      logger.debug(`Address ${ctx.state.address} has insufficient balance`);
      return makeError(ctx, "Not enough balance for transaction", 402);
    }
  }
  logger.info(`Item received from ${ctx.state.currency} address ${ctx.state.address}`);
  if (!await insertDataItem(trx, {
    data_item_id: ctx.state.itemId,
    address: ctx.state.address,
    size: ctx.state.fileSize,
    fee: (ctx.state.whitelisted || ctx.state.address === arweaveAddress) ? 0 : ctx.state.finalFee,
    currency: ctx.state.currency,
    signature: signature as any,
    current_block: await currentBlockHeight("arweave"),
    expected_block: block,
  })) {
    logger.error("Rolling back file changes due to bad data insert");
    await trx.rollback().catch(logger.error);
    await fs.promises.unlink(`${BUNDLES_PATH + "/txs/" + ctx.state.itemId}`).catch(logger.error);
    ctx.status = 500;
    return;
  }

  try {
    await fs.promises.stat(`${BUNDLES_PATH}/txs/${ctx.state.itemId}`);
    await s3Queue.add("Push to S3", { txId: ctx.state.itemId }, {
      attempts: 3,
      timeout: 30 * 1000,
      backoff: 10000,
      removeOnComplete: true,
    });
  } catch (e) {
    await trx.rollback();
    ctx.status = 500;
    return;
  }

  await trx.commit();

  ctx.set("Content-Type", "application/json");

  ctx.response.status = 200;
  ctx.response.body = {
    id: ctx.state.itemId,
    // It doesn't allow hex encoding in buffer conversion
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    signature: base64url.encode(signature),
    block: block,
  };

  const now2 = performance.now();

  logger.verbose(`\`sendSignedResponse\` takes ${now2 - now}ms`);
}

function isWhitelisted(address: string): boolean {
  if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return WHITELIST.some((val: string) => val.toLowerCase() === address);
  } else {
    return WHITELIST.includes(address);
  }
}
