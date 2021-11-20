import { BUNDLES_PATH } from "../src/constants";
import * as fs from "fs";
import { now } from "lodash";
import logger from "../src/logger";

(async function() {
  const dir = await fs.promises.opendir(`${BUNDLES_PATH}/headers`);

  const n = now();
  for await (const file of dir) {
    const fileName = `${BUNDLES_PATH}/headers/${file.name}`;
    const age = n - await fs.promises.stat(fileName).then(r => r.birthtimeMs);
    if (age > 8.64e+7) fs.promises.unlink(fileName);
  }
})()
.then(_ => process.exit(0))
.catch(e => {
  logger.error(e);
  process.exit(1);
})
