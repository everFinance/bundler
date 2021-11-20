import { Context } from "koa";
import NextFunction from "../../nextFunction";
import { getBundlerPeersFromDb, getRandomBundlerPeersFromDb } from "../../../database/select.transaction";
import { workerConnection } from "../../../database/workerConnection.database";

export async function getPeers(ctx: Context, next: NextFunction): Promise<void> {
  ctx.body = await getBundlerPeersFromDb(workerConnection);
  await next();
}

export async function getRandomPeers(ctx: Context, next: NextFunction): Promise<void> {
  const amount = ctx.params.count;
  ctx.body = await getRandomBundlerPeersFromDb(workerConnection, +amount);
  await next();
}
