const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE_NAME =
  process.env.SUPABASE_TABLE_NAME || "otworker_profiles";
const SUPABASE_ENTRIES_TABLE_NAME =
  process.env.SUPABASE_ENTRIES_TABLE_NAME || "otworker_entries";
const PROFILE_COLUMNS =
  "id, auth_user_id, username, selected_month, employee, active_timer, updated_at";
const ENTRY_COLUMNS =
  "id, profile_id, auth_user_id, entry_date, start_time, end_time, note, created_at, updated_at";

let supabaseModulePromise;
let serviceRoleClientPromise;
let publicClientPromise;
let entriesStorageModePromise;

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

function buildClientOptions(global) {
  const options = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  };

  if (global) {
    options.global = global;
  }

  return options;
}

async function getSharedClient(apiKey, global, cacheKey) {
  const { createClient } = await loadSupabase();

  if (cacheKey === "service") {
    serviceRoleClientPromise ||= Promise.resolve(
      createClient(SUPABASE_URL, apiKey, buildClientOptions(global)),
    );
    return serviceRoleClientPromise;
  }

  publicClientPromise ||= Promise.resolve(
    createClient(SUPABASE_URL, apiKey, buildClientOptions(global)),
  );
  return publicClientPromise;
}

async function createSupabaseClient(auth) {
  assertDatabaseConfig();

  const accessToken = auth?.token || null;

  if (SUPABASE_SERVICE_ROLE_KEY) {
    return getSharedClient(SUPABASE_SERVICE_ROLE_KEY, undefined, "service");
  }

  if (!accessToken) {
    return getSharedClient(SUPABASE_ANON_KEY, undefined, "public");
  }

  const { createClient } = await loadSupabase();

  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    buildClientOptions({
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  );
}

function toProfileInsertRow(profile) {
  return {
    auth_user_id: profile.authUserId,
    username: profile.username,
    selected_month: profile.selectedMonth,
    employee: profile.employee,
    active_timer: profile.activeTimer,
  };
}

function toProfileUpdateRow(updates) {
  const row = {};

  if ("selectedMonth" in updates) {
    row.selected_month = updates.selectedMonth;
  }

  if ("employee" in updates) {
    row.employee = updates.employee;
  }

  if ("activeTimer" in updates) {
    row.active_timer = updates.activeTimer;
  }

  return row;
}

function toEntryInsertRow(profile, entry) {
  return {
    id: entry.id,
    profile_id: profile.id,
    auth_user_id: profile.authUserId,
    entry_date: entry.date,
    start_time: entry.startTime,
    end_time: entry.endTime,
    note: entry.note,
  };
}

function toEntryUpdateRow(entry) {
  return {
    entry_date: entry.date,
    start_time: entry.startTime,
    end_time: entry.endTime,
    note: entry.note,
  };
}

function fromProfileRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    authUserId: row.auth_user_id,
    username: row.username,
    selectedMonth: row.selected_month,
    employee: row.employee,
    activeTimer: row.active_timer,
    updatedAt: row.updated_at,
    entries: Array.isArray(row.entries) ? row.entries.map(fromEmbeddedEntry) : [],
  };
}

function fromEntryRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    profileId: row.profile_id,
    authUserId: row.auth_user_id,
    date: row.entry_date,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromEmbeddedEntry(entry) {
  return {
    id: entry.id,
    profileId: null,
    authUserId: null,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    note: entry.note,
    createdAt: null,
    updatedAt: null,
  };
}

function toEmbeddedEntry(entry) {
  return {
    id: entry.id,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    note: entry.note,
  };
}

function isMissingEntriesTableError(error) {
  const message = [error.message, error.hint].filter(Boolean).join(" ").toLowerCase();

  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes(SUPABASE_ENTRIES_TABLE_NAME.toLowerCase())
  );
}

function mapSupabaseError(error) {
  const combinedMessage = [
    error.code,
    error.message,
    error.details,
    error.hint,
    error.constraint,
  ]
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

    if (combinedMessage.includes("otworker_entries_pkey")) {
      return createStoreError(409, "Entry already exists.");
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

async function detectEntriesStorageMode(auth) {
  const client = await createSupabaseClient(auth);
  const { error } = await client
    .from(SUPABASE_ENTRIES_TABLE_NAME)
    .select("id")
    .limit(1);

  if (!error) {
    return "normalized";
  }

  if (isMissingEntriesTableError(error)) {
    return "embedded";
  }

  throw mapSupabaseError(error);
}

async function getEntriesStorageMode(auth) {
  entriesStorageModePromise ||= detectEntriesStorageMode(auth);
  return entriesStorageModePromise;
}

function buildMonthRange(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function applyExpectedUpdatedAt(query, expectedUpdatedAt) {
  if (!expectedUpdatedAt) {
    return query;
  }

  return query.eq("updated_at", expectedUpdatedAt);
}

async function connectToDatabase() {
  assertDatabaseConfig();
}

function buildEmbeddedEntriesFilter(entries, month) {
  const normalizedEntries = Array.isArray(entries)
    ? entries.map(fromEmbeddedEntry)
    : [];

  if (!month) {
    return normalizedEntries;
  }

  return normalizedEntries.filter((entry) => entry.date.startsWith(`${month}-`));
}

async function getEmbeddedEntriesState(profileId, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .select("id, entries, updated_at")
      .eq("id", profileId)
      .maybeSingle(),
  );

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    updatedAt: data.updated_at,
    entries: Array.isArray(data.entries) ? data.entries : [],
  };
}

async function getProfileByAuthUserId(authUserId, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .select(PROFILE_COLUMNS)
      .eq("auth_user_id", authUserId)
      .maybeSingle(),
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
      .maybeSingle(),
  );

  return fromProfileRow(data);
}

async function createProfile(profile, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .insert(toProfileInsertRow(profile))
      .select(PROFILE_COLUMNS)
      .single(),
  );

  return fromProfileRow(data);
}

async function updateProfileById(profileId, auth, updates, options = {}) {
  const client = await createSupabaseClient(auth);
  let query = client
    .from(SUPABASE_TABLE_NAME)
    .update(toProfileUpdateRow(updates))
    .eq("id", profileId);

  query = applyExpectedUpdatedAt(query, options.expectedUpdatedAt);
  query = query.select(PROFILE_COLUMNS).maybeSingle();

  const data = await runQuery(query);

  return fromProfileRow(Array.isArray(data) ? data[0] || null : data);
}

async function updateProfileByUsername(username, auth, updates, options = {}) {
  const client = await createSupabaseClient(auth);
  let query = client
    .from(SUPABASE_TABLE_NAME)
    .update(toProfileUpdateRow(updates))
    .eq("username", username);

  query = applyExpectedUpdatedAt(query, options.expectedUpdatedAt);
  query = query.select(PROFILE_COLUMNS).maybeSingle();

  const data = await runQuery(query);

  return fromProfileRow(
    Array.isArray(data) ? data[0] || null : data,
  );
}

async function updateProfileByAuthUserId(
  authUserId,
  auth,
  updates,
  options = {},
) {
  const client = await createSupabaseClient(auth);
  let query = client
    .from(SUPABASE_TABLE_NAME)
    .update(toProfileUpdateRow(updates))
    .eq("auth_user_id", authUserId);

  query = applyExpectedUpdatedAt(query, options.expectedUpdatedAt);
  query = query.select(PROFILE_COLUMNS).maybeSingle();

  const data = await runQuery(query);

  return fromProfileRow(
    Array.isArray(data) ? data[0] || null : data,
  );
}

async function deleteProfile(username, auth) {
  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_TABLE_NAME)
      .delete()
      .eq("username", username)
      .select("username"),
  );

  return Array.isArray(data) && data.length > 0;
}

async function getEntriesByProfileId(profileId, auth, month) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profileId, auth);
    return buildEmbeddedEntriesFilter(embeddedState?.entries, month);
  }

  const client = await createSupabaseClient(auth);
  let query = client
    .from(SUPABASE_ENTRIES_TABLE_NAME)
    .select(ENTRY_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (month) {
    const { start, end } = buildMonthRange(month);
    query = query.gte("entry_date", start).lt("entry_date", end);
  }

  const data = await runQuery(query);

  return Array.isArray(data) ? data.map(fromEntryRow) : [];
}

async function getEntryById(profileId, entryId, auth) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profileId, auth);
    const entry = embeddedState?.entries.find((item) => item.id === entryId);

    return entry ? fromEmbeddedEntry(entry) : null;
  }

  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_ENTRIES_TABLE_NAME)
      .select(ENTRY_COLUMNS)
      .eq("profile_id", profileId)
      .eq("id", entryId)
      .maybeSingle(),
  );

  return fromEntryRow(data);
}

async function createEntry(profile, auth, entry) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profile.id, auth);

    if (!embeddedState) {
      throw createStoreError(404, "Profile was not found.");
    }

    const client = await createSupabaseClient(auth);
    const nextEntries = [...embeddedState.entries, toEmbeddedEntry(entry)];
    let query = client
      .from(SUPABASE_TABLE_NAME)
      .update({
        entries: nextEntries,
      })
      .eq("id", profile.id);

    query = applyExpectedUpdatedAt(query, embeddedState.updatedAt);
    query = query.select("updated_at").maybeSingle();

    const data = await runQuery(query);

    if (!data) {
      throw createStoreError(
        409,
        "Profile changed while the request was being processed. Please retry.",
      );
    }

    return fromEmbeddedEntry(entry);
  }

  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_ENTRIES_TABLE_NAME)
      .insert(toEntryInsertRow(profile, entry))
      .select(ENTRY_COLUMNS)
      .single(),
  );

  return fromEntryRow(data);
}

async function updateEntry(profileId, entryId, auth, entry) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profileId, auth);

    if (!embeddedState) {
      return null;
    }

    const entryIndex = embeddedState.entries.findIndex((item) => item.id === entryId);

    if (entryIndex === -1) {
      return null;
    }

    const client = await createSupabaseClient(auth);
    const nextEntries = embeddedState.entries.slice();
    nextEntries[entryIndex] = toEmbeddedEntry({
      id: entryId,
      ...entry,
    });
    let query = client
      .from(SUPABASE_TABLE_NAME)
      .update({
        entries: nextEntries,
      })
      .eq("id", profileId);

    query = applyExpectedUpdatedAt(query, embeddedState.updatedAt);
    query = query.select("updated_at").maybeSingle();

    const data = await runQuery(query);

    if (!data) {
      throw createStoreError(
        409,
        "Profile changed while the request was being processed. Please retry.",
      );
    }

    return fromEmbeddedEntry({
      id: entryId,
      ...entry,
    });
  }

  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_ENTRIES_TABLE_NAME)
      .update(toEntryUpdateRow(entry))
      .eq("profile_id", profileId)
      .eq("id", entryId)
      .select(ENTRY_COLUMNS)
      .maybeSingle(),
  );

  return fromEntryRow(data);
}

async function deleteEntry(profileId, entryId, auth) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profileId, auth);

    if (!embeddedState) {
      return false;
    }

    const nextEntries = embeddedState.entries.filter((item) => item.id !== entryId);

    if (nextEntries.length === embeddedState.entries.length) {
      return false;
    }

    const client = await createSupabaseClient(auth);
    let query = client
      .from(SUPABASE_TABLE_NAME)
      .update({
        entries: nextEntries,
      })
      .eq("id", profileId);

    query = applyExpectedUpdatedAt(query, embeddedState.updatedAt);
    query = query.select("updated_at").maybeSingle();

    const data = await runQuery(query);

    if (!data) {
      throw createStoreError(
        409,
        "Profile changed while the request was being processed. Please retry.",
      );
    }

    return true;
  }

  const client = await createSupabaseClient(auth);
  const data = await runQuery(
    client
      .from(SUPABASE_ENTRIES_TABLE_NAME)
      .delete()
      .eq("profile_id", profileId)
      .eq("id", entryId)
      .select("id"),
  );

  return Array.isArray(data) && data.length > 0;
}

async function stopTimer(profile, auth, entry) {
  if ((await getEntriesStorageMode(auth)) === "embedded") {
    const embeddedState = await getEmbeddedEntriesState(profile.id, auth);

    if (!embeddedState) {
      throw createStoreError(404, "Profile was not found.");
    }

    const client = await createSupabaseClient(auth);
    const nextEntries = [...embeddedState.entries, toEmbeddedEntry(entry)];
    let query = client
      .from(SUPABASE_TABLE_NAME)
      .update({
        active_timer: null,
        entries: nextEntries,
      })
      .eq("id", profile.id);

    query = applyExpectedUpdatedAt(query, profile.updatedAt);
    query = query.select("id").maybeSingle();

    const data = await runQuery(query);

    if (!data) {
      throw createStoreError(
        409,
        "Timer changed while the request was being processed. Please retry.",
      );
    }

    return fromEmbeddedEntry(entry);
  }

  const createdEntry = await createEntry(profile, auth, entry);
  const updatedProfile = await updateProfileById(
    profile.id,
    auth,
    {
      activeTimer: null,
    },
    {
      expectedUpdatedAt: profile.updatedAt,
    },
  );

  if (!updatedProfile) {
    await deleteEntry(profile.id, createdEntry.id, auth).catch(() => undefined);
    throw createStoreError(
      409,
      "Timer changed while the request was being processed. Please retry.",
    );
  }

  return createdEntry;
}

async function closeDatabase() {
  return undefined;
}

module.exports = {
  closeDatabase,
  connectToDatabase,
  createEntry,
  createProfile,
  deleteEntry,
  deleteProfile,
  getEntriesByProfileId,
  getEntryById,
  getProfileByAuthUserId,
  getProfileByUsername,
  stopTimer,
  updateEntry,
  updateProfileByAuthUserId,
  updateProfileByUsername,
};
