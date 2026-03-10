import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AppConfig } from "@prompt-retro/shared-types";
import { PromptRetroStore } from "@prompt-retro/core";

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response: http.ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

function serveStaticFile(response: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType =
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] ?? "application/octet-stream";

  response.statusCode = 200;
  response.setHeader("content-type", contentType);
  response.end(fs.readFileSync(filePath));
}

export function startServer(store: PromptRetroStore, config: AppConfig): Promise<http.Server> {
  const dashboardDist = path.resolve(process.cwd(), "apps/dashboard/dist");

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${config.serverPort}`);

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/sessions") {
      const filters: { projectPath?: string; tool?: "claude-code" | "codex" } = {};
      const projectPath = url.searchParams.get("projectPath");
      const tool = url.searchParams.get("tool");
      if (projectPath) {
        filters.projectPath = projectPath;
      }

      if (tool === "claude-code" || tool === "codex") {
        filters.tool = tool;
      }

      sendJson(
        response,
        200,
        store.listSessions(filters)
      );
      return;
    }

    if (url.pathname.startsWith("/api/sessions/")) {
      const sessionId = url.pathname.replace("/api/sessions/", "");
      const bundle = store.getSessionBundle(sessionId);
      if (!bundle) {
        sendJson(response, 404, { error: "Session not found" });
        return;
      }

      sendJson(response, 200, bundle);
      return;
    }

    if (url.pathname === "/api/reports") {
      sendJson(response, 200, store.listRetroReports());
      return;
    }

    if (url.pathname === "/api/patterns") {
      sendJson(response, 200, store.listPatterns());
      return;
    }

    if (url.pathname === "/" || url.pathname.startsWith("/ui")) {
      const requestedPath =
        url.pathname === "/" || url.pathname === "/ui"
          ? path.join(dashboardDist, "index.html")
          : path.join(dashboardDist, url.pathname.replace("/ui/", ""));
      serveStaticFile(response, requestedPath);
      return;
    }

    sendText(response, 404, "Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.serverPort, "127.0.0.1", () => resolve(server));
  });
}
