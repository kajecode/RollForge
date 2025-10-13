import fs from "node:fs";
import path from "node:path";

export async function loadPlainTextDir(dir: string) {
  const files = fs.readdirSync(dir).filter(f =>
    f.toLowerCase().endsWith(".txt")
  );
  return files.map(f => ({
    title: path.basename(f, path.extname(f)),
    text: fs.readFileSync(path.join(dir, f), "utf8")
  }));
}
