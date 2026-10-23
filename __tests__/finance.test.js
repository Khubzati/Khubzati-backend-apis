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
    admin = await prisma.user.create({
      data: {
        username: `finance_admin_${Date.now()}`,
        email: `finance_admin_${Date.now()}@example.com`,
        password: 'x',
        fullName: 'Finance Test Admin',
        phoneNumber: `+96276${Math.floor(1000000 + Math.random() * 899999)}`,
        role: 'admin',
        isVerified: true,
      },
    });
    created.users.push(admin.id);
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
    await prisma.vendorLedgerEntry.deleteMany({ where: { vendorId: { in: created.bakeries } } });
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

  test.each([
    ['/v1/finance/refunds', 200],
    ['/v1/finance/disputes', 200],
    ['/v1/finance/payouts', 403],
    ['/v1/finance/commission-config', 403],
  ])('protects and scopes direct finance route %s', async (route, nonAdminStatus) => {
    expect((await request(app).get(route)).status).toBe(401);

    const nonAdmin = await request(app)
      .get(route)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(nonAdmin.status).toBe(nonAdminStatus);

    const expired = jwt.sign(
      { id: admin.id, role: 'admin' },
      JWT_SECRET,
      { expiresIn: -1 },
    );
    expect(
      (
        await request(app)
          .get(route)
          .set('Authorization', `Bearer ${expired}`)
      ).status,
    ).toBe(401);

    const valid = await request(app)
      .get(`${route}?page=1&limit=1`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(valid.status).toBe(200);
  });

  test('rejects invalid finance mutations without creating false success state', async () => {
    const missingRefund = await request(app)
      .post('/v1/finance/refunds/00000000-0000-0000-0000-000000000000/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect([404, 409]).toContain(missingRefund.status);

    const invalidCommission = await request(app)
      .put('/v1/finance/commission-config/global')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rateBps: 10001 });
    expect(invalidCommission.status).toBe(400);
  });

  test('serializes payout balance reservations and supports idempotent retry', async () => {
    const isolated = await createIsolatedVendorOrder();
    const token = makeToken(isolated.owner);
    await request(app).post(`/v1/finance/orders/${isolated.order.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`).send({});

    const concurrent = await Promise.all([
      request(app).post('/v1/finance/payouts/request')
        .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'over-a').send({ amount: 12 }),
      request(app).post('/v1/finance/payouts/request')
        .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'over-b').send({ amount: 12 }),
    ]);
    expect(concurrent.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === 400)).toHaveLength(1);

    const key = `retry-${Date.now()}`;
    const first = await request(app).post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send({ amount: 2 });
    const replay = await request(app).post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send({ amount: 2 });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.payout.id).toBe(first.body.data.payout.id);
  });

  test('allows valid concurrent payouts and isolates different vendors', async () => {
    const firstVendor = await createIsolatedVendorOrder();
    const secondVendor = await createIsolatedVendorOrder();
    await Promise.all([firstVendor, secondVendor].map(({ order }) =>
      request(app).post(`/v1/finance/orders/${order.id}/snapshot`)
        .set('Authorization', `Bearer ${adminToken}`).send({})));
    const sameVendorToken = makeToken(firstVendor.owner);
    const valid = await Promise.all(['valid-a', 'valid-b'].map((key) =>
      request(app).post('/v1/finance/payouts/request')
        .set('Authorization', `Bearer ${sameVendorToken}`)
        .set('Idempotency-Key', `${key}-${Date.now()}`).send({ amount: 5 })));
    expect(valid.every(({ status }) => status === 201)).toBe(true);
    const isolated = await Promise.all([firstVendor, secondVendor].map(({ owner }, index) =>
      request(app).post('/v1/finance/payouts/request')
        .set('Authorization', `Bearer ${makeToken(owner)}`)
        .set('Idempotency-Key', `isolated-${index}-${Date.now()}`).send({ amount: 2 })));
    expect(isolated.every(({ status }) => status === 201)).toBe(true);
  });

  test('mark-paid is idempotent under sequential and concurrent replay', async () => {
    const isolated = await createIsolatedVendorOrder();
    const token = makeToken(isolated.owner);
    await request(app).post(`/v1/finance/orders/${isolated.order.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`).send({});
    const createdPayout = await request(app).post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `paid-${Date.now()}`).send({ amount: 5 });
    const payoutId = createdPayout.body.data.payout.id;
    const results = await Promise.all([
      request(app).post(`/v1/finance/payouts/${payoutId}/mark-paid`).set('Authorization', `Bearer ${adminToken}`).send({}),
      request(app).post(`/v1/finance/payouts/${payoutId}/mark-paid`).set('Authorization', `Bearer ${adminToken}`).send({}),
    ]);
    expect(results.every(({ status }) => status === 200)).toBe(true);
    expect((await request(app).post(`/v1/finance/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`).send({})).status).toBe(200);
    await expect(prisma.financialTransaction.count({
      where: { sideEffectKey: `payout-status:${payoutId}:paid` },
    })).resolves.toBe(1);
    await expect(prisma.vendorLedgerEntry.count({
      where: { sideEffectKey: `payout-status:${payoutId}:paid` },
    })).resolves.toBe(1);
  });

  test('mark-paid rejects an invalid transition from rejected', async () => {
    const isolated = await createIsolatedVendorOrder();
    const token = makeToken(isolated.owner);
    await request(app).post(`/v1/finance/orders/${isolated.order.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`).send({});
    const createdPayout = await request(app).post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `reject-${Date.now()}`).send({ amount: 2 });
    const payoutId = createdPayout.body.data.payout.id;
    expect((await request(app).post(`/v1/finance/payouts/${payoutId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`).send({})).status).toBe(200);
    expect((await request(app).post(`/v1/finance/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`).send({})).status).toBe(409);
  });

  test('serializes refundable balance, supports exact remainder and releases rejection', async () => {
    const isolated = await createIsolatedVendorOrder();
    const [first, second] = await Promise.all([
      request(app).post('/v1/finance/refunds').set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', `refund-a-${Date.now()}`).send({ orderId: isolated.order.id, amount: 12, reason: 'a' }),
      request(app).post('/v1/finance/refunds').set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', `refund-b-${Date.now()}`).send({ orderId: isolated.order.id, amount: 12, reason: 'b' }),
    ]);
    expect([first.status, second.status].filter((status) => status === 201)).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === 400)).toHaveLength(1);
    const accepted = first.status === 201 ? first : second;
    const exact = await request(app).post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`).set('Idempotency-Key', `refund-exact-${Date.now()}`)
      .send({ orderId: isolated.order.id, amount: 8, reason: 'exact remainder' });
    expect(exact.status).toBe(201);
    const replayKey = `refund-replay-${Date.now()}`;
    const replayOrder = await createIsolatedVendorOrder();
    const replayFirst = await request(app).post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`).set('Idempotency-Key', replayKey)
      .send({ orderId: replayOrder.order.id, amount: 4, reason: 'retry' });
    const replaySecond = await request(app).post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`).set('Idempotency-Key', replayKey)
      .send({ orderId: replayOrder.order.id, amount: 4, reason: 'retry' });
    expect(replaySecond.body.data.refund.id).toBe(replayFirst.body.data.refund.id);
    await request(app).post(`/v1/finance/refunds/${accepted.body.data.refund.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'released' });
    const released = await request(app).post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${customerToken}`).set('Idempotency-Key', `released-${Date.now()}`)
      .send({ orderId: isolated.order.id, amount: 12, reason: 'released capacity' });
    expect(released.status).toBe(201);
  });

  test('vendor cannot self-verify payout account; admin transition is audited', async () => {
    const createdAccount = await request(app).post('/v1/finance/payout-accounts')
      .set('Authorization', `Bearer ${bakeryToken}`).send({
        accountHolderName: 'Launch Test', iban: 'JO00TEST', isVerified: true,
      });
    expect(createdAccount.status).toBe(201);
    expect(createdAccount.body.data.account.isVerified).toBe(false);
    const accountId = createdAccount.body.data.account.id;
    expect((await request(app).post(`/v1/finance/payout-accounts/${accountId}/verification`)
      .set('Authorization', `Bearer ${bakeryToken}`).send({ isVerified: true })).status).toBe(403);
    const verified = await request(app).post(`/v1/finance/payout-accounts/${accountId}/verification`)
      .set('Authorization', `Bearer ${adminToken}`).send({ isVerified: true });
    expect(verified.status).toBe(200);
    expect(verified.body.data.account.isVerified).toBe(true);
    await expect(prisma.auditLog.count({
      where: { entityType: 'payout_account', entityId: accountId, action: 'finance.payout_account.verified' },
    })).resolves.toBe(1);
    await prisma.payoutAccount.delete({ where: { id: accountId } });
  });
});
