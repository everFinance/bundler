import { Context } from "koa";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isArweaveAddress(address: string): boolean {
  if (!address) return undefined;
  const addr = address.toString().trim();
  return /[a-z0-9_-]{43}/i.test(addr);
}

export function makeError(ctx: Context, statusMsg: string, code = 400): void {
  ctx.res.statusCode = code;
  ctx.res.statusMessage = statusMsg;
}
