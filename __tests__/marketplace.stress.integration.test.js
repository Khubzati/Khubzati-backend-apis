process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const { aggregateKpisForDateKey, ALL_CITIES_KEY } = require('../src/services/kpiAggregationService');
const { toTimeZoneDateKey } = require('../src/services/timezoneWindowService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const tokenFor = (user) => jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '2h' });

describe('Stress-style marketplace integration tests', () => {
  let admin;
  let customer;
  let bakeryOwner;
  let driverA;
  let driverB;
  let adminToken;
  let customerToken;
  let bakeryOwnerToken;

  const created = {
    users: [],
    products: [],
    orders: [],
    orderItems: [],
  };

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });
    driverA = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });

    const secondDriverEmail = `${unique('stress_driver')}@example.com`;
    driverB = await prisma.user.create({
      data: {
        username: unique('stress_driver'),
        email: secondDriverEmail,
        password: 'x',
        fullName: 'Stress Driver B',
        phoneNumber: `+96277${Math.floor(1000000 + Math.random() * 899999)}`,
        role: 'driver',
        isVerified: true,
      },
    });
    created.users.push(driverB.id);

    await prisma.driverProfile.create({
      data: {
        userId: driverB.id,
        status: 'online',
        vehicleType: 'motorbike',
        licensePlate: unique('PLATE'),
      },
    });

    adminToken = tokenFor(admin);
    customerToken = tokenFor(customer);
    bakeryOwnerToken = tokenFor(bakeryOwner);
  });

  afterAll(async () => {
    await prisma.notificationDeadLetter.deleteMany({ where: { eventType: { contains: 'qa_stress' } } }).catch(() => null);
    await prisma.notificationJob.deleteMany({ where: { eventType: { contains: 'qa_stress' } } }).catch(() => null);

    await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.dispatchJob.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.orderCancellationReason.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.inventoryMovement.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } }).catch(() => null);

    await prisma.product.deleteMany({ where: { id: { in: created.products } } }).catch(() => null);

    await prisma.driverProfile.deleteMany({ where: { userId: { in: created.users } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => null);
  });

  test('high-volume concurrent order creation does not oversell inventory', async () => {
    const product = await prisma.product.create({
      data: {
        name: unique('stress_product'),
        price: 2.5,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 25,
        isAvailable: true,
      },
    });
    created.products.push(product.id);

    const attempts = 50;
    const requests = Array.from({ length: attempts }).map((_, index) =>
      request(app)
        .post('/v1/orders/create')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          bakeryId: 'test-bakery-id',
          orderType: 'delivery',
          deliveryAddressId: 'test-address-id',
          paymentMethod: 'cash_on_delivery',
          idempotencyKey: unique(`stress_${index}`),
          items: [{ productId: product.id, quantity: 1 }],
        }),
    );

    const responses = await Promise.all(requests);
    const success = responses.filter((res) => res.status === 201);
    const rejected = responses.filter((res) => res.status >= 400);
    const successfulOrderIds = success
      .map((res) => res.body?.data?.order?.id)
      .filter((value) => typeof value === 'string');

    success.forEach((res) => {
      const orderId = res.body?.data?.order?.id;
      if (orderId) created.orders.push(orderId);
    });

    expect(success.length).toBeLessThanOrEqual(25);
    expect(rejected.length).toBeGreaterThanOrEqual(25);

    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(refreshed.stockQuantity)).toBeGreaterThanOrEqual(0);
    expect(Number(refreshed.stockQuantity)).toBe(25 - success.length);

    const reserveMovements = await prisma.inventoryMovement.findMany({
      where: {
        productId: product.id,
        movementType: 'reserve',
        reason: 'order_created',
        orderId: { in: successfulOrderIds },
      },
      select: {
        id: true,
        quantityAfter: true,
      },
    });
    expect(reserveMovements.length).toBe(success.length);
    expect(reserveMovements.every((movement) => Number(movement.quantityAfter) >= 0)).toBe(true);
  });

  test('dispatch assignment race allows only one driver acceptance', async () => {
    const raceProduct = await prisma.product.create({
      data: {
        name: unique('dispatch_race_product'),
        price: 3,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 10,
        isAvailable: true,
      },
    });
    created.products.push(raceProduct.id);

    const orderRes = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        bakeryId: 'test-bakery-id',
        orderType: 'delivery',
        deliveryAddressId: 'test-address-id',
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: raceProduct.id, quantity: 1 }],
      });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body?.data?.order?.id;
    created.orders.push(orderId);

    await request(app)
      .put(`/v1/bakery/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({ status: 'preparing' });

    await request(app)
      .put(`/v1/bakery/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({ status: 'ready_for_pickup' });

    const tokenA = tokenFor(driverA);
    const tokenB = tokenFor(driverB);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/v1/driver/assignments/${orderId}/accept`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({}),
      request(app)
        .post(`/v1/driver/assignments/${orderId}/accept`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({}),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  test('notification retry pressure moves poison jobs to dead-letter', async () => {
    const poisonCount = 30;
    await Promise.all(
      Array.from({ length: poisonCount }).map(() =>
        prisma.notificationJob.create({
          data: {
            userId: null,
            eventType: 'qa_stress_poison',
            channel: 'in_app',
            title: 'poison',
            message: 'poison',
            status: 'pending',
            maxAttempts: 2,
            attempts: 0,
            nextAttemptAt: new Date(Date.now() - 1000),
          },
        }),
      ),
    );

    const process1 = await request(app)
      .post('/v1/notifications/jobs/process')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workerId: 'stress-worker', limit: 200 });

    expect(process1.status).toBe(200);

    await prisma.notificationJob.updateMany({
      where: { eventType: 'qa_stress_poison', status: 'pending' },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const process2 = await request(app)
      .post('/v1/notifications/jobs/process')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workerId: 'stress-worker', limit: 200 });

    expect(process2.status).toBe(200);

    const deadLetters = await prisma.notificationDeadLetter.count({ where: { eventType: 'qa_stress_poison' } });
    expect(deadLetters).toBe(poisonCount);
  });

  test('KPI aggregation handles high-volume day snapshot', async () => {
    const loadProduct = await prisma.product.create({
      data: {
        name: unique('kpi_load_product'),
        price: 5,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 3000,
        isAvailable: true,
      },
    });
    created.products.push(loadProduct.id);

    const batchSize = 250;
    const createOrderPromises = [];
    for (let i = 0; i < batchSize; i += 1) {
      createOrderPromises.push(
        prisma.order.create({
          data: {
            userId: customer.id,
            bakeryId: 'test-bakery-id',
            orderNumber: `${unique('kpi_load')}_${i}`,
            status: i % 7 === 0 ? 'cancelled' : 'completed',
            orderType: 'delivery',
            deliveryAddressId: 'test-address-id',
            totalAmount: 5,
            paymentMethod: 'cash_on_delivery',
            paymentStatus: 'paid',
            createdAt: new Date(),
            estimatedDeliveryTime: new Date(Date.now() + 30 * 60 * 1000),
            actualDeliveryTime: new Date(Date.now() + 20 * 60 * 1000),
          },
        }),
      );
    }

    const createdOrders = await Promise.all(createOrderPromises);
    createdOrders.forEach((order) => created.orders.push(order.id));

    await Promise.all(
      createdOrders.map((order) =>
        prisma.orderItem
          .create({
            data: {
              orderId: order.id,
              productId: loadProduct.id,
              quantity: 1,
              price: 5,
              subtotal: 5,
            },
          })
          .then((item) => created.orderItems.push(item.id)),
      ),
    );

    const dateKey = toTimeZoneDateKey(
      new Date(),
      process.env.KPI_TIMEZONE || 'Asia/Amman',
    );
    const summary = await aggregateKpisForDateKey({
      prisma,
      dateKey,
      timeZone: process.env.KPI_TIMEZONE || 'Asia/Amman',
    });

    expect(summary.upserted).toBeGreaterThan(0);
    const globalRow = summary.rows.find((row) => row.city === ALL_CITIES_KEY);
    expect(globalRow).toBeTruthy();
    expect(globalRow.ordersCount).toBeGreaterThanOrEqual(batchSize);
  });

  test('duplicate idempotency key does not double reserve inventory', async () => {
    const product = await prisma.product.create({
      data: {
        name: unique('idem_guard_product'),
        price: 4,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 10,
        isAvailable: true,
      },
    });
    created.products.push(product.id);

    const idemKey = unique('idem_guard');
    const payload = {
      bakeryId: 'test-bakery-id',
      orderType: 'delivery',
      deliveryAddressId: 'test-address-id',
      paymentMethod: 'cash_on_delivery',
      idempotencyKey: idemKey,
      items: [{ productId: product.id, quantity: 2 }],
    };

    const first = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body?.data?.replayed).toBe(true);

    const orderId = first.body?.data?.order?.id;
    created.orders.push(orderId);

    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(refreshed.stockQuantity)).toBe(8);

    const reserveCount = await prisma.inventoryMovement.count({
      where: {
        productId: product.id,
        movementType: 'reserve',
        orderId,
      },
    });
    expect(reserveCount).toBe(1);
  });

  test('order reservation transaction rolls back fully when any item reserve fails', async () => {
    const productA = await prisma.product.create({
      data: {
        name: unique('rollback_product_a'),
        price: 3,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 5,
        isAvailable: true,
      },
    });
    const productB = await prisma.product.create({
      data: {
        name: unique('rollback_product_b'),
        price: 4,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 1,
        isAvailable: true,
      },
    });
    created.products.push(productA.id, productB.id);

    const create = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        bakeryId: 'test-bakery-id',
        orderType: 'delivery',
        deliveryAddressId: 'test-address-id',
        paymentMethod: 'cash_on_delivery',
        items: [
          { productId: productA.id, quantity: 2 },
          { productId: productB.id, quantity: 2 },
        ],
      });

    expect(create.status).toBe(400);

    const [refreshedA, refreshedB] = await Promise.all([
      prisma.product.findUnique({ where: { id: productA.id } }),
      prisma.product.findUnique({ where: { id: productB.id } }),
    ]);
    expect(Number(refreshedA.stockQuantity)).toBe(5);
    expect(Number(refreshedB.stockQuantity)).toBe(1);

    const reserveMovements = await prisma.inventoryMovement.count({
      where: {
        productId: { in: [productA.id, productB.id] },
        movementType: 'reserve',
      },
    });
    expect(reserveMovements).toBe(0);
  });

  test('cancellation restocks exactly once', async () => {
    const product = await prisma.product.create({
      data: {
        name: unique('cancel_once_product'),
        price: 5,
        itemType: 'bakery',
        bakeryId: 'test-bakery-id',
        stockQuantity: 7,
        isAvailable: true,
      },
    });
    created.products.push(product.id);

    const create = await request(app)
      .post('/v1/orders/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        bakeryId: 'test-bakery-id',
        orderType: 'delivery',
        deliveryAddressId: 'test-address-id',
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: product.id, quantity: 3 }],
      });
    expect(create.status).toBe(201);
    const orderId = create.body?.data?.order?.id;
    created.orders.push(orderId);

    const cancelFirst = await request(app)
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        reasonCode: 'customer_requested',
        reason: 'cancel once guard',
      });
    expect(cancelFirst.status).toBe(200);

    const cancelSecond = await request(app)
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        reasonCode: 'customer_requested',
        reason: 'duplicate cancel should not restock again',
      });
    expect([400, 409]).toContain(cancelSecond.status);

    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(refreshed.stockQuantity)).toBe(7);

    const releaseCount = await prisma.inventoryMovement.count({
      where: {
        productId: product.id,
        movementType: 'release',
        orderId,
      },
    });
    expect(releaseCount).toBe(1);
  });
});
