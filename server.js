const { createApplication } = require('./server/index');
const config = require('./server/config');
const application = createApplication();
application.server.listen(config.PORT, () => console.log(`Server listening on ${config.PORT}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await application.close();
    process.exit(0);
  });
