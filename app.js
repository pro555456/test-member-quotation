require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const swaggerUi = require('swagger-ui-express');

const swaggerDocument = require('./config/swagger.json');
const pageRouter = require('./apis/pages');
const apiRouter = require('./apis');
const { sendError } = require('./utils/http');

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.set('trust proxy', 1);
app.set('etag', false);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[IN] ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(`[OUT] ${req.method} ${req.originalUrl} status=${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(
  express.static(path.join(__dirname, 'node_modules/bootstrap/dist'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
  })
);

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
  })
);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use('/', pageRouter);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api', apiRouter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use((error, req, res, next) => {
  console.error('[UnhandledError]', error);

  if (req.path.startsWith('/api')) {
    return sendError(res, error);
  }

  return res.status(error?.status || 500).send(error?.message || '系統發生錯誤');
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Server is listen on port: ${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
