const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/slots', authenticateToken, async (req, res) => {
  try {
    const city = String(req.query?.city || '').trim();
    const startsAt = req.query?.startsAt ? new Date(String(req.query.startsAt)) : new Date();
    const endsAt = req.query?.endsAt
      ? new Date(String(req.query.endsAt))
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const where = {
      isActive: true,
      startsAt: {
        gte: startsAt,
      },
      endsAt: {
        lte: endsAt,
      },
    };

    if (city) where.city = city;
    if (req.query?.zoneCode) where.zoneCode = String(req.query.zoneCode);

    const slots = await prisma.deliverySlot.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }],
      take: Math.min(Number(req.query?.limit || 200), 500),
    });

    const normalized = slots.map((slot) => ({
      ...slot,
      availableCapacity: Math.max(0, Number(slot.capacity || 0) - Number(slot.reservedCount || 0)),
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        slots: normalized,
      },
    });
  } catch (error) {
    console.error('Delivery slots list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list delivery slots' });
  }
});

router.post('/slots', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const city = String(req.body?.city || '').trim();
    const startsAt = new Date(String(req.body?.startsAt || ''));
    const endsAt = new Date(String(req.body?.endsAt || ''));
    const capacity = Number(req.body?.capacity || 0);

    if (!city || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || capacity < 1) {
      return res.status(400).json({
        status: 'fail',
        message: 'city, startsAt, endsAt and positive capacity are required',
      });
    }

    if (endsAt <= startsAt) {
      return res.status(400).json({
        status: 'fail',
        message: 'endsAt must be greater than startsAt',
      });
    }

    const slot = await prisma.deliverySlot.create({
      data: {
        city,
        zoneCode: req.body?.zoneCode ? String(req.body.zoneCode).trim() : null,
        startsAt,
        endsAt,
        capacity,
        reservedCount: 0,
        isActive: req.body?.isActive !== false,
      },
    });

    return res.status(201).json({ status: 'success', data: { slot } });
  } catch (error) {
    console.error('Delivery slot create error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create delivery slot' });
  }
});

router.get('/dispatch/jobs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const status = req.query?.status ? String(req.query.status) : undefined;
    const jobs = await prisma.dispatchJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query?.limit || 200), 500),
    });

    return res.status(200).json({ status: 'success', data: { jobs } });
  } catch (error) {
    console.error('Dispatch jobs list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list dispatch jobs' });
  }
});

router.post('/dispatch/jobs/:jobId/assign', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    const driverUserId = String(req.body?.driverUserId || '').trim();
    if (!jobId || !driverUserId) {
      return res.status(400).json({
        status: 'fail',
        message: 'jobId and driverUserId are required',
      });
    }

    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
      select: { id: true },
    });
    if (!driverProfile) {
      return res.status(404).json({ status: 'fail', message: 'Driver profile not found' });
    }

    const assigned = await prisma.dispatchJob.update({
      where: { id: jobId },
      data: {
        assignedDriverId: driverProfile.id,
        status: 'assigned',
        assignedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({ status: 'success', data: { job: assigned } });
  } catch (error) {
    console.error('Dispatch assignment error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to assign dispatch job' });
  }
});

router.get('/route-zones', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (req.query?.city) where.city = String(req.query.city);
    if (req.query?.isActive !== undefined) where.isActive = String(req.query.isActive) === 'true';

    const zones = await prisma.routeZone.findMany({
      where,
      orderBy: [{ city: 'asc' }, { code: 'asc' }],
      take: Math.min(Number(req.query?.limit || 200), 500),
    });
    return res.status(200).json({ status: 'success', data: { zones } });
  } catch (error) {
    console.error('Route zones list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list route zones' });
  }
});

router.post('/route-zones', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const city = String(req.body?.city || '').trim();
    const code = String(req.body?.code || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!city || !code || !name) {
      return res.status(400).json({
        status: 'fail',
        message: 'city, code, and name are required',
      });
    }

    const zone = await prisma.routeZone.upsert({
      where: {
        city_code: {
          city,
          code,
        },
      },
      update: {
        name,
        polygon: req.body?.polygon || null,
        isActive: req.body?.isActive !== false,
      },
      create: {
        city,
        code,
        name,
        polygon: req.body?.polygon || null,
        isActive: req.body?.isActive !== false,
      },
    });

    return res.status(201).json({ status: 'success', data: { zone } });
  } catch (error) {
    console.error('Create route zone error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create route zone' });
  }
});

router.get('/driver-shifts', authenticateToken, authorizeRole(['admin', 'driver']), async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'driver') where.driverUserId = req.user.id;
    if (req.query?.city) where.city = String(req.query.city);
    if (req.query?.driverUserId && req.user.role === 'admin') where.driverUserId = String(req.query.driverUserId);
    if (req.query?.status) where.status = String(req.query.status);

    const shifts = await prisma.driverShift.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }],
      take: Math.min(Number(req.query?.limit || 200), 500),
    });
    return res.status(200).json({ status: 'success', data: { shifts } });
  } catch (error) {
    console.error('Driver shifts list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list driver shifts' });
  }
});

router.post('/driver-shifts', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const driverUserId = String(req.body?.driverUserId || '').trim();
    const city = String(req.body?.city || '').trim();
    const startsAt = new Date(String(req.body?.startsAt || ''));
    const endsAt = new Date(String(req.body?.endsAt || ''));

    if (!driverUserId || !city || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return res.status(400).json({
        status: 'fail',
        message: 'driverUserId, city, startsAt and endsAt are required',
      });
    }
    if (endsAt <= startsAt) {
      return res.status(400).json({
        status: 'fail',
        message: 'endsAt must be greater than startsAt',
      });
    }

    const shift = await prisma.driverShift.create({
      data: {
        driverUserId,
        city,
        zoneCode: req.body?.zoneCode ? String(req.body.zoneCode).trim() : null,
        startsAt,
        endsAt,
        status: String(req.body?.status || 'scheduled').trim(),
      },
    });

    return res.status(201).json({ status: 'success', data: { shift } });
  } catch (error) {
    console.error('Driver shift create error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create driver shift' });
  }
});

module.exports = router;
