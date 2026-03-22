require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

/**
 * CORS: allow frontend origin(s) and preflight (OPTIONS).
 * In production, set FRONTEND_URL (e.g. https://tu-app.vercel.app) so only your frontend is allowed.
 * If unset, allows any origin (development / quick deploy).
 */
const corsOptions = {
  origin: process.env.FRONTEND_URL || true, // true = reflect request origin (any)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
};
app.use(cors(corsOptions));

/** Handle CORS preflight without route-pattern parsing issues in Express 5. */
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json());

// Health check (for Railway and to verify server responds)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/users.routes'));
app.use('/api/teams', require('./routes/teams.routes'));
app.use('/api/clients', require('./routes/clients.routes'));
app.use('/api/sites', require('./routes/sites.routes'));
app.use('/api/logs', require('./routes/logs.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/supplies', require('./routes/supplies.routes'));
app.use('/api/supply-orders', require('./routes/supplyOrders.routes'));
app.use('/api/tools', require('./routes/tools.routes'));
app.use('/api/cars', require('./routes/cars.routes'));
app.use('/api/vacations', require('./routes/vacations.routes'));
app.use('/api/complaints', require('./routes/complaints.routes'));
app.use('/api/planner', require('./routes/planner.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 required for Railway/fly.io
app.listen(PORT, HOST, () => {
  console.log(`Limpia backend running on ${HOST}:${PORT}`);
});
