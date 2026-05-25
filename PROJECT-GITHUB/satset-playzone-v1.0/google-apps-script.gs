const APP_NAME = 'SATSET_PLAYZONE';
const SHEET_STATE = 'STATE';
const SHEET_LOG = 'SYNC_LOG';

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    setupSheets_();
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || '').toLowerCase();
    if (action === 'pull') return json_(pullState_());
    if (action === 'push') return json_(pushState_(parseBody_(e)));
    if (action === 'ping') return json_({ ok:true, app:APP_NAME, message:'SATSET PLAYZONE sync aktif', serverTime:new Date().toISOString() });
    return json_({ ok:false, error:'Action tidak dikenal. Gunakan ?action=pull, ?action=push, atau ?action=ping' });
  } catch (err) { return json_({ ok:false, error:String(err && err.message ? err.message : err) }); }
}
function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let stateSheet = ss.getSheetByName(SHEET_STATE);
  if (!stateSheet) { stateSheet = ss.insertSheet(SHEET_STATE); stateSheet.getRange(1,1,1,4).setValues([['key','json','updatedAt','updatedBy']]); stateSheet.setFrozenRows(1); }
  let logSheet = ss.getSheetByName(SHEET_LOG);
  if (!logSheet) { logSheet = ss.insertSheet(SHEET_LOG); logSheet.getRange(1,1,1,5).setValues([['time','action','device','status','note']]); logSheet.setFrozenRows(1); }
}
function pullState_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = ss.getSheetByName(SHEET_STATE); const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok:true, empty:true, state:null, updatedAt:null, updatedBy:null };
  const values = sheet.getRange(2,1,lastRow-1,4).getValues(); let found = null;
  for (let i=0;i<values.length;i++) if (String(values[i][0]) === 'playzone_state') { found = values[i]; break; }
  if (!found) return { ok:true, empty:true, state:null, updatedAt:null, updatedBy:null };
  let parsed = null; try { parsed = JSON.parse(found[1] || '{}'); } catch (err) {}
  log_('pull', '', 'ok', 'Data ditarik'); return { ok:true, empty:false, state:parsed, updatedAt:found[2], updatedBy:found[3] };
}
function pushState_(body) {
  if (!body || !body.state) return { ok:false, error:'Body tidak valid. Kirim JSON: { deviceName, state }' };
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = ss.getSheetByName(SHEET_STATE);
  const deviceName = String(body.deviceName || body.device || 'Unknown Device'); const stateJson = JSON.stringify(body.state); const now = new Date().toISOString();
  const lastRow = sheet.getLastRow(); let targetRow = -1;
  if (lastRow >= 2) { const keys = sheet.getRange(2,1,lastRow-1,1).getValues(); for (let i=0;i<keys.length;i++) if (String(keys[i][0]) === 'playzone_state') { targetRow = i+2; break; } }
  if (targetRow === -1) targetRow = sheet.getLastRow()+1;
  sheet.getRange(targetRow,1,1,4).setValues([['playzone_state', stateJson, now, deviceName]]);
  log_('push', deviceName, 'ok', 'Data dikirim'); return { ok:true, saved:true, updatedAt:now, updatedBy:deviceName };
}
function parseBody_(e) { if (!e || !e.postData || !e.postData.contents) return {}; try { return JSON.parse(e.postData.contents); } catch (err) { return {}; } }
function log_(action, device, status, note) { try { SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG).appendRow([new Date(), action, device || '', status || '', note || '']); } catch (err) {} }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
