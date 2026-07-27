import os from "node:os";
import path from "node:path";

const HOME_DIR = process.env.YWCREW_HOME ?? path.join(os.homedir(), ".ywcrew");

export const paths = {
  home: HOME_DIR,
  config: path.join(HOME_DIR, "config.json"),
  capabilities: path.join(HOME_DIR, "capabilities.json"),
  runs: path.join(HOME_DIR, "runs"),
  threads: path.join(HOME_DIR, "threads"),
  locks: path.join(HOME_DIR, "locks"),
  runDir: (runId: string) => path.join(HOME_DIR, "runs", runId),
  threadFile: (threadId: string) => path.join(HOME_DIR, "threads", `${threadId}.json`),
};
