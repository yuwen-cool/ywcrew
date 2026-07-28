// src/config/paths.ts
import os from "os";
import path from "path";
var HOME_DIR = process.env.YWCREW_HOME ?? path.join(os.homedir(), ".ywcrew");
var paths = {
  home: HOME_DIR,
  config: path.join(HOME_DIR, "config.json"),
  capabilities: path.join(HOME_DIR, "capabilities.json"),
  runs: path.join(HOME_DIR, "runs"),
  threads: path.join(HOME_DIR, "threads"),
  locks: path.join(HOME_DIR, "locks"),
  runDir: (runId) => path.join(HOME_DIR, "runs", runId),
  threadFile: (threadId) => path.join(HOME_DIR, "threads", `${threadId}.json`)
};

// src/core/store.ts
import fs from "fs";
import path2 from "path";
function atomicWriteJson(file, data) {
  fs.mkdirSync(path2.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return void 0;
  }
}

export {
  paths,
  atomicWriteJson,
  readJson
};
//# sourceMappingURL=chunk-QEBUZYAA.js.map