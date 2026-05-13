const http = require("node:http");
const { URL } = require("node:url");

const { assertAuthConfig, authenticateRequest } = require("./auth");
const {
  closeDatabase,
  connectToDatabase,
  createProfile,
  deleteProfile,
  getProfileByAuthUserId,
  getProfileByUsername,
  replaceProfile,
  replaceProfileByAuthUserId,
} = require("./store");
const {
  buildCorsHeaders,
  createHttpError,
  createId,
  formatDateParts,
  getMonthStamp,
  methodNotAllowed,
  notFound,
  readJsonBody,
  sendJson,
} = require("./utils");
const {
  validateCreateProfilePayload,
  validateEntryPayload,
  validateMonthQuery,
  validateProfileUpdatePayload,
  validateTimerPayload,
  validateUsername,
} = require("./validation");

const port = Number(process.env.PORT || 3000);
const timeZone = process.env.APP_TIME_ZONE || "Asia/Ho_Chi_Minh";
const corsOrigin =
  process.env.CORS_ORIGIN || "https://fe-ot-worker.vercel.app";

function createDefaultProfile(username, authUserId = null) {
  return {
    authUserId,
    username,
    selectedMonth: getMonthStamp(new Date(), timeZone),
    employee: {
      label: username.split("-")[0]?.toUpperCase() || "USER",
      employeeCode: "",
      fullName: "",
      sheetName: "Trang tinh1",
    },
    activeTimer: null,
    entries: [],
  };
}

function requireProfile(profile, username) {
  if (!profile) {
    throw createHttpError(404, `Profile ${username} was not found.`);
  }

  return profile;
}

function normalizeEntry(entry) {
  return {
    id: entry.id,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    note: entry.note,
  };
}

function normalizeProfile(profile) {
  return {
    username: profile.username,
    selectedMonth: profile.selectedMonth,
    employee: profile.employee,
    activeTimer: profile.activeTimer,
    entries: Array.isArray(profile.entries)
      ? profile.entries.map(normalizeEntry)
      : [],
  };
}

function createEntryFromTimer(activeTimer, stopDate) {
  const startDate = new Date(activeTimer.startedAt);

  if (Number.isNaN(startDate.getTime())) {
    throw createHttpError(500, "Stored timer is invalid.");
  }

  const startParts = formatDateParts(startDate, timeZone);
  const endParts = formatDateParts(stopDate, timeZone);

  return {
    id: createId("ot"),
    date: startParts.date,
    startTime: startParts.time,
    endTime: endParts.time,
    note: activeTimer.note,
  };
}

function getRequestOwnerId(request) {
  return request.auth?.sub || null;
}

async function requireOwnedProfile(request, username) {
  const profile = await getProfileByUsername(username, request.auth);

  if (!profile) {
    throw createHttpError(404, `Profile ${username} was not found.`);
  }

  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    return profile;
  }

  if (!profile.authUserId) {
    throw createHttpError(
      403,
      `Profile ${username} is not linked to an authenticated user yet.`,
    );
  }

  if (profile.authUserId !== ownerId) {
    throw createHttpError(
      403,
      `You do not have access to profile ${username}.`,
    );
  }

  return profile;
}

async function requireCurrentUserProfile(request) {
  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    throw createHttpError(401, "Token is missing subject claim.");
  }

  const profile = await getProfileByAuthUserId(ownerId, request.auth);

  if (!profile) {
    throw createHttpError(404, "Profile for the current user was not found.");
  }

  return profile;
}

async function persistCurrentUserProfile(request, profile) {
  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    throw createHttpError(401, "Token is missing subject claim.");
  }

  return replaceProfileByAuthUserId(ownerId, request.auth, profile);
}

async function handleRequest(request, response) {
  const corsHeaders = buildCorsHeaders(corsOrigin, request.headers.origin);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  try {
    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    const pathname = requestUrl.pathname;

    if (pathname === "/health") {
      sendJson(response, 200, { status: "ok" }, corsHeaders);
      return;
    }

    if (pathname.startsWith("/api/")) {
      request.auth = await authenticateRequest(request);
    }

    if (pathname === "/api/me" && request.method === "GET") {
      const ownerId = getRequestOwnerId(request);
      const profile = ownerId
        ? await getProfileByAuthUserId(ownerId, request.auth)
        : null;

      sendJson(
        response,
        200,
        {
          sub: request.auth?.sub || null,
          email: request.auth?.email || null,
          role: request.auth?.role || null,
          profile: profile ? { username: profile.username } : null,
        },
        corsHeaders,
      );
      return;
    }

    if (pathname === "/api/profiles/me") {
      await handleCurrentProfileRoutes(request, response, corsHeaders);
      return;
    }

    if (pathname === "/api/profiles/me/init") {
      await handleCurrentProfileInitRoute(request, response, corsHeaders);
      return;
    }

    if (pathname.startsWith("/api/profiles/me/")) {
      const pathSegments = pathname.split("/").filter(Boolean);

      if (pathSegments[3] === "entries") {
        await handleCurrentEntryRoutes(
          request,
          response,
          pathSegments,
          requestUrl,
          corsHeaders,
        );
        return;
      }

      if (pathSegments[3] === "timer") {
        await handleCurrentTimerRoutes(
          request,
          response,
          pathSegments,
          corsHeaders,
        );
        return;
      }
    }

    if (pathname === "/api/profiles" && request.method === "POST") {
      const body = await readJsonBody(request);
      const { username } = validateCreateProfilePayload(body);

      const profile = createDefaultProfile(
        username,
        getRequestOwnerId(request),
      );
      const storedProfile = await createProfile(profile, request.auth);

      sendJson(response, 201, normalizeProfile(storedProfile), corsHeaders);
      return;
    }

    if (pathname.startsWith("/api/profiles/")) {
      const pathSegments = pathname.split("/").filter(Boolean);
      const username = pathSegments[2];

      validateUsername(username);

      if (pathSegments.length === 3) {
        await handleProfileRoutes(request, response, username, corsHeaders);
        return;
      }

      if (pathSegments[3] === "entries") {
        await handleEntryRoutes(
          request,
          response,
          username,
          pathSegments,
          requestUrl,
          corsHeaders,
        );
        return;
      }

      if (pathSegments[3] === "timer") {
        await handleTimerRoutes(
          request,
          response,
          username,
          pathSegments,
          corsHeaders,
        );
        return;
      }
    }

    notFound(response);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const payload = {
      message: statusCode === 500 ? "Internal server error." : error.message,
    };

    sendJson(response, statusCode, payload, corsHeaders);
  }
}

async function handleCurrentProfileRoutes(request, response, corsHeaders) {
  if (request.method === "GET") {
    const profile = await requireCurrentUserProfile(request);
    sendJson(response, 200, normalizeProfile(profile), corsHeaders);
    return;
  }

  if (request.method === "PUT") {
    const profile = await requireCurrentUserProfile(request);
    const body = await readJsonBody(request);
    const updates = validateProfileUpdatePayload(body);

    if (updates.selectedMonth !== undefined) {
      profile.selectedMonth = updates.selectedMonth;
    }

    if (updates.employee !== undefined) {
      profile.employee = updates.employee;
    }

    const updatedProfile = await persistCurrentUserProfile(request, profile);

    sendJson(response, 200, normalizeProfile(updatedProfile), corsHeaders);
    return;
  }

  methodNotAllowed(response, ["GET", "PUT"]);
}

async function handleCurrentProfileInitRoute(request, response, corsHeaders) {
  if (request.method !== "POST") {
    methodNotAllowed(response, ["POST"]);
    return;
  }

  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    throw createHttpError(401, "Token is missing subject claim.");
  }

  const existingProfile = await getProfileByAuthUserId(ownerId, request.auth);

  if (existingProfile) {
    throw createHttpError(409, "Profile already exists for the current user.");
  }

  const body = await readJsonBody(request);
  const { username } = validateCreateProfilePayload(body);
  const profile = createDefaultProfile(username, ownerId);
  const storedProfile = await createProfile(profile, request.auth);

  sendJson(response, 201, normalizeProfile(storedProfile), corsHeaders);
}

async function handleProfileRoutes(request, response, username, corsHeaders) {
  if (request.method === "GET") {
    const profile = await requireOwnedProfile(request, username);
    sendJson(response, 200, normalizeProfile(profile), corsHeaders);
    return;
  }

  if (request.method === "PUT") {
    const profile = await requireOwnedProfile(request, username);
    const body = await readJsonBody(request);
    const updates = validateProfileUpdatePayload(body);

    if (updates.selectedMonth !== undefined) {
      profile.selectedMonth = updates.selectedMonth;
    }

    if (updates.employee !== undefined) {
      profile.employee = updates.employee;
    }

    const updatedProfile = await replaceProfile(
      username,
      request.auth,
      profile,
    );
    sendJson(
      response,
      200,
      normalizeProfile(requireProfile(updatedProfile, username)),
      corsHeaders,
    );
    return;
  }

  if (request.method === "DELETE") {
    await requireOwnedProfile(request, username);
    const deleted = await deleteProfile(username, request.auth);

    if (!deleted) {
      throw createHttpError(404, `Profile ${username} was not found.`);
    }

    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  methodNotAllowed(response, ["GET", "PUT", "DELETE"]);
}

async function handleEntryRoutes(
  request,
  response,
  username,
  pathSegments,
  requestUrl,
  corsHeaders,
) {
  if (pathSegments.length === 4) {
    if (request.method === "GET") {
      const month = validateMonthQuery(
        requestUrl.searchParams.get("month") || undefined,
      );
      const profile = await requireOwnedProfile(request, username);
      const entries = month
        ? profile.entries.filter((entry) => entry.date.startsWith(`${month}-`))
        : profile.entries;

      sendJson(response, 200, entries.map(normalizeEntry), corsHeaders);
      return;
    }

    if (request.method === "POST") {
      const profile = await requireOwnedProfile(request, username);
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const entry = {
        id: createId("ot"),
        ...entryPayload,
      };

      profile.entries.push(entry);
      await replaceProfile(username, request.auth, profile);

      sendJson(response, 201, normalizeEntry(entry), corsHeaders);
      return;
    }

    methodNotAllowed(response, ["GET", "POST"]);
    return;
  }

  if (pathSegments.length === 5) {
    const entryId = pathSegments[4];
    const profile = await requireOwnedProfile(request, username);
    const entryIndex = profile.entries.findIndex((item) => item.id === entryId);

    if (entryIndex === -1) {
      throw createHttpError(404, `Entry ${entryId} was not found.`);
    }

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      profile.entries[entryIndex] = {
        id: entryId,
        ...entryPayload,
      };

      const updatedProfile = await replaceProfile(
        username,
        request.auth,
        profile,
      );
      const entry = requireProfile(updatedProfile, username).entries.find(
        (item) => item.id === entryId,
      );
      sendJson(response, 200, normalizeEntry(entry), corsHeaders);
      return;
    }

    if (request.method === "DELETE") {
      profile.entries = profile.entries.filter((entry) => entry.id !== entryId);
      await replaceProfile(username, request.auth, profile);

      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    methodNotAllowed(response, ["PUT", "DELETE"]);
    return;
  }

  notFound(response);
}

async function handleCurrentEntryRoutes(
  request,
  response,
  pathSegments,
  requestUrl,
  corsHeaders,
) {
  const profile = await requireCurrentUserProfile(request);

  if (pathSegments.length === 4) {
    if (request.method === "GET") {
      const month = validateMonthQuery(
        requestUrl.searchParams.get("month") || undefined,
      );
      const entries = month
        ? profile.entries.filter((entry) => entry.date.startsWith(`${month}-`))
        : profile.entries;

      sendJson(response, 200, entries.map(normalizeEntry), corsHeaders);
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const entry = {
        id: createId("ot"),
        ...entryPayload,
      };

      profile.entries.push(entry);
      await persistCurrentUserProfile(request, profile);

      sendJson(response, 201, normalizeEntry(entry), corsHeaders);
      return;
    }

    methodNotAllowed(response, ["GET", "POST"]);
    return;
  }

  if (pathSegments.length === 5) {
    const entryId = pathSegments[4];
    const entryIndex = profile.entries.findIndex((item) => item.id === entryId);

    if (entryIndex === -1) {
      throw createHttpError(404, `Entry ${entryId} was not found.`);
    }

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      profile.entries[entryIndex] = {
        id: entryId,
        ...entryPayload,
      };

      const updatedProfile = await persistCurrentUserProfile(request, profile);
      const entry = updatedProfile.entries.find((item) => item.id === entryId);
      sendJson(response, 200, normalizeEntry(entry), corsHeaders);
      return;
    }

    if (request.method === "DELETE") {
      profile.entries = profile.entries.filter((entry) => entry.id !== entryId);
      await persistCurrentUserProfile(request, profile);

      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    methodNotAllowed(response, ["PUT", "DELETE"]);
    return;
  }

  notFound(response);
}

async function handleTimerRoutes(
  request,
  response,
  username,
  pathSegments,
  corsHeaders,
) {
  if (pathSegments.length === 4) {
    const profile = await requireOwnedProfile(request, username);

    if (request.method === "GET") {
      sendJson(response, 200, profile.activeTimer, corsHeaders);
      return;
    }

    if (request.method === "PUT") {
      if (!profile.activeTimer) {
        throw createHttpError(409, "No active timer to update.");
      }

      const body = await readJsonBody(request);
      const { note } = validateTimerPayload(body);
      profile.activeTimer = {
        ...profile.activeTimer,
        note,
      };

      const updatedProfile = await replaceProfile(
        username,
        request.auth,
        profile,
      );
      sendJson(
        response,
        200,
        requireProfile(updatedProfile, username).activeTimer,
        corsHeaders,
      );
      return;
    }

    methodNotAllowed(response, ["GET", "PUT"]);
    return;
  }

  if (pathSegments.length === 5 && pathSegments[4] === "start") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return;
    }

    const profile = await requireOwnedProfile(request, username);

    if (profile.activeTimer) {
      throw createHttpError(
        409,
        "An active timer already exists for this profile.",
      );
    }

    const body = await readJsonBody(request);
    const { note } = validateTimerPayload(body);
    const timer = {
      startedAt: new Date().toISOString(),
      note,
    };

    profile.activeTimer = timer;
    await replaceProfile(username, request.auth, profile);

    sendJson(response, 200, timer, corsHeaders);
    return;
  }

  if (pathSegments.length === 5 && pathSegments[4] === "stop") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return;
    }

    const profile = await requireOwnedProfile(request, username);

    if (!profile.activeTimer) {
      throw createHttpError(
        409,
        "No active timer is running for this profile.",
      );
    }

    const body = await readJsonBody(request);
    const { note } = validateTimerPayload(body);
    const timer = {
      ...profile.activeTimer,
      note: note !== "" ? note : profile.activeTimer.note,
    };
    const entry = createEntryFromTimer(timer, new Date());

    profile.activeTimer = null;
    profile.entries.push(entry);
    await replaceProfile(username, request.auth, profile);

    sendJson(response, 200, normalizeEntry(entry), corsHeaders);
    return;
  }

  notFound(response);
}

async function handleCurrentTimerRoutes(
  request,
  response,
  pathSegments,
  corsHeaders,
) {
  const profile = await requireCurrentUserProfile(request);

  if (pathSegments.length === 4) {
    if (request.method === "GET") {
      sendJson(response, 200, profile.activeTimer, corsHeaders);
      return;
    }

    if (request.method === "PUT") {
      if (!profile.activeTimer) {
        throw createHttpError(409, "No active timer to update.");
      }

      const body = await readJsonBody(request);
      const { note } = validateTimerPayload(body);
      profile.activeTimer = {
        ...profile.activeTimer,
        note,
      };

      const updatedProfile = await persistCurrentUserProfile(request, profile);
      sendJson(response, 200, updatedProfile.activeTimer, corsHeaders);
      return;
    }

    methodNotAllowed(response, ["GET", "PUT"]);
    return;
  }

  if (pathSegments.length === 5 && pathSegments[4] === "start") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return;
    }

    if (profile.activeTimer) {
      throw createHttpError(
        409,
        "An active timer already exists for this profile.",
      );
    }

    const body = await readJsonBody(request);
    const { note } = validateTimerPayload(body);
    const timer = {
      startedAt: new Date().toISOString(),
      note,
    };

    profile.activeTimer = timer;
    await persistCurrentUserProfile(request, profile);

    sendJson(response, 200, timer, corsHeaders);
    return;
  }

  if (pathSegments.length === 5 && pathSegments[4] === "stop") {
    if (request.method !== "POST") {
      methodNotAllowed(response, ["POST"]);
      return;
    }

    if (!profile.activeTimer) {
      throw createHttpError(
        409,
        "No active timer is running for this profile.",
      );
    }

    const body = await readJsonBody(request);
    const { note } = validateTimerPayload(body);
    const timer = {
      ...profile.activeTimer,
      note: note !== "" ? note : profile.activeTimer.note,
    };
    const entry = createEntryFromTimer(timer, new Date());

    profile.activeTimer = null;
    profile.entries.push(entry);
    await persistCurrentUserProfile(request, profile);

    sendJson(response, 200, normalizeEntry(entry), corsHeaders);
    return;
  }

  notFound(response);
}

function createServer() {
  return http.createServer(handleRequest);
}

async function initializeApp() {
  assertAuthConfig();
  await connectToDatabase();
}

async function startServer() {
  await initializeApp();

  const server = createServer();
  await new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`OTWORKER backend is running on http://localhost:${port}`);
      resolve();
    });
  });

  return server;
}

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error(error.message || error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
}

let initPromise;

async function vercelHandler(request, response) {
  try {
    initPromise ||= initializeApp();
    await initPromise;
    await handleRequest(request, response);
  } catch (error) {
    console.error(error.message || error);

    if (!response.headersSent) {
      response.statusCode = error.statusCode || 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          message:
            response.statusCode === 500
              ? "Internal server error."
              : error.message,
        }),
      );
      return;
    }

    response.end();
  }
}

module.exports = vercelHandler;
module.exports.createServer = createServer;
module.exports.handleRequest = handleRequest;
module.exports.initializeApp = initializeApp;
module.exports.startServer = startServer;
