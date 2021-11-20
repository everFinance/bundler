import { Context } from "koa";
import { currencies } from "../../../currency";

export async function getPublic(ctx: Context): Promise<void> {
  ctx.response.status = 200;
  ctx.response.body = {
    n: currencies["arweave"].account.key.n
  }
}
