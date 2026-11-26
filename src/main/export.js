// Saving a report as Markdown, as a PDF in the app's look, or as a light PDF for printing.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { matchTitle } from '../shared/match.js';
import { markdown, reportDocument, reportHTML } from '../shared/export.js';

export async function exportReport({ window, db, matchID, runID, format }) {
  const match = db.match(matchID);
  const run = match?.runs?.find((r) => r.id === runID);
  if (!run) throw new Error('That report no longer exists.');
  const extension = format === 'markdown' ? 'md' : 'pdf';
  const day = new Date(match.playedAt).toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(window, {
    title: 'Save the report', defaultPath: `ClimbCoach ${matchTitle(match)} ${day}.${extension}`,
    filters: [extension === 'md' ? { name: 'Markdown', extensions: ['md'] } : { name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const options = { allMatches: db.data.matches, habits: db.data.habits };
  if (format === 'markdown') {
    fs.writeFileSync(result.filePath, markdown(reportDocument(match, run, options.allMatches, options.habits)));
    return path.basename(result.filePath);
  }
  // Your hero from the hero select screen of your own recording, never game art.
  const still = match.video?.heroStill && fs.existsSync(match.video.heroStill)
    ? `data:image/jpeg;base64,${fs.readFileSync(match.video.heroStill).toString('base64')}` : null;
  const html = reportHTML(match, run, { ...options, style: format === 'pdf-print' ? 'print' : 'screen', heroImage: still });
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await page.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
    const pdf = await page.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
    fs.writeFileSync(result.filePath, pdf);
  } finally {
    page.destroy();
  }
  return path.basename(result.filePath);
}
