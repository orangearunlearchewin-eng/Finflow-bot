// Google Apps Script Web App backend for FinFlow Bot
// Sheet columns (row 1 = headers): id | date | type | category | amount | note
const SHEET_NAME = "FinFlow Data";

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const body = JSON.parse(e.postData.contents);
  let result = { status: "ok" };

  if (body.action === "add") {
    sheet.appendRow([
      body.id,
      body.date,
      body.type,
      body.category,
      Number(body.amount),
      body.note || ""
    ]);
  } else if (body.action === "edit") {
    const rowIndex = findRowById(sheet, body.id);
    if (rowIndex === -1) {
      result = { status: "error", message: "ไม่พบรายการที่ต้องการแก้ไข" };
    } else {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      headers.forEach((header, col) => {
        if (header === "id" || !Object.prototype.hasOwnProperty.call(body, header)) return;
        const value = header === "amount" ? Number(body[header]) : body[header];
        sheet.getRange(rowIndex, col + 1).setValue(value);
      });
    }
  } else if (body.action === "delete") {
    const rowIndex = findRowById(sheet, body.id);
    if (rowIndex === -1) {
      result = { status: "error", message: "ไม่พบรายการที่ต้องการลบ" };
    } else {
      sheet.deleteRow(rowIndex);
    }
  } else {
    result = { status: "error", message: "ไม่รู้จัก action: " + body.action };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}
