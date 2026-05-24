process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

jest.mock('stripe', () => {
  const checkout = {
    sessions: {
      create: jest.fn(async () => ({
        id: 'cs_test',
        url: 'https://checkout.stripe.test/session/cs_test',
        payment_intent: 'pi_test',
      })),
    },
  };
  const webhooks = {
    constructEvent: jest.fn(),
  };
  const refunds = {
    create: jest.fn(async () => ({ id: 're_test_1', status: 'succeeded' })),
  };
  return function Stripe() {
    return { checkout, webhooks, refunds };
  };
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('QA reliability and edge-case scenarios', () => {
  let customer;
  let admin;
  let bakeryOwner;
  let driver1;
  let driver2;
  let customerToken;
  let adminToken;
  let bakeryToken;
  let driver1Token;
  let driver2Token;
  const createdOrderIds = [];
  const createdProductIds = [];
  const createdDriverProfileIds = [];

  const createOrder = async ({ paymentMethod = 'credit_card', totalAmount = 10, orderType = 'delivery' }) => {
    const bakery = await prisma.bakery.findUnique({ where: { id: 'test-bakery-id' } });
    const address = await prisma.address.findUnique({ where: { id: 'test-address-id' } });

    const product = await prisma.product.create({
      data: {
        name: `QA Product ${Date.now()}-${Math.random()}`,
        price: totalAmount,
        itemType: 'bakery',
        bakeryId: bakery.id,
        stockQuantity: 100,
        isAvailable: true,
      },
    });
    createdProductIds.push(product.id);

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        bakeryId: bakery.id,
        orderNumber: `QA-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        status: orderType === 'delivery' ? 'ready_for_pickup' : 'pending',
        orderType,
        deliveryAddressId: address.id,
        totalAmount,
        paymentMethod,
        paymentStatus: 'pending',
      },
    });
    createdOrderIds.push(order.id);

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        price: totalAmount,
        subtotal: totalAmount,
      },
    });

    return order;
  };

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });
    driver1 = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });

    driver2 = await prisma.user.upsert({
      where: { email: 'driver2@example.com' },
      update: { role: 'driver', deletedAt: null },
      create: {
        username: `driver2_${Date.now()}`,
        email: 'driver2@example.com',
        password: 'x',
        fullName: 'Driver 2',
        phoneNumber: `+96278${Math.floor(1000000 + Math.random() * 899999)}`,
        role: 'driver',
        isVerified: true,
      },
    });

    const driver1Profile = await prisma.driverProfile.upsert({
      where: { userId: driver1.id },
      update: { status: 'online' },
      create: { userId: driver1.id, status: 'online' },
    });
    const driver2Profile = await prisma.driverProfile.upsert({
      where: { userId: driver2.id },
      update: { status: 'online' },
      create: { userId: driver2.id, status: 'online' },
    });
    createdDriverProfileIds.push(driver1Profile.id, driver2Profile.id);

    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
    adminToken = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
    bakeryToken = jwt.sign({ id: bakeryOwner.id, role: bakeryOwner.role }, JWT_SECRET, { expiresIn: '1h' });
    driver1Token = jwt.sign({ id: driver1.id, role: driver1.role }, JWT_SECRET, { expiresIn: '1h' });
    driver2Token = jwt.sign({ id: driver2.id, role: driver2.role }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await prisma.notificationJob.deleteMany({});
    await prisma.financialTransaction.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.refundRequest.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.disputeMessage.deleteMany({ where: { dispute: { orderId: { in: createdOrderIds } } } });
    await prisma.disputeCase.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderFinancialRecord.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.webhookEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  });

  test('expired auth token is rejected on protected endpoint', async () => {
    const expiredToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: -1 });
    const res = await request(app)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('duplicate webhook event is idempotent', async () => {
    const order = await createOrder({ paymentMethod: 'credit_card', totalAmount: 12 });
    const stripe = require('stripe')();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: `evt_dup_${order.id}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: `pi_${order.id}`, metadata: { orderId: order.id }, last_payment_error: null } },
    });

    const payload = JSON.stringify({ qa: true });

    const first = await request(app)
      .post('/v1/payments/webhook')
      .set('stripe-signature', 'sig')
      .send(payload);
    const second = await request(app)
      .post('/v1/payments/webhook')
      .set('stripe-signature', 'sig')
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body?.data?.duplicate).toBe(true);
  });

  test('prevents cumulative over-refund requests', async () => {
    const order = await createOrder({ paymentMethod: 'credit_card', totalAmount: 8 });

    const first = await request(app)
      .post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order.id, amount: 6, reason: 'first refund slice' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: order.id, amount: 3, reason: 'should exceed total' });
    expect(second.status).toBe(400);
    expect(second.body?.message).toMatch(/remaining refundable/i);
  });

  test('blocks payout request that exceeds available balance', async () => {
    const payout = await request(app)
      .post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({ amount: 999999, reason: 'abuse test' });

    expect(payout.status).toBe(400);
    expect(payout.body?.message).toMatch(/exceeds available balance/i);
  });

  test('concurrent driver accept attempts resolve without double assignment', async () => {
    const order = await createOrder({ paymentMethod: 'cash_on_delivery', totalAmount: 5, orderType: 'delivery' });

    const [driver1Res, driver2Res] = await Promise.all([
      request(app)
        .post(`/v1/driver/assignments/${order.id}/accept`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({}),
      request(app)
        .post(`/v1/driver/assignments/${order.id}/accept`)
        .set('Authorization', `Bearer ${driver2Token}`)
        .send({}),
    ]);

    const statuses = [driver1Res.status, driver2Res.status].sort();
    expect(statuses).toEqual([200, 409]);

    const assignments = await prisma.deliveryAssignment.findMany({ where: { orderId: order.id } });
    expect(assignments.length).toBe(1);
  });
});
