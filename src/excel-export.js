const ExcelJS = require("exceljs");

const EXCEL_COLUMN_WIDTHS = [
  16.75,
  16.75,
  22.13,
  22.13,
  36.63,
  16.75,
  16.75,
  16.75,
  94.75,
];
const EXCEL_SHEET_NAME_LIMIT = 31;
const FALLBACK_SHEET_NAME = "Sheet1";

function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(time || "");

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour === 24 && minute === 0) {
    return 24 * 60;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function calculateDurationHours(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const durationMinutes =
    endMinutes >= startMinutes
      ? endMinutes - startMinutes
      : endMinutes + 24 * 60 - startMinutes;

  return Number((durationMinutes / 60).toFixed(2));
}

function getNextDate(date) {
  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + 1);
  return parsedDate.toISOString().slice(0, 10);
}

function splitEntryForExport(entry) {
  const startMinutes = timeToMinutes(entry.startTime);
  const endMinutes = timeToMinutes(entry.endTime);

  if (
    startMinutes === null ||
    endMinutes === null ||
    endMinutes >= startMinutes
  ) {
    return [entry];
  }

  const segments = [
    {
      ...entry,
      endTime: "24:00",
    },
  ];

  if (entry.endTime !== "00:00") {
    segments.push({
      ...entry,
      id: `${entry.id}-next-day`,
      date: getNextDate(entry.date),
      startTime: "00:00",
    });
  }

  return segments;
}

function formatExportDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toExcelDate(date) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsedDate.getTime()) ? date : parsedDate;
}

function toExcelTime(time) {
  const minutes = timeToMinutes(time);
  return minutes === null ? time : minutes / (24 * 60);
}

function sanitizeSheetName(sheetName) {
  const trimmed = String(sheetName || "").trim();
  const normalized =
    !trimmed ||
    trimmed.toLowerCase() === "sheet1" ||
    trimmed.toLowerCase() === "trang t\u00ednh 1"
      ? FALLBACK_SHEET_NAME
      : trimmed;

  return normalized
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCEL_SHEET_NAME_LIMIT) || FALLBACK_SHEET_NAME;
}

function getUniqueSheetName(workbook, desiredName) {
  const baseName = sanitizeSheetName(desiredName);
  let candidate = baseName;
  let index = 2;

  while (workbook.getWorksheet(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${baseName.slice(0, EXCEL_SHEET_NAME_LIMIT - suffix.length)}${suffix}`;
    index += 1;
  }

  return candidate;
}

function styleHeader(row) {
  row.height = 28;

  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF914D4F" } };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  EXCEL_COLUMN_WIDTHS.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  styleHeader(worksheet.getRow(1));

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.height = 22;
    }

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };

      if (columnNumber === 5) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFB7E1CD" },
        };
      }

      if (columnNumber === 8) {
        cell.font = {
          ...(cell.font || {}),
          color: { argb: "FF4A86E8" },
        };
      }
    });
  });
}

function addProfileWorksheet(workbook, profile) {
  const employee = profile.employee || {};
  const worksheet = workbook.addWorksheet(
    getUniqueSheetName(workbook, employee.sheetName),
  );

  worksheet.addRow([
    "DEMO",
    "MSNV",
    "H\u1ecd v\u00e0 t\u00ean",
    "",
    "Ng\u00e0y ghi nh\u1eadn OT",
    "Th\u1eddi gian v\u00e0o ca",
    "Th\u1eddi gian ra ca",
    "T\u1ed5ng gi\u1edd OT",
    "Gi\u1ea3i tr\u00ecnh (7,14,21,28)",
  ]);

  const entries = profile.entries
    .flatMap(splitEntryForExport)
    .sort((entry, otherEntry) =>
      `${entry.date} ${entry.startTime}`.localeCompare(
        `${otherEntry.date} ${otherEntry.startTime}`,
      ),
    );

  for (const entry of entries) {
    const row = worksheet.addRow([
      "DEMO",
      employee.employeeCode || "",
      employee.fullName || "",
      "",
      toExcelDate(entry.date),
      toExcelTime(entry.startTime),
      toExcelTime(entry.endTime),
      null,
      String(entry.note || "").trim(),
    ]);
    const durationHours = calculateDurationHours(entry.startTime, entry.endTime);
    const rowNumber = row.number;

    row.getCell(5).numFmt = "dd/MM/yyyy";
    row.getCell(6).numFmt = "HH:mm:ss";
    row.getCell(7).numFmt = "HH:mm:ss";
    row.getCell(8).numFmt = "@";
    row.getCell(8).value = {
      formula: `SUBSTITUTE(TEXT(MOD(G${rowNumber}-F${rowNumber},1)*24,"0.00"),",",".")`,
      result: durationHours === null ? "" : durationHours.toFixed(2),
    };
  }

  styleWorksheet(worksheet);
}

async function buildOtExportWorkbookBuffer(profiles) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OT Tracker";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  for (const profile of profiles) {
    addProfileWorksheet(workbook, profile);
  }

  if (workbook.worksheets.length === 0) {
    addProfileWorksheet(workbook, {
      employee: { sheetName: FALLBACK_SHEET_NAME },
      entries: [],
    });
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildOtExportWorkbookBuffer,
  formatExportDate,
};
