const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

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
  const chunks = [];

  for await (const chunk of request) {
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

function getMonthStamp(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return `${year}-${month}`;
}

function formatDateParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

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
