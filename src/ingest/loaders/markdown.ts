import fs from "node:fs";
import path from "node:path";

export async function loadMarkdownDir(dir: string) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") || f.endsWith(".mdx"));
  return files.map(f => ({
    title: path.basename(f, path.extname(f)),
    text: fs.readFileSync(path.join(dir, f), "utf8")
  }));
}
