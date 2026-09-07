const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const FEEDBACK_CATEGORIES = ["bug", "idea", "other"];
const FEEDBACK_STATUSES = ["NEW", "TRIAGED", "RESOLVED", "WONT_FIX"];
// Mirrors the maxlength on the feedback textarea in the frontend.
const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;
const FEEDBACK_ADMIN_NOTE_MAX_LENGTH = 2000;
// The frontend only ever attaches these keys; anything else is dropped so the
// stored context cannot grow without bound.
const FEEDBACK_CONTEXT_FIELDS = [
  "username",
  "email",
  "displayName",
  "role",
  "page",
  "userAgent",
  "appVersion",
  "language",
  "platform",
  "screen",
  "timezone",
  "selectedMonth",
];
const FEEDBACK_CONTEXT_VALUE_MAX_LENGTH = 500;

function assertString(value, fieldName, options = {}) {
  const { allowEmpty = true } = options;

  if (typeof value !== "string") {
    throw validationError(fieldName, `${fieldName} must be a string.`);
  }

  if (!allowEmpty && value.trim() === "") {
    throw validationError(fieldName, `${fieldName} must not be empty.`);
  }
}

function validationError(field, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = { field };
  return error;
}

function validateUsername(username) {
  assertString(username, "username", { allowEmpty: false });

  if (username !== username.toLowerCase()) {
    throw validationError("username", "username must be lowercase.");
  }

  if (!USERNAME_PATTERN.test(username)) {
    throw validationError(
      "username",
      "username must be slug-style, for example dong-huu-trong.",
    );
  }
}

function validateSelectedMonth(selectedMonth) {
  assertString(selectedMonth, "selectedMonth", { allowEmpty: false });

  if (!MONTH_PATTERN.test(selectedMonth)) {
    throw validationError(
      "selectedMonth",
      "selectedMonth must use YYYY-MM format.",
    );
  }

  const [year, month] = selectedMonth.split("-").map(Number);

  if (month < 1 || month > 12 || year < 1970) {
    throw validationError(
      "selectedMonth",
      "selectedMonth is not a valid month.",
    );
  }
}

function validateDate(date) {
  assertString(date, "date", { allowEmpty: false });

  if (!DATE_PATTERN.test(date)) {
    throw validationError("date", "date must use YYYY-MM-DD format.");
  }

  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw validationError("date", "date is not valid.");
  }
}

function validateTime(time, fieldName, options = {}) {
  const { allow24 = false } = options;

  assertString(time, fieldName, { allowEmpty: false });

  if (time === "24:00") {
    if (!allow24) {
      throw validationError(fieldName, `${fieldName} does not allow 24:00.`);
    }

    return;
  }

  if (!TIME_PATTERN.test(time)) {
    throw validationError(fieldName, `${fieldName} must use HH:MM format.`);
  }
}

function validateEmployee(employee) {
  if (!employee || typeof employee !== "object" || Array.isArray(employee)) {
    throw validationError("employee", "employee must be an object.");
  }

  const employeeFields = ["label", "employeeCode", "fullName", "sheetName"];

  for (const field of employeeFields) {
    assertString(employee[field] ?? "", `employee.${field}`);
  }
}

function validateCreateProfileEmployee(employee) {
  if (!employee || typeof employee !== "object" || Array.isArray(employee)) {
    throw validationError("employee", "employee must be an object.");
  }

  const employeeFields = ["label", "employeeCode", "fullName", "sheetName"];

  for (const field of employeeFields) {
    if (field in employee) {
      assertString(employee[field], `employee.${field}`);
    }
  }
}

function sanitizeNote(note) {
  if (note === undefined) {
    return "";
  }

  assertString(note, "note");
  return note;
}

function validateEntryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  validateDate(payload.date);
  validateTime(payload.startTime, "startTime");
  validateTime(payload.endTime, "endTime", { allow24: true });

  return {
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    note: sanitizeNote(payload.note),
  };
}

function validateCreateProfilePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  validateUsername(payload.username);

  const result = {
    username: payload.username,
  };

  if ("employee" in payload) {
    validateCreateProfileEmployee(payload.employee);
    result.employee = payload.employee;
  }

  return result;
}

function validateProfileUpdatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  const result = {};

  if ("selectedMonth" in payload) {
    validateSelectedMonth(payload.selectedMonth);
    result.selectedMonth = payload.selectedMonth;
  }

  if ("employee" in payload) {
    validateEmployee(payload.employee);
    result.employee = payload.employee;
  }

  if (Object.keys(result).length === 0) {
    throw validationError("body", "Provide selectedMonth and/or employee.");
  }

  return result;
}

function validateTimerPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  return {
    note: sanitizeNote(payload.note),
  };
}

function validateFeedbackCategory(category) {
  assertString(category, "category", { allowEmpty: false });

  if (!FEEDBACK_CATEGORIES.includes(category)) {
    throw validationError(
      "category",
      `category must be one of ${FEEDBACK_CATEGORIES.join(", ")}.`,
    );
  }
}

function validateFeedbackMessage(message) {
  assertString(message, "message", { allowEmpty: false });

  const trimmedMessage = message.trim();

  if (trimmedMessage.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    throw validationError(
      "message",
      `message must be at most ${FEEDBACK_MESSAGE_MAX_LENGTH} characters.`,
    );
  }

  return trimmedMessage;
}

function sanitizeFeedbackContext(context) {
  if (context === undefined || context === null) {
    return null;
  }

  if (typeof context !== "object" || Array.isArray(context)) {
    throw validationError("context", "context must be an object or null.");
  }

  const sanitizedContext = {};

  for (const field of FEEDBACK_CONTEXT_FIELDS) {
    const value = context[field];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (typeof value !== "string" && typeof value !== "number") {
      throw validationError(
        `context.${field}`,
        `context.${field} must be a string or number.`,
      );
    }

    sanitizedContext[field] = String(value).slice(
      0,
      FEEDBACK_CONTEXT_VALUE_MAX_LENGTH,
    );
  }

  return Object.keys(sanitizedContext).length > 0 ? sanitizedContext : null;
}

function validateFeedbackPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  const category = payload.category ?? "other";
  validateFeedbackCategory(category);

  return {
    category,
    message: validateFeedbackMessage(payload.message),
    context: sanitizeFeedbackContext(payload.context),
  };
}

function validateFeedbackUpdatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  const result = {};

  if ("status" in payload) {
    assertString(payload.status, "status", { allowEmpty: false });

    if (!FEEDBACK_STATUSES.includes(payload.status)) {
      throw validationError(
        "status",
        `status must be one of ${FEEDBACK_STATUSES.join(", ")}.`,
      );
    }

    result.status = payload.status;
  }

  if ("adminNote" in payload) {
    assertString(payload.adminNote, "adminNote");

    if (payload.adminNote.length > FEEDBACK_ADMIN_NOTE_MAX_LENGTH) {
      throw validationError(
        "adminNote",
        `adminNote must be at most ${FEEDBACK_ADMIN_NOTE_MAX_LENGTH} characters.`,
      );
    }

    result.adminNote = payload.adminNote;
  }

  if (Object.keys(result).length === 0) {
    throw validationError("body", "Provide status and/or adminNote.");
  }

  return result;
}

function validateFeedbackStatusQuery(status) {
  if (status === undefined) {
    return undefined;
  }

  assertString(status, "status", { allowEmpty: false });

  if (!FEEDBACK_STATUSES.includes(status)) {
    throw validationError(
      "status",
      `status must be one of ${FEEDBACK_STATUSES.join(", ")}.`,
    );
  }

  return status;
}

function validateLimitQuery(limit, options = {}) {
  const { defaultValue = 50, maxValue = 200 } = options;

  if (limit === undefined) {
    return defaultValue;
  }

  const parsedLimit = Number(limit);

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw validationError("limit", "limit must be a positive integer.");
  }

  return Math.min(parsedLimit, maxValue);
}

function validateMonthQuery(month) {
  if (month === undefined) {
    return undefined;
  }

  validateSelectedMonth(month);
  return month;
}

module.exports = {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  validateCreateProfilePayload,
  validateEmployee,
  validateEntryPayload,
  validateFeedbackPayload,
  validateFeedbackStatusQuery,
  validateFeedbackUpdatePayload,
  validateLimitQuery,
  validateMonthQuery,
  validateProfileUpdatePayload,
  validateSelectedMonth,
  validateTime,
  validateTimerPayload,
  validateUsername,
};
