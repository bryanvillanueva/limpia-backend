require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Limpia backend running on port ${PORT}`);
});
