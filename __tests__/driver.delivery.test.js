process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Driver delivery state machine', () => {
  let driverToken;
  const orderId = 'test-order-id';

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    const driver = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });
    driverToken = jwt.sign({ id: driver.id, role: 'driver' }, JWT_SECRET, { expiresIn: '1h' });

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'ready_for_pickup', orderType: 'delivery' },
    });

    await prisma.deliveryAssignment.deleteMany({ where: { orderId } });
  });

  afterAll(async () => {
  });

  test('accepts, transitions and delivers with proof', async () => {
    const accept = await request(app)
      .post(`/v1/driver/assignments/${orderId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(accept.status).toBe(200);
    expect(accept.body?.data?.assignment?.status).toBe('accepted');

    const pickedUp = await request(app)
      .post(`/v1/driver/assignments/${orderId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'picked_up' });
    expect(pickedUp.status).toBe(200);

    const onTheWay = await request(app)
      .post(`/v1/driver/assignments/${orderId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'on_the_way' });
    expect(onTheWay.status).toBe(200);

    const delivered = await request(app)
      .post(`/v1/driver/assignments/${orderId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        status: 'delivered',
        deliveryNote: 'Delivered to customer door',
        proofImageUrl: '/uploads/proof-delivery-test.jpg',
      });
    expect(delivered.status).toBe(200);

    const assignment = await prisma.deliveryAssignment.findUnique({ where: { orderId } });
    expect(assignment.status).toBe('delivered');
    expect(assignment.proofImageUrl).toBe('/uploads/proof-delivery-test.jpg');
  });

  test('blocks invalid backward transition', async () => {
    const invalid = await request(app)
      .post(`/v1/driver/assignments/${orderId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'picked_up' });

    expect(invalid.status).toBe(409);
  });
});
