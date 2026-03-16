const db = require('../config/db');
const { uploadImageBuffer } = require('../services/cloudinaryUpload');

// --- Supplies (inventory) ---

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM supplies ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * Uploads a single image to Cloudinary and returns the URL for supplies.imagen_url.
 * Expects multipart field "image". Returns { imagen_url } for use in create/update.
 */
exports.uploadSupplyImage = async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ message: 'Se requiere un archivo de imagen en el campo "image"' });
  }
  try {
    const { secure_url } = await uploadImageBuffer(req.file.buffer);
    res.status(201).json({ imagen_url: secure_url });
  } catch (err) {
    res.status(500).json({ message: 'Error al subir imagen', error: err.message });
  }
};

exports.create = async (req, res) => {
  let { nombre, descripcion, unidad, stock_actual, stock_minimo, precio_unitario, imagen_url, proveedor_id } = req.body;
  if (!nombre) return res.status(400).json({ message: 'Nombre requerido' });
  try {
    if (req.file && req.file.buffer) {
      const { secure_url } = await uploadImageBuffer(req.file.buffer);
      imagen_url = secure_url;
    }
    const [result] = await db.query(
      'INSERT INTO supplies (nombre, descripcion, unidad, stock_actual, stock_minimo, precio_unitario, imagen_url, proveedor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, descripcion, unidad, stock_actual || 0, stock_minimo || 0, precio_unitario, imagen_url || null, proveedor_id || null]
    );
    res.status(201).json({ id: result.insertId, nombre, imagen_url: imagen_url || null });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.update = async (req, res) => {
  let { nombre, descripcion, unidad, stock_actual, stock_minimo, precio_unitario, imagen_url, proveedor_id } = req.body;
  try {
    if (req.file && req.file.buffer) {
      const { secure_url } = await uploadImageBuffer(req.file.buffer);
      imagen_url = secure_url;
    }
    const [result] = await db.query(
      'UPDATE supplies SET nombre = ?, descripcion = ?, unidad = ?, stock_actual = ?, stock_minimo = ?, precio_unitario = ?, imagen_url = ?, proveedor_id = ? WHERE id = ?',
      [nombre, descripcion, unidad, stock_actual, stock_minimo, precio_unitario, imagen_url || null, proveedor_id || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Insumo no encontrado' });
    res.json({ message: 'Insumo actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

// --- Supply Orders ---

/**
 * Returns all supply orders belonging to the authenticated user's active team.
 * The team is resolved from user_team_history (fecha_fin IS NULL).
 * Each order includes its items with supply name and unit.
 * @route GET /api/supply-orders/my-team
 */
exports.getMyTeamOrders = async (req, res) => {
  try {
    const [teamRows] = await db.query(
      'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL',
      [req.user.id]
    );
    if (!teamRows.length) {
      return res.status(400).json({ message: 'No tienes un equipo activo asignado' });
    }
    const teamId = teamRows[0].team_id;

    const [orders] = await db.query(
      `SELECT so.*, u.nombre AS solicitante, t.numero AS equipo_numero
       FROM supply_orders so
       JOIN users u ON so.user_id = u.id
       LEFT JOIN teams t ON so.equipo_id = t.id
       WHERE so.equipo_id = ?
       ORDER BY so.fecha DESC`,
      [teamId]
    );

    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const [items] = await db.query(
          `SELECT soi.*, s.nombre AS insumo, s.unidad
           FROM supply_order_items soi
           JOIN supplies s ON soi.supply_id = s.id
           WHERE soi.order_id = ?`,
          [order.id]
        );
        return { ...order, equipo: order.equipo_numero || null, items };
      })
    );

    res.json(ordersWithItems);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT so.*, u.nombre AS solicitante, t.numero AS equipo_numero
       FROM supply_orders so
       JOIN users u ON so.user_id = u.id
       LEFT JOIN teams t ON so.equipo_id = t.id
       ORDER BY so.fecha DESC`
    );
    const mapped = rows.map((row) => ({
      ...row,
      equipo: row.equipo_numero || null,
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM supply_orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Orden no encontrada' });

    const [items] = await db.query(
      `SELECT soi.*, s.nombre AS insumo, s.unidad
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
  const { items, equipo_id: bodyEquipoId } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ message: 'Se requiere al menos un ítem' });
  }

  const userRole = req.user?.rol;
  const isAdminLike = ['admin', 'manager', 'accountant'].includes(userRole);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let equipo_id = null;

    if (isAdminLike) {
      if (bodyEquipoId === undefined || bodyEquipoId === null || String(bodyEquipoId).trim() === '') {
        await conn.rollback();
        return res.status(400).json({ message: 'equipo_id requerido para este rol' });
      }
      const parsedEquipo = Number(bodyEquipoId);
      if (!Number.isInteger(parsedEquipo) || parsedEquipo <= 0) {
        await conn.rollback();
        return res.status(400).json({ message: 'equipo_id invalido' });
      }

      const [teamRows] = await conn.query(
        'SELECT id FROM teams WHERE id = ? AND activo = 1',
        [parsedEquipo]
      );
      if (!teamRows.length) {
        await conn.rollback();
        return res.status(400).json({ message: 'equipo_id no existe o no está activo' });
      }
      equipo_id = parsedEquipo;
    } else if (userRole === 'cleaner') {
      const [teamRows] = await conn.query(
        'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL',
        [req.user.id]
      );
      if (!teamRows.length) {
        await conn.rollback();
        return res.status(400).json({ message: 'El limpiador no tiene equipo activo asignado' });
      }
      const cleanerTeamId = teamRows[0].team_id;
      const [teamActive] = await conn.query(
        'SELECT id FROM teams WHERE id = ? AND activo = 1',
        [cleanerTeamId]
      );
      if (!teamActive.length) {
        await conn.rollback();
        return res.status(400).json({ message: 'El equipo del limpiador no está activo' });
      }
      equipo_id = cleanerTeamId;
    } else {
      await conn.rollback();
      return res.status(403).json({ message: 'Rol no autorizado para crear pedidos' });
    }

    const [orderResult] = await conn.query(
      'INSERT INTO supply_orders (equipo_id, user_id, fecha, estado) VALUES (?, ?, CURDATE(), "pendiente")',
      [equipo_id, req.user.id]
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
      'UPDATE supply_orders SET estado = "aprobado" WHERE id = ? AND estado = "pendiente"',
      [req.params.id]
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
  try {
    const [result] = await db.query(
      'UPDATE supply_orders SET estado = "rechazado" WHERE id = ? AND estado = "pendiente"',
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Orden no encontrada o ya procesada' });
    }
    res.json({ message: 'Orden rechazada' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
