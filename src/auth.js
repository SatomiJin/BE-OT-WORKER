const { createHttpError } = require("./utils");

const AUTH_ENABLED = process.env.SUPABASE_JWT_VERIFY === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_JWT_AUDIENCE = process.env.SUPABASE_JWT_AUDIENCE;

let joseModulePromise;
let remoteJwkSetPromise;

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function isAuthEnabled() {
  return AUTH_ENABLED;
}

function getIssuer() {
  const configuredIssuer = process.env.SUPABASE_JWT_ISSUER;

  if (configuredIssuer) {
    return trimTrailingSlash(configuredIssuer);
  }

  if (!SUPABASE_URL) {
    return undefined;
  }

  return `${trimTrailingSlash(SUPABASE_URL)}/auth/v1`;
}

function assertAuthConfig() {
  if (!AUTH_ENABLED) {
    return;
  }

  if (!SUPABASE_URL) {
    const error = new Error("SUPABASE_URL is required when SUPABASE_JWT_VERIFY=true.");
    error.statusCode = 500;
    throw error;
  }
}

async function loadJose() {
  joseModulePromise ||= import("jose");
  return joseModulePromise;
}

async function getRemoteJwkSet() {
  if (!remoteJwkSetPromise) {
    const { createRemoteJWKSet } = await loadJose();
    remoteJwkSetPromise = Promise.resolve(createRemoteJWKSet(new URL(`${getIssuer()}/.well-known/jwks.json`)));
  }

  return remoteJwkSetPromise;
}

function extractBearerToken(headers) {
  const authorization = headers.authorization;

  if (!authorization) {
    throw createHttpError(401, "Missing Authorization header.");
  }

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);

  if (rest.length > 0 || scheme !== "Bearer" || !token) {
    throw createHttpError(401, "Authorization header must use Bearer token format.");
  }

  return token;
}

function normalizeClaims(payload) {
  return {
    sub: typeof payload.sub === "string" ? payload.sub : null,
    email: typeof payload.email === "string" ? payload.email : null,
    role: typeof payload.role === "string" ? payload.role : null,
    claims: payload,
    token: null
  };
}

function buildVerifyOptions() {
  const options = {
    issuer: getIssuer(),
    clockTolerance: 5
  };

  if (SUPABASE_JWT_AUDIENCE) {
    options.audience = SUPABASE_JWT_AUDIENCE;
  }

  return options;
}

function mapJoseError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;

  if (code === "ERR_JWKS_NO_MATCHING_KEY") {
    return createHttpError(401, "Token signing key was not recognized.");
  }

  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    return createHttpError(401, "Token signature is invalid.");
  }

  if (code === "ERR_JWT_EXPIRED") {
    return createHttpError(401, "Token has expired.");
  }

  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    return createHttpError(401, "Token claims are invalid.");
  }

  if (error instanceof TypeError) {
    return createHttpError(503, "Unable to reach Supabase JWKS endpoint.");
  }

  return createHttpError(401, "Token is invalid.");
}

async function authenticateRequest(request) {
  if (!AUTH_ENABLED) {
    return null;
  }

  const token = extractBearerToken(request.headers);
  const { jwtVerify } = await loadJose();
  const remoteJwkSet = await getRemoteJwkSet();

  try {
    const { payload } = await jwtVerify(token, remoteJwkSet, buildVerifyOptions());
    return {
      ...normalizeClaims(payload),
      token
    };
  } catch (error) {
    throw mapJoseError(error);
  }
}

module.exports = {
  assertAuthConfig,
  authenticateRequest,
  isAuthEnabled
};
