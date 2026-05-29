const { createApp } = require("./src/app");

const { server, config } = createApp({ rootDir: __dirname });

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Stop the existing app or set PORT in .env.`);
    process.exit(1);
  }

  throw error;
});

server.listen(config.port, () => {
  console.log(`Redmine dashboard builder: http://localhost:${config.port}`);
  console.log(config.isConfigured ? "Redmine API: configured" : "Redmine API: check .env configuration");
});
