class HttpError extends Error {
  constructor(status = 500, message = 'Internal Server Error', code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sendError(res, error) {
  const status = error?.status || 500;
  const payload = {
    status: 'error',
    code: error?.code || 'INTERNAL_ERROR',
    message: error?.message || 'Internal Server Error',
  };

  if (error?.details) {
    payload.details = error.details;
  }

  return res.status(status).json(payload);
}

module.exports = {
  HttpError,
  asyncHandler,
  sendError,
};
