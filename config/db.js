const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,        // Hostinger/Railway tienen límites bajos
  queueLimit: 0,
  enableKeepAlive: true,     // Evita que el host mate conexiones idle
  keepAliveInitialDelay: 10000, // Primer keep-alive a los 10s
  connectTimeout: 10000,     // Falla rápido si no conecta
});

// Si una conexión muere (PROTOCOL_CONNECTION_LOST, ECONNRESET, etc.)
// mysql2 la descarta del pool automáticamente, pero logeamos el error
pool.on('connection', (conn) => {
  conn.on('error', (err) => {
    if (err.code !== 'PROTOCOL_CONNECTION_LOST' && err.code !== 'ECONNRESET') {
      console.error('DB connection error:', err);
    }
  });
});

module.exports = pool.promise();
