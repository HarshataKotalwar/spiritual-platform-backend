import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import pool from '../db.js';
import { processScheduledReminders } from '../services/notifications/reminders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERVAL_MS = 60 * 1000;

const startedKey = '__spiritualNotificationSchedulerStarted';

const ensureSchema = async () => {
  const sqlPath = path.join(__dirname, '../notifications.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};

const runTick = async () => {
  try {
    await processScheduledReminders();
  } catch (error) {
    console.error('Notification scheduler error:', error);
  }
};

export const startNotificationScheduler = async () => {
  if (globalThis[startedKey]) {
    return;
  }
  globalThis[startedKey] = true;

  try {
    await ensureSchema();
  } catch (error) {
    console.error('Notification schema setup error:', error);
  }

  await runTick();
  const timer = setInterval(runTick, INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};
