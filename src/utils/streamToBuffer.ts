export async function streamToBuffer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const bufs = [];
  return new Promise((resolve, reject) => s
    .on("data", (d) => bufs.push(d))
    .on("error", reject)
    .on("end", () => resolve(Buffer.concat(bufs)))
  );
}
