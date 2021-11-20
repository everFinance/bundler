import { Context } from "koa";
import { httpServerConnection } from "../../../database/httpServerConnection.database";

export async function getTopPeers(ctx: Context): Promise<void> {
  ctx.body = await httpServerConnection("peers")
    .select<{ peer: string }[]>("peer")
    .orderBy("trust", "desc")
    .limit(10)
    .then(r => r.map(row => row.peer));
  return;
}
