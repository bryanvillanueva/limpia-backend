const db = require('../config/db');

// --- Supplies (inventory) ---

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM supplies ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.create = async (req, res) => {
  const { nombre, unidad, stock_actual, stock_minimo } = req.body;
  if (!nombre) return res.status(400).json({ message: 'Nombre requerido' });
  try {
    const [result] = await db.query(
      'INSERT INTO supplies (nombre, unidad, stock_actual, stock_minimo) VALUES (?, ?, ?, ?)',
      [nombre, unidad, stock_actual || 0, stock_minimo || 0]
    );
    res.status(201).json({ id: result.insertId, nombre, unidad, stock_actual, stock_minimo });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  const { nombre, unidad, stock_actual, stock_minimo } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE supplies SET nombre = ?, unidad = ?, stock_actual = ?, stock_minimo = ? WHERE id = ?',
      [nombre, unidad, stock_actual, stock_minimo, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Insumo no encontrado' });
    res.json({ message: 'Insumo actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

// --- Supply Orders ---

exports.getAllOrders = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT so.*, u.nombre AS solicitante
       FROM supply_orders so
       JOIN users u ON so.user_id = u.id
       ORDER BY so.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM supply_orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Orden no encontrada' });

    const [items] = await db.query(
      `SELECT soi.*, s.nombre AS insumo
       FROM supply_order_items soi
       JOIN supplies s ON soi.supply_id = s.id
       WHERE soi.order_id = ?`,
      [req.params.id]
    );

    res.json({ ...orders[0], items });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.createOrder = async (req, res) => {
  const { items, notas } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ message: 'Se requiere al menos un ítem' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [orderResult] = await conn.query(
      'INSERT INTO supply_orders (user_id, notas, estado) VALUES (?, ?, "pendiente")',
      [req.user.id, notas]
    );
    const orderId = orderResult.insertId;

    for (const item of items) {
      await conn.query(
        'INSERT INTO supply_order_items (order_id, supply_id, cantidad) VALUES (?, ?, ?)',
        [orderId, item.supply_id, item.cantidad]
      );
    }

    await conn.commit();
    res.status(201).json({ id: orderId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

exports.approveOrder = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE supply_orders SET estado = "aprobado", aprobado_por = ? WHERE id = ? AND estado = "pendiente"',
      [req.user.id, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Orden no encontrada o ya procesada' });
    }
    res.json({ message: 'Orden aprobada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.completeOrder = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query(
      'SELECT * FROM supply_orders WHERE id = ? AND estado = "aprobado"',
      [req.params.id]
    );
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Orden no encontrada o no aprobada' });
    }

    // Deduct stock for each item
    const [items] = await conn.query(
      'SELECT * FROM supply_order_items WHERE order_id = ?',
      [req.params.id]
    );
    for (const item of items) {
      await conn.query(
        'UPDATE supplies SET stock_actual = stock_actual - ? WHERE id = ?',
        [item.cantidad, item.supply_id]
      );
    }

    await conn.query(
      'UPDATE supply_orders SET estado = "completado" WHERE id = ?',
      [req.params.id]
    );

    await conn.commit();
    res.json({ message: 'Orden completada, stock actualizado' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

exports.rejectOrder = async (req, res) => {
  const { motivo } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE supply_orders SET estado = "rechazado", motivo_rechazo = ? WHERE id = ? AND estado = "pendiente"',
      [motivo, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Orden no encontrada o ya procesada' });
    }
    res.json({ message: 'Orden rechazada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
