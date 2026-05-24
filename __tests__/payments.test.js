process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';

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
    constructEvent: jest.fn(() => ({
      id: `evt_test_default_${Date.now()}_${Math.round(Math.random() * 100000)}`,
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { orderId: 'test-order-id' }, last_payment_error: null } },
    })),
  };
  return function Stripe() {
    return { checkout, webhooks };
  };
});

const createdOrders = [];
const createdUsers = [];
const createdProducts = [];

async function seedOrder() {
  const user = await prisma.user.create({
    data: {
      username: `u_${Date.now()}`,
      email: `u_${Date.now()}@test.com`,
      password: 'x',
      fullName: 'Test User',
      phoneNumber: `+96279${Math.floor(1000000 + Math.random() * 899999)}`,
      role: 'customer',
    },
  });

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      orderNumber: `KHB-${Date.now()}`,
      status: 'pending',
      orderType: 'pickup',
      totalAmount: 10,
      paymentMethod: 'credit_card',
      paymentStatus: 'pending',
      bakeryId: null,
      restaurantId: null,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: `Product ${Date.now()}`,
      price: 10,
      itemType: 'bakery',
      stockQuantity: 20,
      isAvailable: true,
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      quantity: 1,
      price: 10,
      subtotal: 10,
    },
  });

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'dev-temp-secret-change-me');
  createdUsers.push(user.id);
  createdOrders.push(order.id);
  createdProducts.push(product.id);
  return { user, order, token };
}

describe('Payments', () => {
  afterAll(async () => {
    await prisma.review.deleteMany({ where: { userId: { in: createdUsers } } });
    await prisma.notification.deleteMany({ where: { userId: { in: createdUsers } } });
    await prisma.webhookEvent.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.financialTransaction.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.orderFinancialRecord.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.refundRequest.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.disputeCase.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProducts } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  });

  test('initiates payment intent', async () => {
    const { order, token } = await seedOrder();
    const res = await request(app)
      .post('/v1/payments/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId: order.id, currency: 'usd' });

    expect(res.status).toBe(200);
    expect(res.body?.data?.paymentIntentId).toBe('pi_test');
    expect(res.body?.data?.checkoutUrl).toBe('https://checkout.stripe.test/session/cs_test');
  });

  test('webhook marks order paid', async () => {
    const { order } = await seedOrder();
    // mock constructEvent to return this order
    const stripe = require('stripe')();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: `evt_test_paid_${order.id}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_paid', metadata: { orderId: order.id }, last_payment_error: null } },
    });

    const payload = JSON.stringify({ dummy: true });
    const res = await request(app)
      .post('/v1/payments/webhook')
      .set('stripe-signature', 'sig')
      .send(payload);

    expect(res.status).toBe(200);
    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated.paymentStatus).toBe('paid');
  });
});
