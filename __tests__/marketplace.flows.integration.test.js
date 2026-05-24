process.env.NODE_ENV = 'test';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const asToken = (user) => jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '2h' });

const created = {
  users: [],
  addresses: [],
  bakeries: [],
  products: [],
  orders: [],
  orderItems: [],
  slots: [],
  zones: [],
  shifts: [],
  payoutAccounts: [],
  payouts: [],
  refunds: [],
  disputes: [],
  dispatchJobs: [],
};

const markCreated = (bucket, id) => {
  if (id) created[bucket].push(id);
};

const registerAndVerify = async ({ role, fullNamePrefix }) => {
  const email = `${unique(role)}@example.com`;
  const username = unique(role);
  const phoneNumber = `96279${Math.floor(1000000 + Math.random() * 8999999)}`;
  const password = 'Password@123';

  const registerRes = await request(app)
    .post('/v1/auth/register')
    .send({
      role,
      username,
      email,
      password,
      fullName: `${fullNamePrefix} ${role}`,
      phoneNumber,
    });

  expect([200, 201]).toContain(registerRes.status);
  const otp = registerRes.body?.data?.otp;
  expect(otp).toBeTruthy();

  const verifyRes = await request(app)
    .post('/v1/auth/verify-otp')
    .send({
      email,
      otp,
      purpose: 'registration',
    });

  expect(verifyRes.status).toBe(200);
  const token =
    verifyRes.body?.data?.token ||
    verifyRes.body?.token ||
    verifyRes.body?.data?.accessToken ||
    null;
  expect(token).toBeTruthy();

  const meRes = await request(app)
    .get('/v1/user/me')
    .set('Authorization', `Bearer ${token}`);
  expect(meRes.status).toBe(200);

  const userId = meRes.body?.data?.user?.id;
  expect(userId).toBeTruthy();
  markCreated('users', userId);

  return {
    token,
    userId,
    email,
    username,
    phoneNumber,
    password,
  };
};

describe('Marketplace end-to-end integration flows', () => {
  let admin;
  let adminToken;
  let seededCustomer;
  let seededCustomerToken;
  let seededDriver;

  let onboardingUser;
  let bakeryOwner;
  let secondDriver;

  let bakery;
  let product;
  let orderForSchedule;
  let orderForCancel;
  let orderForDriverSuccess;
  let orderForDriverFailure;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    seededCustomer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    seededDriver = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });

    adminToken = asToken(admin);
    seededCustomerToken = asToken(seededCustomer);
  });

  afterAll(async () => {
    await prisma.slaAlertDeliveryAttempt.deleteMany({ where: { delivery: { eventType: { contains: 'test' } } } }).catch(() => null);
    await prisma.slaAlertDelivery.deleteMany({ where: { eventType: { contains: 'test' } } }).catch(() => null);
    await prisma.slaAlertDeadLetter.deleteMany({ where: { eventType: { contains: 'test' } } }).catch(() => null);

    await prisma.notificationJob.deleteMany({ where: { payload: { path: ['e2eFlow'], equals: true } } }).catch(() => null);

    await prisma.disputeMessage.deleteMany({ where: { disputeId: { in: created.disputes } } }).catch(() => null);
    await prisma.disputeCase.deleteMany({ where: { id: { in: created.disputes } } }).catch(() => null);
    await prisma.refundRequest.deleteMany({ where: { id: { in: created.refunds } } }).catch(() => null);

    await prisma.financialTransaction.deleteMany({ where: { payoutRequestId: { in: created.payouts } } }).catch(() => null);
    await prisma.financialTransaction.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.vendorLedgerEntry.deleteMany({ where: { payoutRequestId: { in: created.payouts } } }).catch(() => null);

    await prisma.payoutAccount.deleteMany({ where: { id: { in: created.payoutAccounts } } }).catch(() => null);
    await prisma.payoutRequest.deleteMany({ where: { id: { in: created.payouts } } }).catch(() => null);

    await prisma.orderCancellationReason.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.inventoryMovement.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.dispatchJob.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);

    await prisma.orderIdempotencyKey.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } }).catch(() => null);

    await prisma.product.deleteMany({ where: { id: { in: created.products } } }).catch(() => null);
    await prisma.deliverySlot.deleteMany({ where: { id: { in: created.slots } } }).catch(() => null);
    await prisma.driverShift.deleteMany({ where: { id: { in: created.shifts } } }).catch(() => null);
    await prisma.routeZone.deleteMany({ where: { id: { in: created.zones } } }).catch(() => null);
    await prisma.bakery.deleteMany({ where: { id: { in: created.bakeries } } }).catch(() => null);

    await prisma.address.deleteMany({ where: { id: { in: created.addresses } } }).catch(() => null);
    await prisma.driverProfile.deleteMany({ where: { userId: { in: created.users } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => null);
  });

  test('1) Customer onboarding flow', async () => {
    onboardingUser = await registerAndVerify({ role: 'customer', fullNamePrefix: 'E2E Customer' });

    const profileUpdate = await request(app)
      .put('/v1/user/me')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        fullName: 'E2E Customer Updated',
      });
    expect(profileUpdate.status).toBe(200);

    const createAddress = await request(app)
      .post('/v1/user/me/addresses')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        addressLine1: 'QA Street 1',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        addressType: 'home',
        isDefault: true,
      });

    expect(createAddress.status).toBe(201);
    const addressId = createAddress.body?.data?.address?.id;
    expect(addressId).toBeTruthy();
    markCreated('addresses', addressId);

    const updateAddress = await request(app)
      .put(`/v1/user/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({ city: 'Zarqa', addressType: 'work' });

    expect(updateAddress.status).toBe(200);
    expect(updateAddress.body?.data?.address?.city).toBe('Zarqa');

    const takeoverAttempt = await request(app)
      .put(`/v1/user/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${seededCustomerToken}`)
      .send({ city: 'Hijack City' });

    expect(takeoverAttempt.status).toBe(404);

    const sampleFile = path.join(process.cwd(), 'uploads', 'sample.txt');
    expect(fs.existsSync(sampleFile)).toBe(true);

    const uploadRes = await request(app)
      .post('/v1/upload/document')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .field('ownerType', 'user')
      .field('ownerId', onboardingUser.userId)
      .attach('file', sampleFile);

    expect(uploadRes.status).toBe(200);
    const uploadedUrl = uploadRes.body?.data?.fileUrl;
    expect(uploadedUrl).toMatch(/^\/uploads\//);

    const updateProfileImage = await request(app)
      .put('/v1/user/me')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({ profilePictureUrl: uploadedUrl });

    expect(updateProfileImage.status).toBe(200);
    expect(updateProfileImage.body?.data?.user?.profilePictureUrl).toBe(uploadedUrl);
  });

  test('2) Vendor/bakery setup flow', async () => {
    bakeryOwner = await registerAndVerify({ role: 'bakery_owner', fullNamePrefix: 'E2E Bakery Owner' });

    const registerBakery = await request(app)
      .post('/v1/bakeries')
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({
        name: unique('E2E Bakery'),
        description: 'E2E bakery profile',
        addressLine1: 'Bakery District',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: `+${bakeryOwner.phoneNumber}`,
        email: bakeryOwner.email,
      });

    expect(registerBakery.status).toBe(201);
    bakery = registerBakery.body?.data?.bakery;
    expect(bakery?.id).toBeTruthy();
    markCreated('bakeries', bakery.id);

    const updateBakery = await request(app)
      .put(`/v1/bakeries/${bakery.id}`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ description: 'Updated bakery description for E2E flow' });

    expect(updateBakery.status).toBe(200);

    const createProduct = await request(app)
      .post('/v1/bakery/products')
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({
        name: unique('E2E Bread'),
        description: 'Fresh QA bread',
        price: 4.75,
        stockQuantity: 120,
      });

    expect(createProduct.status).toBe(201);
    product = createProduct.body?.data;
    expect(product?.id).toBeTruthy();
    markCreated('products', product.id);

    const updateProduct = await request(app)
      .put(`/v1/bakery/products/${product.id}`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ stockQuantity: 130 });

    expect(updateProduct.status).toBe(200);

    const toggleAvailability = await request(app)
      .patch(`/v1/bakery/products/${product.id}/availability`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ isAvailable: true });

    expect(toggleAvailability.status).toBe(200);

    const payoutAccount = await request(app)
      .post('/v1/finance/payout-accounts')
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({
        accountHolderName: 'E2E Bakery Owner',
        bankName: 'QA Bank',
        iban: `JO${Math.floor(10 ** 13 + Math.random() * 9 * 10 ** 13)}`,
        accountNumberLast4: '7788',
        isPrimary: true,
      });

    expect(payoutAccount.status).toBe(201);
    markCreated('payoutAccounts', payoutAccount.body?.data?.account?.id);
  });

  test('3) Customer ordering + scheduling + cancellation flow', async () => {
    const browseBakeries = await request(app).get('/v1/bakeries');
    expect(browseBakeries.status).toBe(200);

    const browseProducts = await request(app).get('/v1/products');
    expect(browseProducts.status).toBe(200);

    // Launch rehearsal uses the supported direct order-creation flow
    // (browse -> create order) instead of an unimplemented cart endpoint.

    const initialProduct = await prisma.product.findUnique({ where: { id: product.id } });
    const initialStock = Number(initialProduct.stockQuantity);

    const idemKey = unique('idem');
    const orderPayload = {
      bakeryId: bakery.id,
      orderType: 'delivery',
      deliveryAddressId: created.addresses[0],
      paymentMethod: 'cash_on_delivery',
      items: [
        { productId: product.id, quantity: 2 },
      ],
      specialInstructions: 'Ring the doorbell',
    };

    const createOrder = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .set('Idempotency-Key', idemKey)
      .send(orderPayload);

    expect(createOrder.status).toBe(201);
    orderForSchedule = createOrder.body?.data?.order;
    expect(orderForSchedule?.id).toBeTruthy();
    markCreated('orders', orderForSchedule.id);

    const replayOrder = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .set('Idempotency-Key', idemKey)
      .send(orderPayload);

    expect(replayOrder.status).toBe(200);
    expect(replayOrder.body?.data?.replayed).toBe(true);
    expect(replayOrder.body?.data?.order?.id).toBe(orderForSchedule.id);

    const slotStart = new Date(Date.now() + 60 * 60 * 1000);
    const slotEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const createSlot = await request(app)
      .post('/v1/delivery/slots')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        city: 'Amman',
        zoneCode: 'QA-ZONE-1',
        startsAt: slotStart.toISOString(),
        endsAt: slotEnd.toISOString(),
        capacity: 10,
      });

    expect(createSlot.status).toBe(201);
    const slotId = createSlot.body?.data?.slot?.id;
    markCreated('slots', slotId);

    const scheduleOrder = await request(app)
      .post('/v1/orders/scheduled')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        orderId: orderForSchedule.id,
        slotId,
      });

    expect(scheduleOrder.status).toBe(200);
    const dispatch = await prisma.dispatchJob.findUnique({ where: { orderId: orderForSchedule.id } });
    expect(dispatch).toBeTruthy();

    const orderToCancelRes = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        bakeryId: bakery.id,
        orderType: 'pickup',
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: product.id, quantity: 3 }],
      });

    expect(orderToCancelRes.status).toBe(201);
    orderForCancel = orderToCancelRes.body?.data?.order;
    markCreated('orders', orderForCancel.id);

    const cancelRes = await request(app)
      .post(`/v1/orders/${orderForCancel.id}/cancel`)
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({ reasonCode: 'customer_requested', reason: 'Changed mind' });

    expect(cancelRes.status).toBe(200);

    const cancellationReason = await prisma.orderCancellationReason.findUnique({ where: { orderId: orderForCancel.id } });
    expect(cancellationReason?.reasonCode).toBe('customer_requested');

    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
    const finalStock = Number(finalProduct.stockQuantity);
    expect(finalStock).toBeGreaterThanOrEqual(initialStock - 2);
  });

  test('4) Dispatch/driver flow with double-assignment prevention', async () => {
    secondDriver = await registerAndVerify({ role: 'driver', fullNamePrefix: 'E2E Driver' });

    const createZone = await request(app)
      .post('/v1/delivery/route-zones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ city: 'Amman', code: unique('ZONE'), name: 'QA Zone' });

    expect(createZone.status).toBe(201);
    markCreated('zones', createZone.body?.data?.zone?.id);

    const createShift = await request(app)
      .post('/v1/delivery/driver-shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        driverUserId: seededDriver.id,
        city: 'Amman',
        startsAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      });

    expect(createShift.status).toBe(201);
    markCreated('shifts', createShift.body?.data?.shift?.id);

    const createDriverOrderRes = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        bakeryId: bakery.id,
        orderType: 'delivery',
        deliveryAddressId: created.addresses[0],
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: product.id, quantity: 1 }],
      });

    expect(createDriverOrderRes.status).toBe(201);
    orderForDriverSuccess = createDriverOrderRes.body?.data?.order;
    markCreated('orders', orderForDriverSuccess.id);

    const setPreparing = await request(app)
      .put(`/v1/bakery/orders/${orderForDriverSuccess.id}/status`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ status: 'preparing' });
    expect(setPreparing.status).toBe(200);

    const setReady = await request(app)
      .put(`/v1/bakery/orders/${orderForDriverSuccess.id}/status`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ status: 'ready_for_pickup' });
    expect(setReady.status).toBe(200);

    const driver1Token = asToken(seededDriver);
    const driver2Token = secondDriver.token;

    const acceptByDriver1 = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverSuccess.id}/accept`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({});

    expect(acceptByDriver1.status).toBe(200);

    const acceptByDriver2 = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverSuccess.id}/accept`)
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({});

    expect(acceptByDriver2.status).toBe(409);

    const setOutForDelivery = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverSuccess.id}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'picked_up' });
    expect(setOutForDelivery.status).toBe(200);

    const setDelivered = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverSuccess.id}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'out_for_delivery' });
    expect(setDelivered.status).toBe(200);

    const finishDelivered = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverSuccess.id}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'delivered', proofImageUrl: '/uploads/proof-e2e.jpg' });
    expect(finishDelivered.status).toBe(200);

    const createFailedOrder = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        bakeryId: bakery.id,
        orderType: 'delivery',
        deliveryAddressId: created.addresses[0],
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: product.id, quantity: 1 }],
      });

    expect(createFailedOrder.status).toBe(201);
    orderForDriverFailure = createFailedOrder.body?.data?.order;
    markCreated('orders', orderForDriverFailure.id);

    await request(app)
      .put(`/v1/bakery/orders/${orderForDriverFailure.id}/status`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ status: 'preparing' });

    await request(app)
      .put(`/v1/bakery/orders/${orderForDriverFailure.id}/status`)
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ status: 'ready_for_pickup' });

    const acceptFailedOrder = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverFailure.id}/accept`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({});

    expect(acceptFailedOrder.status).toBe(200);

    const pickUpFailedOrder = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverFailure.id}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'picked_up' });

    expect(pickUpFailedOrder.status).toBe(200);

    const markFailed = await request(app)
      .post(`/v1/driver/assignments/${orderForDriverFailure.id}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'failed', failureReason: 'customer_unreachable' });

    expect(markFailed.status).toBe(200);
  });

  test('5/6/9) Refund/dispute/finance/admin flow', async () => {
    const orderForRefund = orderForDriverSuccess;

    const disputeOpen = await request(app)
      .post('/v1/finance/disputes')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({
        orderId: orderForRefund.id,
        subject: 'Late delivery concern',
        description: 'Delivery arrived after expected time window.',
      });

    expect(disputeOpen.status).toBe(201);
    const disputeId = disputeOpen.body?.data?.dispute?.id;
    expect(disputeId).toBeTruthy();
    markCreated('disputes', disputeId);

    const disputeResolve = await request(app)
      .post(`/v1/finance/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolutionNote: 'Resolved in QA flow' });

    expect(disputeResolve.status).toBe(200);

    const refundCreate = await request(app)
      .post('/v1/finance/refunds')
      .set('Authorization', `Bearer ${onboardingUser.token}`)
      .send({ orderId: orderForRefund.id, amount: 1, reason: 'Quality issue' });

    expect(refundCreate.status).toBe(201);
    const refundId = refundCreate.body?.data?.refund?.id;
    markCreated('refunds', refundId);

    const refundApprove = await request(app)
      .post(`/v1/finance/refunds/${refundId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ adminNotes: 'Approved via e2e test' });
    expect(refundApprove.status).toBe(200);

    const refundProcess = await request(app)
      .post(`/v1/finance/refunds/${refundId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(refundProcess.status).toBe(200);

    const snapshot = await request(app)
      .post(`/v1/finance/orders/${orderForRefund.id}/snapshot`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(snapshot.status).toBe(200);

    const payoutReq = await request(app)
      .post('/v1/finance/payouts/request')
      .set('Authorization', `Bearer ${bakeryOwner.token}`)
      .send({ amount: 1, reason: 'E2E payout request' });

    expect(payoutReq.status).toBe(201);
    const payoutId = payoutReq.body?.data?.payout?.id;
    markCreated('payouts', payoutId);

    const bulkApprove = await request(app)
      .post('/v1/finance/payouts/bulk-actions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payoutIds: [payoutId], action: 'approve' });

    expect(bulkApprove.status).toBe(200);

    const markPaid = await request(app)
      .post(`/v1/finance/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ transactionRef: unique('txn') });

    expect(markPaid.status).toBe(200);

    const ledger = await request(app)
      .get('/v1/finance/vendor-ledger?vendorType=bakery&vendorId=' + bakery.id)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(ledger.status).toBe(200);
    expect(Array.isArray(ledger.body?.data?.entries)).toBe(true);

    const settlements = await request(app)
      .post('/v1/finance/settlement-batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        periodStart: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        periodEnd: new Date().toISOString(),
      });

    expect(settlements.status).toBe(201);

    const csvExport = await request(app)
      .get('/v1/finance/reconciliation/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(csvExport.status).toBe(200);
    expect(String(csvExport.headers['content-type'] || '')).toContain('text/csv');

    const adminLogin = await request(app)
      .post('/v1/admin/auth/login')
      .send({
        email: admin.email,
        password: 'Password@123',
      });

    expect(adminLogin.status).toBe(200);
    const portalAdminToken = adminLogin.body?.data?.token;
    expect(portalAdminToken).toBeTruthy();

    const dashboard = await request(app)
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${portalAdminToken}`);
    expect(dashboard.status).toBe(200);

    const kpiDaily = await request(app)
      .get('/v1/admin/kpis/daily')
      .set('Authorization', `Bearer ${portalAdminToken}`);
    expect(kpiDaily.status).toBe(200);

    const alertsActive = await request(app)
      .get('/v1/admin/alerts/active')
      .set('Authorization', `Bearer ${portalAdminToken}`);
    expect(alertsActive.status).toBe(200);

    const nonAdminBlocked = await request(app)
      .get('/v1/admin/alerts/active')
      .set('Authorization', `Bearer ${onboardingUser.token}`);
    expect(nonAdminBlocked.status).toBe(403);
  });
});
