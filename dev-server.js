const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const DASHBOARD_URL = `http://${HOST}:${PORT}`;

function checkDashboard() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: HOST,
        port: PORT,
        path: "/api/dashboard",
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolve({
          reachable: true,
          dashboard: response.statusCode === 200,
          statusCode: response.statusCode,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve({ reachable: false, dashboard: false, error: "timeout" });
    });

    request.on("error", (error) => {
      resolve({ reachable: false, dashboard: false, error: error.code || error.message });
    });
  });
}

function keepAlive() {
  const timer = setInterval(() => {}, 60 * 60 * 1000);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function main() {
  const status = await checkDashboard();

  if (status.dashboard) {
    console.log(`Atlas Dashboard is already running at ${DASHBOARD_URL}. Reusing it for Tauri dev.`);
    keepAlive();
    return;
  }

  if (status.reachable) {
    console.error(
      `Port ${PORT} is already in use, but it does not look like Atlas Dashboard ` +
        `(GET /api/dashboard returned ${status.statusCode}).`,
    );
    process.exit(1);
  }

  require("./server.js");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
