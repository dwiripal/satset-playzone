const SHEET_NAME = 'SATSET_PLAYZONE_SYNC';
const KEY = 'STATE';

function doGet(e) {
  return jsonOutput(readState());
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'push' && body.state) {
      writeState(body.state, body.updatedAt || body.state.updatedAt || Date.now(), body.device || 'Unknown');
      return jsonOutput({ ok: true, updatedAt: body.updatedAt || body.state.updatedAt || Date.now() });
    }
    return jsonOutput(readState());
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['key', 'updated_at', 'device', 'json']);
  }
  return sh;
}

function readState() {
  const sh = getSheet();
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === KEY) {
      const state = values[i][3] ? JSON.parse(values[i][3]) : null;
      return { ok: true, updatedAt: Number(values[i][1] || 0), device: values[i][2] || '', state };
    }
  }
  return { ok: true, updatedAt: 0, state: null };
}

function writeState(state, updatedAt, device) {
  const sh = getSheet();
  const values = sh.getDataRange().getValues();
  const json = JSON.stringify(state);
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === KEY) {
      sh.getRange(i + 1, 1, 1, 4).setValues([[KEY, Number(updatedAt), device, json]]);
      return;
    }
  }
  sh.appendRow([KEY, Number(updatedAt), device, json]);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
