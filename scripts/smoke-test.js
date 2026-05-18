const assert = require("node:assert/strict");

const bootstrapAccessToken = process.env.TEST_SUPABASE_ACCESS_TOKEN || null;
const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

process.env.PORT = process.env.PORT || "3101";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
process.env.APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Ho_Chi_Minh";
process.env.SUPABASE_JWT_VERIFY = (bootstrapAccessToken || hasServiceRole)
  ? "true"
  : (process.env.TEST_SUPABASE_JWT_VERIFY || "false");

const { closeDatabase } = require("../src/store");
const { startServer } = require("../src/server");

const baseUrl = `http://localhost:${process.env.PORT}`;
const username = `dong-huu-trong-${Date.now()}`;
const sheetName = `Sheet-${Date.now()}`;
let accessToken = bootstrapAccessToken;
let cleanupAuthUserId = null;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;

  return {
    status: response.status,
    body
  };
}

async function createSupabaseClients() {
  const { createClient } = await import("@supabase/supabase-js");

  const adminClient = hasServiceRole
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false
        }
      })
    : null;
  const publicClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  return {
    adminClient,
    publicClient
  };
}

async function ensureAccessToken() {
  if (accessToken) {
    return accessToken;
  }

  if (!hasServiceRole) {
    return null;
  }

  const { adminClient, publicClient } = await createSupabaseClients();
  const email = `otworker-smoke-${Date.now()}@example.com`;
  const password = `Smoke-${Date.now()}-Pass!`;
  const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (createError) {
    throw createError;
  }

  cleanupAuthUserId = createdUser.user?.id || null;

  const { data: sessionData, error: signInError } = await publicClient.auth.signInWithPassword({
    email,
    password
  });

  if (signInError) {
    throw signInError;
  }

  accessToken = sessionData.session?.access_token || null;

  if (!accessToken) {
    throw new Error("Smoke test could not obtain a Supabase access token.");
  }

  return accessToken;
}

async function cleanupAuthUser() {
  if (!cleanupAuthUserId || !hasServiceRole) {
    return;
  }

  const { adminClient } = await createSupabaseClients();
  await adminClient.auth.admin.deleteUser(cleanupAuthUserId).catch(() => undefined);
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.log("Smoke test skipped: provide SUPABASE_URL and SUPABASE_ANON_KEY first.");
    process.exit(0);
  }

  if (!bootstrapAccessToken && !hasServiceRole) {
    console.log("Smoke test skipped: provide TEST_SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY first.");
    process.exit(0);
  }

  await ensureAccessToken();

  const server = await startServer();

  try {
    let response = await request("/health");
    assert.equal(response.status, 200);

    if (accessToken) {
      response = await request("/api/me");
      assert.equal(response.status, 200);
      assert.equal(response.body.sub !== null, true);
    }

    response = await request("/api/profiles", {
      method: "POST",
      body: JSON.stringify({
        username,
        employee: {
          sheetName
        }
      })
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.username, username);
    assert.equal(response.body.employee.sheetName, sheetName);

    response = await request(`/api/profiles/${username}/entries`, {
      method: "POST",
      body: JSON.stringify({
        date: "2026-05-11",
        startTime: "22:00",
        endTime: "01:00",
        note: "overnight OT"
      })
    });
    assert.equal(response.status, 201);

    response = await request(`/api/profiles/${username}/timer/start`, {
      method: "POST",
      body: JSON.stringify({
        note: "timer task"
      })
    });
    assert.equal(response.status, 200);
    assert.ok(response.body.startedAt);

    response = await request(`/api/profiles/${username}/timer/stop`, {
      method: "POST",
      body: JSON.stringify({
        note: "timer task"
      })
    });
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.id, "string");

    response = await request(`/api/profiles/${username}/entries?month=2026-05`);
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body), true);
    assert.equal(response.body.length >= 2, true);

    response = await request(`/api/profiles/${username}`, {
      method: "DELETE"
    });
    assert.equal(response.status, 204);

    console.log("Smoke test passed.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await closeDatabase();
    await cleanupAuthUser();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
