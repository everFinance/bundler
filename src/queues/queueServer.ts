import { KoaAdapter } from "@bull-board/koa";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { bundleExecutorQueue, bundleQueue, s3Queue } from "./queues";

const serverAdapter = new KoaAdapter();

createBullBoard({
  queues: [
    new BullMQAdapter(s3Queue),
    new BullMQAdapter(bundleExecutorQueue),
    new BullMQAdapter(bundleQueue)
  ],
  serverAdapter
});

serverAdapter.setBasePath("/queues/ui");

export default serverAdapter;
