/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * https://github.com/BAWORBAWORID
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import 'dotenv/config';
import app from '../src/app/index.js';

/**
 * Vercel Serverless Entry Point
 * Exports the Express app as a serverless function
 * 
 * Usage:
 * - Deploy to Vercel: vercel deploy
 * - Test locally: vercel dev
 * 
 * All API endpoints under /api/* will be available at:
 * https://your-project.vercel.app/api/endpoint-name
 */
export default app;
