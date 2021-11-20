// import websockify from "koa-websocket";
// import logger from "../../logger";
// import { currencyTxExists } from "../../database/select.transaction";
// import * as fs from "fs";
// import { createWriteStream, mkdir } from "fs";
// import { insertDataItem } from "../../database/insert.transaction";
// import { currentBlockHeight } from "../../constants";
// import { Currency } from "../../types/Transaction";
// import { solanaTxValid } from "./solana";
// import { tmpName } from "tmp-promise";
// import { tmpdir } from "tmp";
// import { FileDataItem } from "arbundles/file";
// import { httpServerConnection } from "../../database/httpServerConnection.database";
//
// mkdir(tmpdir + "/BundlerTemp", () => null);
//
// // export function setupWs(app: websockify.App): void {
// //   app.ws.use(router.all("/tx/:currency", function(ctx) {
// //     let phase = 0;
// //     let amounts: Record<string, number> = {};
// //     ctx.websocket.on("message", async function(message) {
// //       const filename = await tmpName({ dir: "BundlerTemp" });
// //       const stream = createWriteStream(filename);
// //       switch (phase) {
// //         case 0: {
// //           if (message === "DONE") {
// //             stream.close();
// //             logger.verbose("Phase 0 done");
// //             phase++;
// //             // Verify file
// //             // TODO: Implement Solana verification
// //             const item = new FileDataItem(filename)
// //             // TODO: Change
// //             if (!await item.isValid()) {
// //               ctx.websocket.close(400, "Invalid data item");
// //             }
// //             amounts = await getDataPrice(ctx.params.currency, await fs.promises.stat(filename).then(s => s.size));
// //             // Send JSON with currency prices
// //             ctx.websocket.send(amounts)
// //           }
// //           stream.write(message);
// //           break;
// //         }
// //         case 1: {
// //           const { id } = JSON.parse(message.toString());
// //           const currency = ctx.params.currency;
// //           if (amounts === {}) {
// //             ctx.websocket.close(500, "Amount can't be calculated")
// //           }
// //           // Lookup id using solana rpc
// //           if (!await isTxValid(currency, id, amounts[currency])) {
// //             // Delete file
// //             await fs.promises.unlink(filename);
// //             ctx.websocket.close(402, "Invalid tx");
// //             return;
// //           }
// //
// //           // Add tx and data item to db
// //           await insertDataItem(httpServerConnection, {
// //             data_item_id: id,
// //             address: "",
// //             size: 1,
// //             currency: Currency.SOLANA,
// //             fee: amounts[currency],
// //             fee_transaction: id,
// //             signature: Uint8Array.from([]),
// //             current_block: currentBlockHeight,
// //             expected_block: currentBlockHeight + 50
// //           })
// //           break;
// //         }
// //       }
// //     });
// //     ctx.websocket.on("close", function() {
// //       console.log("CLOSED");
// //     })
// //     ctx.websocket.on("error", function(error) {
// //       console.log("ERROR " + error.message);
// //     })
// //     ctx.websocket.on("ping", function() {
// //       ctx.websocket.send("pong");
// //     })
// //   }));
// // }
//
// async function isTxValid(id: string, currency: string, expected: number): Promise<boolean> {
//   // Does tx already exist
//   if (await currencyTxExists(httpServerConnection, currency, id)) {
//     return false;
//   }
//   switch (currency) {
//     case "solana": {
//       return await solanaTxValid(id, expected);
//     }
//     default:
//       throw Error("Unimplemented currency")
//   }
// }
//
// async function getDataPrice(currency: string, bytes: number): Promise<Record<string, number>> {
//   console.log(currency);
//   console.log(bytes);
//   return {
//     solana: bytes
//   }
// }
