import { Context } from "koa";
import { calculateFee, calculateOtherFee } from "../../../arweave/utils";
import { currencies } from "../../../currency";
import _ from "lodash";

export async function getPrice(ctx: Context): Promise<void> {
  const currencyString = ctx.params.currency ?? "arweave";
  const currency = currencies[currencyString];
  if (!currency) {
    ctx.status = 400;
    ctx.message = "Currency not supported";
    return;
  }
  const size = +ctx.params.size;
  if (isNaN(size) || !Number.isInteger(size)) {
    ctx.status = 400;
    ctx.message = "Size must be an integer";
    return;
  }

  ctx.body = (currencyString === "arweave") ? _.sum(await calculateFee(+size)) : await calculateOtherFee(+size, currencyString);
}
