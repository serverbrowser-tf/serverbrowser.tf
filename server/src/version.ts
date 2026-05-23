import { execFileSync } from "child_process";

export interface GitVersion {
  commitDate: string | null;
  commit: string | null;
  message: string | null;
}

export function readGitVersion(): GitVersion {
  try {
    const output = execFileSync(
      "git",
      ["log", "-1", "--format=%cI%x00%H%x00%s"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trimEnd();
    const [commitDate, commit, message] = output.split("\0");

    return {
      commitDate: commitDate || null,
      commit: commit || null,
      message: message || null,
    };
  } catch {
    return nullGitVersion();
  }
}

export function nullGitVersion(): GitVersion {
  return {
    commitDate: null,
    commit: null,
    message: null,
  };
}

export const gitVersion = readGitVersion();
