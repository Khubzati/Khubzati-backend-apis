const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateTokenOptional, authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();
const isContractsInfraMissingError = (error) => {
  if (!error || typeof error !== 'object') return false;
  if (error.code === 'P2021' || error.code === 'P2022') return true;
  const text = String(error.message || '').toLowerCase();
  return text.includes('api_contract_versions') || text.includes('client_error_events');
};

router.get('/versions', async (_req, res) => {
  try {
    const versions = await prisma.apiContractVersion.findMany({
      where: { isActive: true },
      orderBy: [{ clientName: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return res.status(200).json({
      status: 'success',
      data: { versions },
    });
  } catch (error) {
    if (isContractsInfraMissingError(error)) {
      return res.status(200).json({
        status: 'success',
        data: { versions: [] },
      });
    }
    console.error('List API contract versions error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list API contract versions' });
  }
});

router.post('/versions', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const clientName = String(req.body?.clientName || '').trim();
    const version = String(req.body?.version || '').trim();
    if (!clientName || !version) {
      return res.status(400).json({
        status: 'fail',
        message: 'clientName and version are required',
      });
    }

    const created = await prisma.apiContractVersion.create({
      data: {
        clientName,
        version,
        minVersion: String(req.body?.minVersion || '').trim() || null,
        isActive: req.body?.isActive !== false,
        metadata: req.body?.metadata || null,
      },
    });

    return res.status(201).json({ status: 'success', data: { contractVersion: created } });
  } catch (error) {
    console.error('Create API contract version error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create API contract version' });
  }
});

router.post('/client-errors', authenticateTokenOptional, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim();
    const errorMessage = String(req.body?.errorMessage || '').trim();
    if (!endpoint || !errorMessage) {
      return res.status(400).json({
        status: 'fail',
        message: 'endpoint and errorMessage are required',
      });
    }

    const event = await prisma.clientErrorEvent.create({
      data: {
        clientName: String(req.body?.clientName || '').trim() || null,
        appVersion: String(req.body?.appVersion || '').trim() || null,
        endpoint,
        httpStatus: req.body?.httpStatus ? Number(req.body.httpStatus) : null,
        errorCode: String(req.body?.errorCode || '').trim() || null,
        errorMessage,
        payloadSummary: String(req.body?.payloadSummary || '').trim() || null,
        userId: req.user?.id || null,
        requestId: req.requestId || null,
        metadata: req.body?.metadata || null,
      },
    });

    return res.status(201).json({ status: 'success', data: { eventId: event.id } });
  } catch (error) {
    console.error('Create client error event error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to store client error event' });
  }
});

module.exports = router;
