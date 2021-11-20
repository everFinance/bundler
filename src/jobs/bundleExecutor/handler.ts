import { SandboxedJob } from "bullmq";
import { BundleExecutorJob } from "../../queues/queues";
import postBundle from "./postBundle";
import seedBundle from "./seedBundle";
import reseedBundle from "./reseedBundle";

export default async function(job: SandboxedJob<BundleExecutorJob>) {
  switch (job.name) {
    case "Post bundle":
      return await postBundle(job);
    case "Seed bundle":
      return await seedBundle(job);
    case "Reseed bundle":
      return await reseedBundle(job);
  }

  throw new Error("No valid handler for this job")
}
