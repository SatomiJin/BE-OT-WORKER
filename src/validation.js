const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
    throw validationError("username", "username must be slug-style, for example dong-huu-trong.");
  }
}

function validateSelectedMonth(selectedMonth) {
  assertString(selectedMonth, "selectedMonth", { allowEmpty: false });

  if (!MONTH_PATTERN.test(selectedMonth)) {
    throw validationError("selectedMonth", "selectedMonth must use YYYY-MM format.");
  }

  const [year, month] = selectedMonth.split("-").map(Number);

  if (month < 1 || month > 12 || year < 1970) {
    throw validationError("selectedMonth", "selectedMonth is not a valid month.");
  }
}

function validateDate(date) {
  assertString(date, "date", { allowEmpty: false });

  if (!DATE_PATTERN.test(date)) {
    throw validationError("date", "date must use YYYY-MM-DD format.");
  }

  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
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
    note: sanitizeNote(payload.note)
  };
}

function validateCreateProfilePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("body", "Request body must be an object.");
  }

  validateUsername(payload.username);

  return {
    username: payload.username
  };
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
    note: sanitizeNote(payload.note)
  };
}

function validateMonthQuery(month) {
  if (month === undefined) {
    return undefined;
  }

  validateSelectedMonth(month);
  return month;
}

module.exports = {
  validateCreateProfilePayload,
  validateEmployee,
  validateEntryPayload,
  validateMonthQuery,
  validateProfileUpdatePayload,
  validateSelectedMonth,
  validateTime,
  validateTimerPayload,
  validateUsername
};
