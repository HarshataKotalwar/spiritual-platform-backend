import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import pool from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ensureHelpSchema = async () => {
  const sqlPath = path.join(__dirname, '../../help_support.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
};
