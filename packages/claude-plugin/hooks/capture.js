#!/usr/bin/env node
import { spawn } from "node:child_process";

const hookEvent = process.argv[2];

let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  payload += chunk;
});
process.stdin.on("end", () => {
  const child = spawn("pretro", ["claude-hook", hookEvent], {
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env
  });
  child.stdin.end(payload);
});
