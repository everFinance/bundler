import { Context } from "koa";
import { insertExternalDataItem } from "../../database/insert.transaction";
import { externalTxExists, getAddressFromDomain } from "../../database/select.transaction";
import logger from "../../logger";
import { deepHash } from "arbundles";
import { stringToBuffer } from "arweave/node/lib/utils";
import Arweave from "arweave";
import base64url from "base64url";
import { NewTxBody } from "../../types/NewTx";
import { httpServerConnection } from "../../database/httpServerConnection.database";

export async function newTx(ctx: Context): Promise<void> {
  const origin = ctx.headers.origin!;
  if (!origin) {
    ctx.status = 400;
    return;
  }
  const peerAddress = await getAddressFromDomain(httpServerConnection, origin);
  const body = ctx.request.body as unknown as NewTxBody;

  if (await externalTxExists(httpServerConnection, body.id)) {
    ctx.status = 202;
    return;
  }
  if (!await verifyReceipt(body)) {
    ctx.status = 400;
    return;
  }

  ctx.status = 200;
  await insertExternalDataItem(httpServerConnection, { ...body, peer_address: peerAddress })
    .catch(e => {
      logger.verbose(`Error occurred when inserting external data item: ${e}`);
      ctx.status = 400
    });
}

async function verifyReceipt(components: NewTxBody): Promise<boolean> {
  const { id, block, signature, publicKey } = components;

  const expected = await deepHash([
    stringToBuffer("bundler"),
    stringToBuffer("1"),
    stringToBuffer(id),
    stringToBuffer(block.toString())
  ]);

  return await Arweave.crypto.verify(publicKey, expected, Buffer.from(base64url.decode(signature, "hex"), "hex"));
}
