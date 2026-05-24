process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const makeToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

describe('Finance flows', () => {
  let customer;
  let admin;
  let bakeryOwner;
  let customerToken;
  let adminToken;
  let bakeryToken;
  let testOrder;
  let testBakery;
  const created = {
    users: [],
    bakeries: [],
    products: [],
    orders: [],
    orderItems: [],
  };

  const createIsolatedVendorOrder = async () => {
    const owner = await prisma.user.create({
      data: {
        username: `isolated_owner_${Date.now()}`,
        email: `isolated_owner_${Date.now()}@example.com`,
        password: 'x',
        fullName: 'Isolated Owner',
        phoneNumber: `+96277${Math.floor(1000000 + Math.random() * 899999)}`,
        role: 'bakery_owner',
        isVerified: true,
      },
    });
    created.users.push(owner.id);

    const bakery = await prisma.bakery.create({
      data: {
        name: `Isolated Bakery ${Date.now()}`,
        description: 'Isolated finance test bakery',
        addressLine1: 'Finance Test Street',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: `+96277${Math.floor(1000000 + Math.random() * 899999)}`,
        email: `bakery_${Date.now()}@example.com`,
        status: 'approved',
        ownerId: owner.id,
      },
    });
    created.bakeries.push(bakery.id);

    const product = await prisma.product.create({
      data: {
        name: `Finance Test Product ${Date.now()}`,
        price: 20,
        itemType: 'bakery',
        bakeryId: bakery.id,
        stockQuantity: 20,
        isAvailable: true,
      },
    });
    created.products.push(product.id);

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        bakeryId: bakery.id,
        orderNumber: `FIN-${Date.now()}`,
        status: 'confirmed',
        orderType: 'delivery',
        deliveryAddressId: 'test-address-id',
        totalAmount: 20,
        paymentMethod: 'cash_on_delivery',
        paymentStatus: 'paid',
        paymentProvider: 'cod',
        providerPaymentId: null,
        currency: 'JOD',
      },
    });
    created.orders.push(order.id);

    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        price: 20,
        subtotal: 20,
      },
    });
    created.orderItems.push(orderItem.id);

    return { owner, bakery, order };
  };

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    const isolated = await createIsolatedVendorOrder();
    bakeryOwner = isolated.owner;
    testBakery = isolated.bakery;
    testOrder = isolated.order;

    customerToken = makeToken(customer);
    adminToken = makeToken(admin);
    bakeryToken = makeToken(bakeryOwner);
  });

  afterAll(async () => {
    await prisma.notificationJob.deleteMany({});
    await prisma.financialTransaction.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.financialTransaction.deleteMany({
      where: {
        payoutRequest: {
          is: {
            OR: [
              { requesterUserId: { in: created.users } },
              { vendorId: { in: created.bakeries } },
            ],
          },
        },
      },
    });
    await prisma.refundRequest.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.disputeMessage.deleteMany({ where: { dispute: { orderId: { in: created.orders } } } });
    await prisma.disputeCase.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.orderFinancialRecord.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.webhookEvent.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.payoutRequest.deleteMany({
      where: {
        OR: [
          { requesterUserId: { in: created.users } },
          { vendorId: { in: created.bakeries } },
        ],
      },
    });
    await prisma.orderItem.deleteMany({ where: { id: { in: created.orderItems } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.product.deleteMany({ where: { id: { in: created.products } } });
    await prisma.bakery.deleteMany({ where: { id: { in: created.bakeries } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  });

  test('admin configures commission and snapshots order financial record', async () => {
    const setGlobal = await request(app)
      .put('/v1/finance/commission-config/global')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rateBps: 1200, notes: 'Pilot default' });

    expect(setGlobal.status).toBe(200);
    expect(setGlobal.body?.data?.config?.rateBps).toBe(1200);

    const snapshot = await request(app)
      .post(`/v1/finance/orders/${testOrder.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(snapshot.status).toBe(200);
    expect(snapshot.body?.data?.record?.orderId).toBe(testOrder.id);
    expect(snapshot.body?.data?.record?.commissionRateBps).toBe(1200);
  });

  test('customer requests refund, admin approves and processes it', async () => {
    const create = await request(app)
      .post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId: testOrder.id,
        amount: 1.5,
        reason: 'Quality issue',
      });

    expect(create.status).toBe(201);
    const refundId = create.body?.data?.refund?.id;
    expect(refundId).toBeTruthy();

    const approve = await request(app)
      .post(`/v1/finance/refunds/${refundId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ adminNotes: 'Approved for pilot policy' });

    expect(approve.status).toBe(200);
    expect(approve.body?.data?.refund?.status).toBe('approved');

    const processRefund = await request(app)
      .post(`/v1/finance/refunds/${refundId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(processRefund.status).toBe(200);
    expect(['completed', 'processing']).toContain(processRefund.body?.data?.refund?.status);
  });

  test('customer opens dispute, vendor responds, admin resolves', async () => {
    const createDispute = await request(app)
      .post('/v1/finance/disputes')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId: testOrder.id,
        subject: 'Delivery timing dispute',
        description: 'Order was delayed significantly.',
      });

    expect(createDispute.status).toBe(201);
    const disputeId = createDispute.body?.data?.dispute?.id;

    const vendorMessage = await request(app)
      .post(`/v1/finance/disputes/${disputeId}/messages`)
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({
        message: 'We are reviewing this with our kitchen team.',
      });

    expect(vendorMessage.status).toBe(201);

    const resolve = await request(app)
      .post(`/v1/finance/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'resolved',
        resolutionNote: 'Customer compensated via partial refund.',
      });

    expect(resolve.status).toBe(200);
    expect(resolve.body?.data?.dispute?.status).toBe('resolved');
  });

  test('vendor requests payout and admin marks paid', async () => {
    await request(app)
      .post(`/v1/finance/orders/${testOrder.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const requestPayout = await request(app)
      .post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({
        amount: 5,
        reason: 'Weekly settlement',
      });

    expect(requestPayout.status).toBe(201);
    const payoutId = requestPayout.body?.data?.payout?.id;

    const approve = await request(app)
      .post(`/v1/finance/payouts/${payoutId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(approve.status).toBe(200);

    const markPaid = await request(app)
      .post(`/v1/finance/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ transactionRef: 'BANK-TX-123' });

    expect(markPaid.status).toBe(200);
    expect(markPaid.body?.data?.payout?.status).toBe('paid');
  });

  test('rbac blocks customer from admin finance actions', async () => {
    const res = await request(app)
      .put('/v1/finance/commission-config/global')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rateBps: 900 });

    expect(res.status).toBe(403);
  });
});
