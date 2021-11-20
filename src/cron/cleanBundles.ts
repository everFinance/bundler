import logger from "../logger";
import * as fs from "fs";
import { BUNDLES_PATH } from "../constants";

export async function cleanBundles(): Promise<void> {
  logger.info("Cleaning bundles folder");

  await Promise.all([
    cleanFolder(await fs.promises.readdir(BUNDLES_PATH + "/bundles/txs")),
    cleanFolder(await fs.promises.readdir(BUNDLES_PATH + "/bundles/headers"))
  ]);
}

const TWO_DAYS = 1.728e+8;

async function cleanFolder(files: string[]): Promise<void> {
  const now = Date.now();
  for (const file in files) {
    const stat = await fs.promises.stat(file);
    if ((now - stat.birthtime.getTime()) > TWO_DAYS) {
      await fs.promises.unlink(file);
    }
  }
}
