const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024;

const configuredBodyLimit = Number(process.env.MAX_REQUEST_BODY_BYTES);
const MAX_REQUEST_BODY_BYTES =
  Number.isFinite(configuredBodyLimit) && configuredBodyLimit > 0
    ? configuredBodyLimit
    : DEFAULT_MAX_REQUEST_BODY_BYTES;

const monthFormatterCache = new Map();
const dateTimeFormatterCache = new Map();

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function notFound(response) {
  sendJson(response, 404, {
    message: "Route not found."
  });
}

function methodNotAllowed(response, allowedMethods) {
  sendJson(
    response,
    405,
    {
      message: "Method not allowed."
    },
    {
      Allow: allowedMethods.join(", ")
    }
  );
}

async function readJsonBody(request) {
  const declaredContentLength = Number(request.headers["content-length"]);

  if (
    Number.isFinite(declaredContentLength) &&
    declaredContentLength > MAX_REQUEST_BODY_BYTES
  ) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    const parsingError = new Error("Request body must be valid JSON.");
    parsingError.statusCode = 400;
    throw parsingError;
  }
}

function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details) {
    error.details = details;
  }

  return error;
}

function createId(prefix = "ot") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getMonthFormatter(timeZone) {
  let formatter = monthFormatterCache.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    });
    monthFormatterCache.set(timeZone, formatter);
  }

  return formatter;
}

function getDateTimeFormatter(timeZone) {
  let formatter = dateTimeFormatterCache.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    dateTimeFormatterCache.set(timeZone, formatter);
  }

  return formatter;
}

function getMonthStamp(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = getMonthFormatter(timeZone).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return `${year}-${month}`;
}

function formatDateParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${lookup.hour}:${lookup.minute}`
  };
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeOriginValue(originValue) {
  if (typeof originValue !== "string") {
    return "";
  }

  const trimmed = originValue.trim();

  if (!trimmed || trimmed === "*") {
    return trimmed;
  }

  return trimTrailingSlash(trimmed);
}

function buildCorsHeaders(configuredOriginValue, requestOriginValue) {
  const configuredOrigin = normalizeOriginValue(configuredOriginValue);
  const requestOrigin = normalizeOriginValue(requestOriginValue);
  const allowOrigin =
    configuredOrigin === "*" || !requestOrigin || requestOrigin !== configuredOrigin
      ? configuredOrigin
      : requestOriginValue;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

module.exports = {
  buildCorsHeaders,
  createHttpError,
  createId,
  formatDateParts,
  getMonthStamp,
  methodNotAllowed,
  notFound,
  readJsonBody,
  sendJson
};
