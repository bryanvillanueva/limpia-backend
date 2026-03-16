const db = require('../config/db');

/**
 * Returns the team_id for the currently authenticated cleaner.
 * Looks up the active entry in user_team_history.
 * @param {number} userId - The authenticated user's id.
 * @returns {number|null} team_id or null if not assigned.
 */
async function getCleanerTeamId(userId) {
  const [rows] = await db.query(
    'SELECT team_id FROM user_team_history WHERE user_id = ? AND fecha_fin IS NULL LIMIT 1',
    [userId]
  );
  return rows.length > 0 ? rows[0].team_id : null;
}

/**
 * Checks whether the authenticated user has access to the given team's planner.
 * Admin/Manager/Accountant can access any team.
 * Cleaner can only access their own team.
 * @param {object} user - req.user ({ id, rol }).
 * @param {number} teamId - The target team id.
 * @returns {{ allowed: boolean, cleanerTeamId: number|null }}
 */
async function checkTeamAccess(user, teamId) {
  const privileged = ['admin', 'manager', 'accountant'];
  if (privileged.includes(user.rol)) {
    return { allowed: true, cleanerTeamId: null };
  }

  const cleanerTeamId = await getCleanerTeamId(user.id);
  return {
    allowed: cleanerTeamId !== null && cleanerTeamId === Number(teamId),
    cleanerTeamId,
  };
}

/**
 * GET /planner/:teamId/:cycleWeek
 *
 * Returns the planner grid for a given team and cycle week.
 * Structure: array of plan entries, each with its items grouped by day.
 * Also returns day totals (sum of display_value per day_of_week).
 *
 * @param {import('express').Request} req - req.params.teamId and req.params.cycleWeek.
 * @param {import('express').Response} res - JSON with plans, items, and totals.
 */
exports.getWeekPlan = async (req, res) => {
  const { teamId, cycleWeek } = req.params;

  try {
    const access = await checkTeamAccess(req.user, teamId);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso al planner de este equipo' });
    }

    const [plans] = await db.query(
      `SELECT p.id AS plan_id,
              p.site_id,
              p.cycle_week,
              p.week_comment,
              p.active,
              p.color,
              s.direccion_linea1,
              s.suburb,
              s.state,
              s.postcode,
              c.nombre AS cliente_nombre,
              tsa.frecuencia,
              tsa.hace_bins
       FROM team_site_cycle_plan p
       JOIN sites s ON p.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       LEFT JOIN team_site_assignments tsa
              ON tsa.team_id = p.team_id
             AND tsa.site_id = p.site_id
             AND tsa.activo = 1
       WHERE p.team_id = ? AND p.cycle_week = ?
       ORDER BY p.id`,
      [teamId, cycleWeek]
    );

    if (plans.length === 0) {
      return res.json({ plans: [], day_totals: {} });
    }

    const planIds = plans.map((p) => p.plan_id);
    const [items] = await db.query(
      `SELECT i.id AS item_id, i.plan_id, i.assignment_id, i.day_of_week,
              i.entry_type, i.display_value, i.item_comment
       FROM team_site_cycle_plan_items i
       WHERE i.plan_id IN (?)
       ORDER BY i.day_of_week, i.entry_type`,
      [planIds]
    );

    const itemsByPlan = {};
    for (const item of items) {
      if (!itemsByPlan[item.plan_id]) itemsByPlan[item.plan_id] = [];
      itemsByPlan[item.plan_id].push(item);
    }

    const result = plans.map((plan) => ({
      ...plan,
      items: itemsByPlan[plan.plan_id] || [],
    }));

    const dayTotals = {};
    for (const item of items) {
      const day = item.day_of_week;
      if (!dayTotals[day]) dayTotals[day] = 0;
      dayTotals[day] += Number(item.display_value);
    }

    res.json({ plans: result, day_totals: dayTotals });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * POST /planner/item
 *
 * Creates (or upserts) a plan item for a team's planner.
 * 1. Validates team_site_assignments exists for team_id + site_id.
 * 2. display_value: if body.display_value is provided (custom), use it; otherwise
 *    calculate from the assignment (SERVICE -> horas_por_trabajador, BINS -> pago_bins).
 * 3. Upserts the team_site_cycle_plan header.
 * 4. Upserts the team_site_cycle_plan_items detail row.
 *
 * Body: { team_id, site_id, cycle_week, day_of_week, entry_type, item_comment?, display_value? }
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.createItem = async (req, res) => {
  const { team_id, site_id, cycle_week, day_of_week, entry_type, item_comment, display_value: customDisplayValue } = req.body;

  if (!team_id || !site_id || !cycle_week || !day_of_week || !entry_type) {
    return res.status(400).json({ message: 'Campos requeridos: team_id, site_id, cycle_week, day_of_week, entry_type' });
  }

  if (cycle_week < 1 || cycle_week > 4) {
    return res.status(400).json({ message: 'cycle_week debe ser entre 1 y 4' });
  }
  if (day_of_week < 1 || day_of_week > 7) {
    return res.status(400).json({ message: 'day_of_week debe ser entre 1 y 7' });
  }
  if (!['SERVICE', 'BINS', 'CUSTOM'].includes(entry_type)) {
    return res.status(400).json({ message: 'entry_type debe ser SERVICE, BINS o CUSTOM' });
  }
  if (entry_type === 'CUSTOM' && (customDisplayValue === undefined || customDisplayValue === null || customDisplayValue === '')) {
    return res.status(400).json({ message: 'display_value es requerido para entry_type CUSTOM' });
  }

  const conn = await db.getConnection();
  try {
    const access = await checkTeamAccess(req.user, team_id);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso al planner de este equipo' });
    }

    const [assignments] = await conn.query(
      `SELECT id, horas_por_trabajador, hace_bins, pago_bins
       FROM team_site_assignments
       WHERE team_id = ? AND site_id = ? AND activo = 1
       LIMIT 1`,
      [team_id, site_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'No existe asignación activa para este equipo y sitio' });
    }

    const assignment = assignments[0];
    let displayValue;

    if (customDisplayValue !== undefined && customDisplayValue !== null && customDisplayValue !== '') {
      const num = Number(customDisplayValue);
      if (Number.isNaN(num) || num < 0) {
        return res.status(400).json({ message: 'display_value (custom) debe ser un número mayor o igual a 0' });
      }
      displayValue = num;
    } else if (entry_type === 'SERVICE') {
      displayValue = assignment.horas_por_trabajador;
    } else if (entry_type === 'BINS') {
      if (!assignment.hace_bins) {
        return res.status(400).json({ message: 'Este sitio no tiene bins habilitados (hace_bins = 0)' });
      }
      displayValue = assignment.pago_bins;
    }

    await conn.beginTransaction();

    const [upsertPlan] = await conn.query(
      `INSERT INTO team_site_cycle_plan (team_id, site_id, cycle_week)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [team_id, site_id, cycle_week]
    );

    let planId;
    if (upsertPlan.insertId > 0) {
      planId = upsertPlan.insertId;
    } else {
      const [existing] = await conn.query(
        'SELECT id FROM team_site_cycle_plan WHERE team_id = ? AND site_id = ? AND cycle_week = ?',
        [team_id, site_id, cycle_week]
      );
      planId = existing[0].id;
    }

    const [upsertItem] = await conn.query(
      `INSERT INTO team_site_cycle_plan_items (plan_id, assignment_id, day_of_week, entry_type, display_value, item_comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         assignment_id = VALUES(assignment_id),
         display_value = VALUES(display_value),
         item_comment  = VALUES(item_comment),
         updated_at    = CURRENT_TIMESTAMP`,
      [planId, assignment.id, day_of_week, entry_type, displayValue, item_comment || null]
    );

    await conn.commit();

    const itemId = upsertItem.insertId > 0
      ? upsertItem.insertId
      : (await conn.query(
          'SELECT id FROM team_site_cycle_plan_items WHERE plan_id = ? AND day_of_week = ? AND entry_type = ?',
          [planId, day_of_week, entry_type]
        ))[0][0].id;

    res.status(201).json({
      message: 'Item del planner creado/actualizado',
      plan_id: planId,
      item_id: itemId,
      entry_type,
      display_value: displayValue,
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un item con ese tipo para ese día y sitio en esta semana' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * PATCH /planner/plan/:planId
 *
 * Updates the plan header (week_comment, active flag and/or color).
 *
 * Body: { week_comment?, active?, color? }
 *
 * @param {import('express').Request} req - req.params.planId.
 * @param {import('express').Response} res
 */
exports.updatePlan = async (req, res) => {
  const { planId } = req.params;
  const { week_comment, active, color } = req.body;

  try {
    const [plans] = await db.query(
      'SELECT id, team_id FROM team_site_cycle_plan WHERE id = ?',
      [planId]
    );
    if (plans.length === 0) {
      return res.status(404).json({ message: 'Plan no encontrado' });
    }

    const access = await checkTeamAccess(req.user, plans[0].team_id);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso al planner de este equipo' });
    }

    const fields = [];
    const values = [];

    if (color !== undefined) {
      const allowedColors = ['yellow', 'red', 'green', 'blue', null];
      if (!allowedColors.includes(color)) {
        return res.status(400).json({
          message: "color inválido. Valores permitidos: 'yellow', 'red', 'green', 'blue' o null",
        });
      }
      fields.push('color = ?');
      values.push(color);
    }

    if (week_comment !== undefined) {
      fields.push('week_comment = ?');
      values.push(week_comment);
    }
    if (active !== undefined) {
      fields.push('active = ?');
      values.push(active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nada que actualizar (envía week_comment, active y/o color)' });
    }

    values.push(planId);
    await db.query(`UPDATE team_site_cycle_plan SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Plan actualizado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * PATCH /planner/item/:itemId
 *
 * Updates an individual planner item (entry_type, item_comment and/or display_value).
 * - display_value: if provided, sets a custom value (overrides service/bins calculation).
 * - entry_type: if provided and different from current, recalculates display_value from
 *   team_site_assignments unless display_value was also sent (custom wins).
 *
 * Body: { entry_type?, item_comment?, display_value? }
 *
 * @param {import('express').Request} req - req.params.itemId.
 * @param {import('express').Response} res
 */
exports.updateItem = async (req, res) => {
  const { itemId } = req.params;
  const { entry_type, item_comment, display_value: customDisplayValue } = req.body;

  if (entry_type === undefined && item_comment === undefined && customDisplayValue === undefined) {
    return res.status(400).json({ message: 'Nada que actualizar (envía entry_type, item_comment y/o display_value)' });
  }

  if (entry_type !== undefined && !['SERVICE', 'BINS'].includes(entry_type)) {
    return res.status(400).json({ message: 'entry_type debe ser SERVICE o BINS' });
  }

  const conn = await db.getConnection();
  try {
    const [items] = await conn.query(
      `SELECT i.id, i.plan_id, i.entry_type, p.team_id, p.site_id
       FROM team_site_cycle_plan_items i
       JOIN team_site_cycle_plan p ON i.plan_id = p.id
       WHERE i.id = ?`,
      [itemId]
    );
    if (items.length === 0) {
      return res.status(404).json({ message: 'Item no encontrado' });
    }

    const currentItem = items[0];
    const access = await checkTeamAccess(req.user, currentItem.team_id);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso al planner de este equipo' });
    }

    const fields = [];
    const values = [];

    if (customDisplayValue !== undefined) {
      const num = Number(customDisplayValue);
      if (Number.isNaN(num) || num < 0) {
        return res.status(400).json({ message: 'display_value debe ser un número mayor o igual a 0' });
      }
      fields.push('display_value = ?');
      values.push(num);
    }

    if (entry_type !== undefined) {
      fields.push('entry_type = ?');
      values.push(entry_type);

      if (entry_type !== currentItem.entry_type && customDisplayValue === undefined) {
        const [assignments] = await conn.query(
          `SELECT id, horas_por_trabajador, hace_bins, pago_bins
           FROM team_site_assignments
           WHERE team_id = ? AND site_id = ? AND activo = 1
           LIMIT 1`,
          [currentItem.team_id, currentItem.site_id]
        );

        if (assignments.length === 0) {
          return res.status(404).json({ message: 'No existe asignación activa para este equipo y sitio' });
        }

        const assignment = assignments[0];
        let displayValue;

        if (entry_type === 'SERVICE') {
          displayValue = assignment.horas_por_trabajador;
        } else {
          if (!assignment.hace_bins) {
            return res.status(400).json({ message: 'Este sitio no tiene bins habilitados (hace_bins = 0)' });
          }
          displayValue = assignment.pago_bins;
        }

        fields.push('assignment_id = ?');
        values.push(assignment.id);
        fields.push('display_value = ?');
        values.push(displayValue);
      }
    }

    if (item_comment !== undefined) {
      fields.push('item_comment = ?');
      values.push(item_comment);
    }

    values.push(itemId);
    await conn.query(
      `UPDATE team_site_cycle_plan_items
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      values
    );

    res.json({ message: 'Item actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un item con ese tipo para ese día y sitio en esta semana' });
    }
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * DELETE /planner/item/:itemId
 *
 * Deletes a specific plan item. Also deletes the parent plan header
 * if no items remain for that plan.
 *
 * @param {import('express').Request} req - req.params.itemId.
 * @param {import('express').Response} res
 */
exports.deleteItem = async (req, res) => {
  const { itemId } = req.params;

  try {
    const [items] = await db.query(
      `SELECT i.id, i.plan_id, p.team_id
       FROM team_site_cycle_plan_items i
       JOIN team_site_cycle_plan p ON i.plan_id = p.id
       WHERE i.id = ?`,
      [itemId]
    );
    if (items.length === 0) {
      return res.status(404).json({ message: 'Item no encontrado' });
    }

    const access = await checkTeamAccess(req.user, items[0].team_id);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso al planner de este equipo' });
    }

    await db.query('DELETE FROM team_site_cycle_plan_items WHERE id = ?', [itemId]);

    const [remaining] = await db.query(
      'SELECT COUNT(*) AS cnt FROM team_site_cycle_plan_items WHERE plan_id = ?',
      [items[0].plan_id]
    );
    if (remaining[0].cnt === 0) {
      await db.query('DELETE FROM team_site_cycle_plan WHERE id = ?', [items[0].plan_id]);
    }

    res.json({ message: 'Item eliminado' });
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * GET /planner/:teamId/sites
 *
 * Returns the available sites for a team (from team_site_assignments).
 * Useful for the "Add Item" dropdown in the frontend.
 * Shows horas_por_trabajador, hace_bins, and pago_bins so the frontend
 * can preview the estimated value before saving.
 *
 * @param {import('express').Request} req - req.params.teamId.
 * @param {import('express').Response} res
 */
exports.getTeamSites = async (req, res) => {
  const { teamId } = req.params;

  try {
    const access = await checkTeamAccess(req.user, teamId);
    if (!access.allowed) {
      return res.status(403).json({ message: 'No tienes acceso a este equipo' });
    }

    const [rows] = await db.query(
      `SELECT tsa.id AS assignment_id, tsa.site_id,
              tsa.horas_por_trabajador, tsa.hace_bins, tsa.pago_bins, tsa.frecuencia,
              s.direccion_linea1, s.suburb, s.state, s.postcode,
              c.nombre AS cliente_nombre
       FROM team_site_assignments tsa
       JOIN sites s ON tsa.site_id = s.id
       LEFT JOIN clients c ON s.cliente_id = c.id
       WHERE tsa.team_id = ? AND tsa.activo = 1
       ORDER BY tsa.id`,
      [teamId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};

/**
 * GET /planner/my-team
 *
 * Returns the authenticated user's active team (team_id + team numero).
 * Intended for cleaners so the frontend can resolve which team to load
 * the planner for, but works for any authenticated role.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getMyTeam = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT uth.team_id, t.numero AS team_numero
       FROM user_team_history uth
       JOIN teams t ON uth.team_id = t.id
       WHERE uth.user_id = ? AND uth.fecha_fin IS NULL
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No tienes equipo asignado actualmente' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error del servidor', error: err.message });
  }
};
