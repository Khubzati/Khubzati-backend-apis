process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const tokenFor = (user) => jwt.sign(
  { id: user.id, role: user.role },
  process.env.JWT_SECRET || 'dev-temp-secret-change-me',
  { expiresIn: '1h' },
);

describe('Authenticated customer cart', () => {
  const ids = { users: [], bakeries: [], products: [], carts: [] };
  let customerToken;
  let customer;
  let firstProduct;
  let secondProduct;

  beforeAll(async () => {
    const stamp = Date.now();
    customer = await prisma.user.create({
      data: {
        username: `cart_customer_${stamp}`,
        email: `cart_customer_${stamp}@example.com`,
        phoneNumber: `+96275${String(stamp).slice(-7)}`,
        password: 'x',
        role: 'customer',
        isVerified: true,
      },
    });
    const owners = await Promise.all([1, 2].map((number) => prisma.user.create({
      data: {
        username: `cart_owner_${number}_${stamp}`,
        email: `cart_owner_${number}_${stamp}@example.com`,
        phoneNumber: `+9627${number}${String(stamp).slice(-7)}`,
        password: 'x',
        role: 'bakery_owner',
        isVerified: true,
      },
    })));
    ids.users.push(customer.id, ...owners.map(({ id }) => id));
    customerToken = tokenFor(customer);
    const bakeries = await Promise.all(owners.map((owner, index) => prisma.bakery.create({
      data: {
        ownerId: owner.id,
        name: `Cart Bakery ${index}`,
        addressLine1: 'Test',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: `+9627900001${index}`,
        status: 'approved',
      },
    })));
    ids.bakeries.push(...bakeries.map(({ id }) => id));
    [firstProduct, secondProduct] = await Promise.all(bakeries.map((bakery, index) => prisma.product.create({
      data: {
        bakeryId: bakery.id,
        itemType: 'bakery',
        name: `Cart Product ${index}`,
        price: index + 2,
        stockQuantity: 5,
        isAvailable: true,
      },
    })));
    ids.products.push(firstProduct.id, secondProduct.id);
  });

  afterAll(async () => {
    const carts = await prisma.cart.findMany({ where: { userId: { in: ids.users } }, select: { id: true } });
    ids.carts.push(...carts.map(({ id }) => id));
    await prisma.cartItem.deleteMany({ where: { cartId: { in: ids.carts } } });
    await prisma.cart.deleteMany({ where: { id: { in: ids.carts } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
    await prisma.bakery.deleteMany({ where: { id: { in: ids.bakeries } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });

  test('requires authentication and persists add/update/remove/clear', async () => {
    expect((await request(app).get('/v1/customer/cart')).status).toBe(401);

    const added = await request(app)
      .post('/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: firstProduct.id, quantity: 2 });
    expect(added.status).toBe(201);
    expect(Number(added.body.data.cart.totalAmount)).toBe(4);
    const itemId = added.body.data.cart.cartItems[0].id;

    const updated = await request(app)
      .put(`/v1/customer/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ quantity: 3 });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.data.cart.totalAmount)).toBe(6);

    const removed = await request(app)
      .delete(`/v1/customer/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.cart.cartItems).toHaveLength(0);

    const cleared = await request(app)
      .delete('/v1/customer/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(cleared.status).toBe(200);
  });

  test('enforces stock, approval and one-vendor cart', async () => {
    const addFirst = await request(app)
      .post('/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: firstProduct.id, quantity: 1 });
    expect(addFirst.status).toBe(201);

    const otherVendor = await request(app)
      .post('/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: secondProduct.id, quantity: 1 });
    expect(otherVendor.status).toBe(409);

    const tooMany = await request(app)
      .post('/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: firstProduct.id, quantity: 10 });
    expect(tooMany.status).toBe(400);

    await prisma.bakery.update({ where: { id: firstProduct.bakeryId }, data: { status: 'suspended' } });
    const suspended = await request(app)
      .post('/v1/customer/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: firstProduct.id, quantity: 1 });
    expect(suspended.status).toBe(403);
  });

  test('concurrent first additions converge on one active cart', async () => {
    await prisma.bakery.update({ where: { id: firstProduct.bakeryId }, data: { status: 'approved' } });
    const existing = await prisma.cart.findMany({ where: { userId: customer.id, deletedAt: null }, select: { id: true } });
    await prisma.cartItem.deleteMany({ where: { cartId: { in: existing.map(({ id }) => id) } } });
    await prisma.cart.deleteMany({ where: { id: { in: existing.map(({ id }) => id) } } });
    const results = await Promise.all([
      request(app).post('/v1/customer/cart/items').set('Authorization', `Bearer ${customerToken}`).send({ productId: firstProduct.id, quantity: 1 }),
      request(app).post('/v1/customer/cart/items').set('Authorization', `Bearer ${customerToken}`).send({ productId: firstProduct.id, quantity: 1 }),
    ]);
    expect(results.every(({ status }) => status === 201)).toBe(true);
    await expect(prisma.cart.count({ where: { userId: customer.id, deletedAt: null } })).resolves.toBe(1);
    const cart = await prisma.cart.findFirst({ where: { userId: customer.id, deletedAt: null }, include: { cartItems: true } });
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0].quantity).toBe(2);
  });

  test('database rejects products with both or neither owner', async () => {
    await expect(prisma.product.create({
      data: {
        bakeryId: firstProduct.bakeryId,
        restaurantId: 'test-restaurant-id',
        itemType: 'bakery', name: `Invalid both ${Date.now()}`, price: 1,
      },
    })).rejects.toBeTruthy();
    await expect(prisma.product.create({
      data: { itemType: 'bakery', name: `Invalid none ${Date.now()}`, price: 1 },
    })).rejects.toBeTruthy();
  });
});
