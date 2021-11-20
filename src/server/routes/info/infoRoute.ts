import { Context } from "koa";
import { currencies } from "../../../currency";
import * as fs from "fs";

const version = JSON.parse(fs.readFileSync("package.json").toString()).version;

export async function infoRoute(ctx: Context): Promise<void> {
  ctx.body = {
    version,
    addresses: Object.fromEntries(Object.entries(currencies).map(([currency, config]) => [currency, config.account.address])),
    gateway: process.env.GATEWAY_HOST
  }

  return;
}
