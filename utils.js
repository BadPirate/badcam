import { exec } from "child_process";

export function pexec(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      }
      else {
        resolve({
          stdout: stdout.replace(/^\s+|\s+$/g, ''),
          stderr: stderr.replace(/^\s+|\s+$/g, '')
        });
      }
    });
  });
}
