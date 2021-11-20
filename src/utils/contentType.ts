export function getContentType(tags: { name: string, value: string }[]): string | undefined {
  for (const tag of tags) {
    if (tag.name.toLowerCase() === "content-type") {
      return tag.value;
    }
  }
  return "application/octet-stream";
}
