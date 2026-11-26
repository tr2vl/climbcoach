// Windows' own text recognition, end to end: draw a frame with the end banner and a death screen,
// read it with the OCR worker, and check the HUD readers find both. Runs on Windows only (GitHub's
// Windows machines run it on every push); skipped elsewhere.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deathScreen, endResult } from '../src/shared/hud.js';
import { OcrWorker } from '../src/main/ocr.js';

const onWindows = process.platform === 'win32';

test('Windows OCR reads the end banner and the kill cam', { skip: !onWindows && 'Windows only' }, async (t) => {
  const image = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-')), 'frame.png');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap 1600, 900
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.Clear([System.Drawing.Color]::FromArgb(20, 26, 36))
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $white = [System.Drawing.Brushes]::White
    $g.DrawString('ELIMINATED BY REAPER', (New-Object System.Drawing.Font('Arial', 28, [System.Drawing.FontStyle]::Bold)), $white, 560, 40)
    $g.DrawString('VICTORY', (New-Object System.Drawing.Font('Arial', 96, [System.Drawing.FontStyle]::Bold)), $white, 520, 300)
    $bitmap.Save('${image.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
  `]);
  const worker = new OcrWorker();
  try {
    let lines;
    try {
      lines = await worker.read(image);
    } catch (error) {
      // A build machine without an OCR language says so; that's the machine, not the app. Anything else fails.
      if (/no text-recognition language/i.test(error.message)) return t.skip(`this PC has no text-recognition language: ${error.message}`);
      throw error;
    }
    assert.ok(lines.length >= 2, `read ${JSON.stringify(lines)}`);
    assert.equal(endResult(lines), 'win');
    assert.equal(deathScreen(lines)?.killer, 'REAPER');
  } finally {
    worker.stop();
  }
});
