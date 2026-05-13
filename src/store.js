const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE_NAME = process.env.SUPABASE_TABLE_NAME || "otworker_profiles";
const PROFILE_COLUMNS = "auth_user_id, username, selected_month, employee, active_timer, entries";

let supabaseModulePromise;

function createStoreError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertDatabaseConfig() {
  if (!SUPABASE_URL) {
    throw createStoreError(500, "SUPABASE_URL is required.");
  }

  if (!SUPABASE_ANON_KEY) {
    throw createStoreError(500, "SUPABASE_ANON_KEY is required.");
  }
}

async function loadSupabase() {
  supabaseModulePromise ||= import("@supabase/supabase-js");
  return supabaseModulePromise;
}

async function createSupabaseClient(auth) {
  assertDatabaseConfig();

  const { createClient } = await loadSupabase();
  const accessToken = auth?.token || null;
  const useServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY);
  const apiKey = useServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const global = !useServiceRole && accessToken
    ? {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    : undefined;

  return createClient(SUPABASE_URL, apiKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global
  });
}

function toProfileRow(profile) {
  return {
    auth_user_id: profile.authUserId,
    username: profile.username,
    selected_month: profile.selectedMonth,
    employee: profile.employee,
    active_timer: profile.activeTimer,
    entries: profile.entries
  };
}

function fromProfileRow(row) {
  if (!row) {
    return null;
  }

  return {
    authUserId: row.auth_user_id,
    username: row.username,
    selectedMonth: row.selected_month,
    employee: row.employee,
    activeTimer: row.active_timer,
    entries: Array.isArray(row.entries) ? row.entries : []
  };
}

function mapSupabaseError(error) {
  const combinedMessage = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (error.code === "23505") {
    if (combinedMessage.includes("auth_user_id")) {
      return createStoreError(409, "Authenticated user already has a profile.");
    }

    if (combinedMessage.includes("username")) {
      return createStoreError(409, "Profile already exists.");
    }
  }

  if (error.code === "42501") {
    return createStoreError(403, "Supabase policy blocked this request.");
  }

  return createStoreError(500, error.message || "Database request failed.");
}

async function runQuery(queryPromise) {
  const { data, error } = await queryPromise;

  if (error) {
    throw mapSupabaseError(error);
  }

  return data;
}

async function connectToDatabase() {
  assertDatabaseConfig();
}

async function getProfileByAuthUserId(authUserId, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .select(PROFILE_COLUMNS)
      .eq("auth_user_id", authUserId)
      .maybeSingle()
  );

  return fromProfileRow(data);
}

async function getProfileByUsername(username, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .select(PROFILE_COLUMNS)
      .eq("username", username)
      .maybeSingle()
  );

  return fromProfileRow(data);
}

async function createProfile(profile, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .insert(toProfileRow(profile))
      .select(PROFILE_COLUMNS)
      .single()
  );

  return fromProfileRow(data);
}

async function replaceProfile(username, auth, profile) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .update(toProfileRow(profile))
      .eq("username", username)
      .select(PROFILE_COLUMNS)
      .maybeSingle()
  );

  return fromProfileRow(data);
}

async function replaceProfileByAuthUserId(authUserId, auth, profile) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .update(toProfileRow(profile))
      .eq("auth_user_id", authUserId)
      .select(PROFILE_COLUMNS)
      .maybeSingle()
  );

  return fromProfileRow(data);
}

async function deleteProfile(username, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .delete()
      .eq("username", username)
      .select("username")
  );

  return Array.isArray(data) && data.length > 0;
}

async function closeDatabase() {
  return undefined;
}

module.exports = {
  closeDatabase,
  connectToDatabase,
  createProfile,
  deleteProfile,
  getProfileByAuthUserId,
  getProfileByUsername,
  replaceProfile,
  replaceProfileByAuthUserId
};
