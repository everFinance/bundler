import { SandboxedJob } from "bullmq";
import { S3Job } from "../../queues/queues";
import pushToS3 from "./pushToS3";

export default async function(job: SandboxedJob<S3Job>) {
  switch (job.name) {
    case "Push to S3":
      return await pushToS3(job);
  }

  throw new Error("No valid handler for this job")
}
