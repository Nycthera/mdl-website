import { exec } from "child_process";
import path from "path";

export function createCbz(folder: string): Promise<string> {
  const base = path.resolve(folder);
  const name = path.basename(base);
  const cbzPath = path.join(base, `${name}.cbz`);
  return new Promise((resolve, reject) => {
    // Try to use system `zip` to create a cbz archive
    const cmd = `zip -r ${JSON.stringify(cbzPath)} ${JSON.stringify(".")}`;
    exec(cmd, { cwd: base }, (err, _stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || String(err)));
      }
      resolve(cbzPath);
    });
  });
}
