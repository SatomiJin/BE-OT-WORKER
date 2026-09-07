const http = require("node:http");
const { URL } = require("node:url");

const { assertAuthConfig, authenticateRequest } = require("./auth");
const {
  closeDatabase,
  connectToDatabase,
  createEntry,
  createFeedback,
  createProfile,
  deleteEntry,
  deleteFeedback,
  deleteProfile,
  getEntriesByProfileId,
  getFeedbackById,
  listFeedback,
  listFeedbackByAuthUserId,
  getProfileByAuthUserId,
  getProfileByUsername,
  listProfiles,
  listProfilesWithEntries,
  stopTimer,
  updateEntry,
  updateFeedback,
  updateProfileByAuthUserId,
  updateProfileByUsername,
} = require("./store");
const {
  buildOtExportWorkbookBuffer,
  formatExportDate,
} = require("./excel-export");
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
  validateFeedbackPayload,
  validateFeedbackStatusQuery,
  validateFeedbackUpdatePayload,
  validateLimitQuery,
  validateMonthQuery,
  validateProfileUpdatePayload,
  validateTimerPayload,
  validateUsername,
} = require("./validation");

const port = Number(process.env.PORT || 3000);
const timeZone = process.env.APP_TIME_ZONE || "Asia/Ho_Chi_Minh";
const corsOrigin =
  process.env.CORS_ORIGIN || "https://fe-ot-worker.vercel.app";
// Feedback is addressed to one person, so the inbox routes are gated on this
// username rather than on the ADMIN role. Change it here to hand the inbox over.
const FEEDBACK_OWNER_USERNAME = "trong-dong";

function createDefaultProfile(username, authUserId = null, employee = {}) {
  return {
    authUserId,
    username,
    role: "USER",
    selectedMonth: getMonthStamp(new Date(), timeZone),
    employee: {
      label: employee.label ?? username.split("-")[0]?.toUpperCase() ?? "USER",
      employeeCode: employee.employeeCode ?? "",
      fullName: employee.fullName ?? "",
      sheetName: employee.sheetName ?? "",
    },
    activeTimer: null,
    entries: [],
  };
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
    role: profile.role || "USER",
    selectedMonth: profile.selectedMonth,
    employee: profile.employee,
    activeTimer: profile.activeTimer,
    entries: Array.isArray(profile.entries)
      ? profile.entries.map(normalizeEntry)
      : [],
  };
}

function normalizeMember(profile) {
  return {
    username: profile.username,
    role: profile.role || "USER",
    selectedMonth: profile.selectedMonth,
    employee: {
      label: profile.employee?.label || "",
      employeeCode: profile.employee?.employeeCode || "",
      fullName: profile.employee?.fullName || "",
      sheetName: profile.employee?.sheetName || "",
    },
  };
}

function normalizeOtProfile(profile) {
  return {
    ...normalizeMember(profile),
    activeTimer: profile.activeTimer,
    entries: Array.isArray(profile.entries)
      ? profile.entries.map(normalizeEntry)
      : [],
  };
}

function normalizeFeedback(feedback) {
  return {
    id: feedback.id,
    username: feedback.username,
    category: feedback.category,
    message: feedback.message,
    context: feedback.context,
    status: feedback.status,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  };
}

function normalizeAdminFeedback(feedback) {
  return {
    ...normalizeFeedback(feedback),
    adminNote: feedback.adminNote,
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

function isAdminProfile(profile) {
  return profile?.role === "ADMIN";
}

function requireSuccessfulProfileUpdate(updatedProfile, label = "Profile") {
  if (!updatedProfile) {
    throw createHttpError(
      409,
      `${label} changed while the request was being processed. Please retry.`,
    );
  }

  return updatedProfile;
}

async function buildProfilePayload(profile, auth) {
  const entries = await getEntriesByProfileId(profile.id, auth);

  return normalizeProfile({
    ...profile,
    entries,
  });
}

async function sendProfile(response, statusCode, profile, auth, corsHeaders) {
  sendJson(
    response,
    statusCode,
    await buildProfilePayload(profile, auth),
    corsHeaders,
  );
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

async function requireReadableProfile(request, username) {
  const profile = await getProfileByUsername(username, request.auth);

  if (!profile) {
    throw createHttpError(404, `Profile ${username} was not found.`);
  }

  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    return profile;
  }

  if (profile.authUserId === ownerId) {
    return profile;
  }

  const currentProfile = await getProfileByAuthUserId(ownerId, request.auth);

  if (isAdminProfile(currentProfile)) {
    return profile;
  }

  if (!profile.authUserId) {
    throw createHttpError(
      403,
      `Profile ${username} is not linked to an authenticated user yet.`,
    );
  }

  throw createHttpError(403, `You do not have access to profile ${username}.`);
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

function isFeedbackOwnerProfile(profile) {
  return profile?.username === FEEDBACK_OWNER_USERNAME;
}

async function requireFeedbackOwnerProfile(request) {
  const profile = await requireCurrentUserProfile(request);

  if (!isFeedbackOwnerProfile(profile)) {
    throw createHttpError(403, "Feedback inbox is restricted.");
  }

  return profile;
}

async function requireAdminProfile(request) {
  const profile = await requireCurrentUserProfile(request);

  if (!isAdminProfile(profile)) {
    throw createHttpError(403, "Admin role is required.");
  }

  return profile;
}

async function updateCurrentUserProfile(
  request,
  updates,
  expectedUpdatedAt = undefined,
) {
  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    throw createHttpError(401, "Token is missing subject claim.");
  }

  return updateProfileByAuthUserId(ownerId, request.auth, updates, {
    expectedUpdatedAt,
  });
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
          profile: profile
            ? { username: profile.username, role: profile.role || "USER" }
            : null,
          canReadFeedback: isFeedbackOwnerProfile(profile),
        },
        corsHeaders,
      );
      return;
    }

    if (pathname === "/api/feedback") {
      await handleFeedbackRoutes(request, response, requestUrl, corsHeaders);
      return;
    }

    if (pathname === "/api/admin/feedback") {
      await handleAdminFeedbackListRoute(
        request,
        response,
        requestUrl,
        corsHeaders,
      );
      return;
    }

    if (pathname.startsWith("/api/admin/feedback/")) {
      const pathSegments = pathname.split("/").filter(Boolean);

      if (pathSegments.length === 4) {
        await handleAdminFeedbackItemRoute(
          request,
          response,
          pathSegments[3],
          corsHeaders,
        );
        return;
      }
    }

    if (pathname === "/api/profiles/me") {
      await handleCurrentProfileRoutes(request, response, corsHeaders);
      return;
    }

    if (pathname === "/api/profiles/me/init") {
      await handleCurrentProfileInitRoute(request, response, corsHeaders);
      return;
    }

    if (pathname === "/api/admin/members") {
      await handleAdminMembersRoute(request, response, corsHeaders);
      return;
    }

    if (pathname === "/api/admin/ot-data") {
      await handleAdminOtDataRoute(
        request,
        response,
        requestUrl,
        corsHeaders,
      );
      return;
    }

    if (pathname === "/api/admin/ot-export") {
      await handleAdminOtExportRoute(request, response, corsHeaders);
      return;
    }

    if (pathname.startsWith("/api/admin/members/")) {
      const pathSegments = pathname.split("/").filter(Boolean);

      if (pathSegments.length === 4) {
        const username = pathSegments[3];
        validateUsername(username);
        await handleAdminMemberRoute(request, response, username, corsHeaders);
        return;
      }
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
      const { username, employee } = validateCreateProfilePayload(body);

      const profile = createDefaultProfile(
        username,
        getRequestOwnerId(request),
        employee,
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

    // Clients only ever see the generic 500 text, so without this the real
    // database/driver message is lost and the logs show nothing at all.
    if (statusCode === 500) {
      console.error("Unhandled request error:", error);
    }

    const payload = {
      message: statusCode === 500 ? "Internal server error." : error.message,
    };

    sendJson(response, statusCode, payload, corsHeaders);
  }
}

async function handleFeedbackRoutes(
  request,
  response,
  requestUrl,
  corsHeaders,
) {
  const ownerId = getRequestOwnerId(request);

  if (!ownerId) {
    throw createHttpError(401, "Token is missing subject claim.");
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    const payload = validateFeedbackPayload(body);
    // The feedback widget is reachable before a profile exists, so a missing
    // profile is not an error here - it only leaves the link fields empty.
    const profile = await getProfileByAuthUserId(ownerId, request.auth);
    const createdFeedback = await createFeedback(
      {
        id: createId("fb"),
        authUserId: ownerId,
        profileId: profile?.id ?? null,
        username: profile?.username ?? payload.context?.username ?? "",
        category: payload.category,
        message: payload.message,
        context: payload.context,
        status: "NEW",
      },
      request.auth,
    );

    sendJson(
      response,
      201,
      { feedback: normalizeFeedback(createdFeedback) },
      corsHeaders,
    );
    return;
  }

  if (request.method === "GET") {
    const limit = validateLimitQuery(
      requestUrl.searchParams.get("limit") ?? undefined,
    );
    const feedbackList = await listFeedbackByAuthUserId(
      ownerId,
      request.auth,
      { limit },
    );

    sendJson(
      response,
      200,
      { feedback: feedbackList.map(normalizeFeedback) },
      corsHeaders,
    );
    return;
  }

  methodNotAllowed(response, ["GET", "POST"]);
}

async function handleAdminFeedbackListRoute(
  request,
  response,
  requestUrl,
  corsHeaders,
) {
  if (request.method !== "GET") {
    methodNotAllowed(response, ["GET"]);
    return;
  }

  await requireFeedbackOwnerProfile(request);

  const status = validateFeedbackStatusQuery(
    requestUrl.searchParams.get("status") || undefined,
  );
  const category = requestUrl.searchParams.get("category") || undefined;
  const limit = validateLimitQuery(
    requestUrl.searchParams.get("limit") ?? undefined,
  );
  const feedbackList = await listFeedback(request.auth, {
    status,
    category,
    limit,
  });

  sendJson(
    response,
    200,
    { feedback: feedbackList.map(normalizeAdminFeedback) },
    corsHeaders,
  );
}

async function handleAdminFeedbackItemRoute(
  request,
  response,
  feedbackId,
  corsHeaders,
) {
  await requireFeedbackOwnerProfile(request);

  if (request.method === "GET") {
    const feedback = await getFeedbackById(feedbackId, request.auth);

    if (!feedback) {
      throw createHttpError(404, `Feedback ${feedbackId} was not found.`);
    }

    sendJson(
      response,
      200,
      { feedback: normalizeAdminFeedback(feedback) },
      corsHeaders,
    );
    return;
  }

  if (request.method === "PUT") {
    const body = await readJsonBody(request);
    const updates = validateFeedbackUpdatePayload(body);
    const updatedFeedback = await updateFeedback(
      feedbackId,
      request.auth,
      updates,
    );

    if (!updatedFeedback) {
      throw createHttpError(404, `Feedback ${feedbackId} was not found.`);
    }

    sendJson(
      response,
      200,
      { feedback: normalizeAdminFeedback(updatedFeedback) },
      corsHeaders,
    );
    return;
  }

  if (request.method === "DELETE") {
    const deleted = await deleteFeedback(feedbackId, request.auth);

    if (!deleted) {
      throw createHttpError(404, `Feedback ${feedbackId} was not found.`);
    }

    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  methodNotAllowed(response, ["GET", "PUT", "DELETE"]);
}

async function handleCurrentProfileRoutes(request, response, corsHeaders) {
  if (request.method === "GET") {
    const profile = await requireCurrentUserProfile(request);
    await sendProfile(response, 200, profile, request.auth, corsHeaders);
    return;
  }

  if (request.method === "PUT") {
    const profile = await requireCurrentUserProfile(request);
    const body = await readJsonBody(request);
    const updates = validateProfileUpdatePayload(body);
    const updatedProfile = await updateCurrentUserProfile(
      request,
      updates,
      profile.updatedAt,
    );

    await sendProfile(
      response,
      200,
      requireSuccessfulProfileUpdate(updatedProfile),
      request.auth,
      corsHeaders,
    );
    return;
  }

  methodNotAllowed(response, ["GET", "PUT"]);
}

async function handleAdminMembersRoute(request, response, corsHeaders) {
  if (request.method !== "GET") {
    methodNotAllowed(response, ["GET"]);
    return;
  }

  await requireAdminProfile(request);

  const profiles = await listProfiles(request.auth);
  sendJson(
    response,
    200,
    {
      members: profiles.map(normalizeMember),
    },
    corsHeaders,
  );
}

async function handleAdminMemberRoute(request, response, username, corsHeaders) {
  if (request.method !== "GET") {
    methodNotAllowed(response, ["GET"]);
    return;
  }

  await requireAdminProfile(request);

  const profile = await getProfileByUsername(username, request.auth);

  if (!profile) {
    throw createHttpError(404, `Profile ${username} was not found.`);
  }

  sendJson(
    response,
    200,
    {
      member: normalizeMember(profile),
    },
    corsHeaders,
  );
}

async function handleAdminOtDataRoute(
  request,
  response,
  requestUrl,
  corsHeaders,
) {
  if (request.method !== "GET") {
    methodNotAllowed(response, ["GET"]);
    return;
  }

  await requireAdminProfile(request);

  const month = validateMonthQuery(
    requestUrl.searchParams.get("month") || undefined,
  );
  const profiles = await listProfilesWithEntries(request.auth, month);

  sendJson(
    response,
    200,
    {
      month: month || null,
      profiles: profiles.map(normalizeOtProfile),
    },
    corsHeaders,
  );
}

async function handleAdminOtExportRoute(request, response, corsHeaders) {
  if (request.method !== "GET") {
    methodNotAllowed(response, ["GET"]);
    return;
  }

  await requireAdminProfile(request);

  const profiles = await listProfilesWithEntries(request.auth);
  const workbookBuffer = await buildOtExportWorkbookBuffer(profiles);
  const filename = `otworker-ot-export-${formatExportDate()}.xlsx`;

  response.writeHead(200, {
    ...corsHeaders,
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": Buffer.byteLength(workbookBuffer),
    "Cache-Control": "no-store",
  });
  response.end(Buffer.from(workbookBuffer));
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
  const { username, employee } = validateCreateProfilePayload(body);
  const profile = createDefaultProfile(username, ownerId, employee);
  const storedProfile = await createProfile(profile, request.auth);

  sendJson(response, 201, normalizeProfile(storedProfile), corsHeaders);
}

async function handleProfileRoutes(request, response, username, corsHeaders) {
  if (request.method === "GET") {
    const profile = await requireReadableProfile(request, username);
    await sendProfile(response, 200, profile, request.auth, corsHeaders);
    return;
  }

  if (request.method === "PUT") {
    const profile = await requireOwnedProfile(request, username);
    const body = await readJsonBody(request);
    const updates = validateProfileUpdatePayload(body);
    const updatedProfile = await updateProfileByUsername(
      username,
      request.auth,
      updates,
      {
        expectedUpdatedAt: profile.updatedAt,
      },
    );

    await sendProfile(
      response,
      200,
      requireSuccessfulProfileUpdate(updatedProfile),
      request.auth,
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
  const profile = request.method === "GET"
    ? await requireReadableProfile(request, username)
    : await requireOwnedProfile(request, username);

  if (pathSegments.length === 4) {
    if (request.method === "GET") {
      const month = validateMonthQuery(
        requestUrl.searchParams.get("month") || undefined,
      );
      const entries = await getEntriesByProfileId(profile.id, request.auth, month);

      sendJson(response, 200, entries.map(normalizeEntry), corsHeaders);
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const createdEntry = await createEntry(profile, request.auth, {
        id: createId("ot"),
        ...entryPayload,
      });

      sendJson(response, 201, normalizeEntry(createdEntry), corsHeaders);
      return;
    }

    methodNotAllowed(response, ["GET", "POST"]);
    return;
  }

  if (pathSegments.length === 5) {
    const entryId = pathSegments[4];

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const updatedEntry = await updateEntry(
        profile.id,
        entryId,
        request.auth,
        entryPayload,
      );

      if (!updatedEntry) {
        throw createHttpError(404, `Entry ${entryId} was not found.`);
      }

      sendJson(response, 200, normalizeEntry(updatedEntry), corsHeaders);
      return;
    }

    if (request.method === "DELETE") {
      const deleted = await deleteEntry(profile.id, entryId, request.auth);

      if (!deleted) {
        throw createHttpError(404, `Entry ${entryId} was not found.`);
      }

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
      const entries = await getEntriesByProfileId(profile.id, request.auth, month);

      sendJson(response, 200, entries.map(normalizeEntry), corsHeaders);
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const createdEntry = await createEntry(profile, request.auth, {
        id: createId("ot"),
        ...entryPayload,
      });

      sendJson(response, 201, normalizeEntry(createdEntry), corsHeaders);
      return;
    }

    methodNotAllowed(response, ["GET", "POST"]);
    return;
  }

  if (pathSegments.length === 5) {
    const entryId = pathSegments[4];

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const entryPayload = validateEntryPayload(body);
      const updatedEntry = await updateEntry(
        profile.id,
        entryId,
        request.auth,
        entryPayload,
      );

      if (!updatedEntry) {
        throw createHttpError(404, `Entry ${entryId} was not found.`);
      }

      sendJson(response, 200, normalizeEntry(updatedEntry), corsHeaders);
      return;
    }

    if (request.method === "DELETE") {
      const deleted = await deleteEntry(profile.id, entryId, request.auth);

      if (!deleted) {
        throw createHttpError(404, `Entry ${entryId} was not found.`);
      }

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
  const profile = request.method === "GET"
    ? await requireReadableProfile(request, username)
    : await requireOwnedProfile(request, username);

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
      const updatedProfile = await updateProfileByUsername(
        username,
        request.auth,
        {
          activeTimer: {
            ...profile.activeTimer,
            note,
          },
        },
        {
          expectedUpdatedAt: profile.updatedAt,
        },
      );

      sendJson(
        response,
        200,
        requireSuccessfulProfileUpdate(updatedProfile, "Timer").activeTimer,
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
    const updatedProfile = await updateProfileByUsername(
      username,
      request.auth,
      {
        activeTimer: timer,
      },
      {
        expectedUpdatedAt: profile.updatedAt,
      },
    );

    requireSuccessfulProfileUpdate(updatedProfile, "Timer");
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
    const createdEntry = await stopTimer(profile, request.auth, entry);
    sendJson(response, 200, normalizeEntry(createdEntry), corsHeaders);
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
      const updatedProfile = await updateCurrentUserProfile(
        request,
        {
          activeTimer: {
            ...profile.activeTimer,
            note,
          },
        },
        profile.updatedAt,
      );

      sendJson(
        response,
        200,
        requireSuccessfulProfileUpdate(updatedProfile, "Timer").activeTimer,
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
    const updatedProfile = await updateCurrentUserProfile(
      request,
      {
        activeTimer: timer,
      },
      profile.updatedAt,
    );

    requireSuccessfulProfileUpdate(updatedProfile, "Timer");
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
    const createdEntry = await stopTimer(profile, request.auth, entry);
    sendJson(response, 200, normalizeEntry(createdEntry), corsHeaders);
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
