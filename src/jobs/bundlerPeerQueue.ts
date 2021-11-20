// import { Job } from "bull";
// import { BundlerPeer } from "../types/bundlerPeer";
// import logger from "../logger";
// import { getBundlerPeersFromDb } from "../database/select.transaction";
// // import { DocumentNode } from "graphql";
// // import { createHttpLink } from "apollo-link-http";
// // import ApolloClient from "apollo-client";
// // import { InMemoryCache } from "apollo-boost";
// // import fetch from "node-fetch";
// import { NewTxBody } from "../types/NewTx";
// import { bundlerPeerQueue } from "../queues/queues";
// import axios from "../axios";
// import { workerConnection } from "../database/workerConnection.database";
//
//
// // type BundlerGraphqlPeerJob = Job<{ peer: BundlerPeer, query: DocumentNode }>;
//
// type PropagationJob = Job<NewTxBody>;
//
// export function registerBundlePeerJobs(): void {
//   bundlerPeerQueue.on("failed", async (_, error) => {
//     logger.error(`Error occurred: ${error.message}`);
//   });
//
//   // bundlerPeerQueue.process("Handle graphql deferred slash", async function (job: BundlerGraphqlPeerJob, done) {
//   //   const { host, port } = job.data.peer;
//   //   logger.verbose(`Testing graphql ${host}`);
//   //
//   //   const link = createHttpLink({ uri: `http://${host}:${port}/graphql`, fetch, fetchOptions: { timeout: 10000 } });
//   //
//   //   const client = new ApolloClient({
//   //     link: link,
//   //     cache: new InMemoryCache(),
//   //   });
//   //
//   //   try {
//   //     await client
//   //       .query({
//   //         query: job.data.query
//   //       });
//   //   } catch (e) {
//   //     await voteToSlash(job.data.peer)
//   //   }
//   //   done();
//   // });
//
//
//   // bundlerPeerQueue.process("Propagate data item", async function (job: PropagationJob, done) {
//   //   const peers = await getBundlerPeersFromDb(workerConnection)
//   //     .catch(logger.error) as BundlerPeer[];
//   //   await onThresholdSuccess(peers.map(async (peer) => {
//   //
//   //     await axios.post(`http://${peer.host}:${peer.port}/newTx`, { ...job.data, peer_address: peer.address }, { timeout: 3000 })
//   //       .catch(logger.error);
//   //   }))
//   //     // TODO: Change
//   //     .catch(_ => null);
//   //   done();
//   // });
//
//
//   // bundlerPeerQueue.process("Handle propagate deferred slash", async function (job: Job, done) {
//   //   const { host, port } = job.data.peer;
//   //   logger.verbose(`Testing propagation ${host}`);
//   //
//   //   const body = {
//   //     id: job.data.data_item_id
//   //   };
//   //
//   //   await axios.post(`http://${host}:${port}/newTx`, body, { timeout: 3000 })
//   //     .catch(async (e) => {
//   //       if (e.code === "ECONNREFUSED" || e.response?.status) {
//   //         await voteToSlash(job.data.peer);
//   //       }
//   //     });
//   //
//   //   done();
//   // })
// }
//
//
//
// // async function voteToSlash(peer: BundlerPeer): Promise<void> {
// //   logger.info(`Voting to slash ${peer.address}`);
// // }
//
// const PROPAGATION_THRESHOLD = 1;
//
// /**
//  *  Resolves if threshold `n` is met
//  *  This will return an array of errors if >`n` promises resolve
//  *
//  * @param promises
//  */
// function onThresholdSuccess(promises: PromiseLike<void>[]): Promise<void | Error[]> {
//   let count = 0;
//   return Promise.all(promises.map(p => {
//     return p.then(
//       _ => {
//         count++;
//         if (count >= PROPAGATION_THRESHOLD) return Promise.reject();
//         return Promise.resolve(count);
//       },
//       err => {
//         return Promise.resolve(err)
//       }
//     );
//   })).then(
//     errors => Promise.reject(errors),
//     _ => Promise.resolve()
//   );
// }
